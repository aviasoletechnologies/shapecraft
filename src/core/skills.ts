import type { GenerateOptions, RunSkillLoopOptions, Skill, SkillCall, SkillLoopMemory, SkillTurn, ValidatorInput } from "../types.js";
import { MaxSkillTurnsExceededError, SkillExecutionError } from "../types.js";
import type { ShapecraftModel } from "../types.js";
import { generate } from "./generate.js";
import { toJsonSchema } from "./schema.js";

/**
 * Named skills the model can be asked to choose between via `generateSkillCall()`.
 * v1 is Zod-only (see `Skill` in types.ts) - `register()`/`get()`/`list()` only, no
 * removal API, since nothing in this feature needs to unregister a skill mid-use.
 */
export class SkillRegistry {
  private skills = new Map<string, Skill>();

  register<TInput, TOutput>(skill: Skill<TInput, TOutput>): void {
    if (this.skills.has(skill.name)) {
      throw new Error(`A skill named "${skill.name}" is already registered`);
    }
    this.skills.set(skill.name, skill as Skill);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  list(): Skill[] {
    return Array.from(this.skills.values());
  }
}

/**
 * Builds the dispatch schema fresh on every call (registries can grow between calls,
 * so this can't be cached) - a `{ validate, hint }` custom-validator schema, not a
 * `z.discriminatedUnion` wrapping each skill's `inputSchema` directly. A consumer's
 * `inputSchema` can come from a different Zod install/major version than the one
 * this package bundles (same dual-package hazard `isZodSchema()` duck-types around
 * elsewhere) - nesting a foreign Zod instance inside a schema built from this
 * package's own `z` crashes zod's internal parser the moment the versions diverge,
 * since v4's object/union machinery walks the whole graph expecting every node to be
 * its own native internals. Calling each skill's `inputSchema.safeParse()` directly
 * instead never touches this package's zod internals with foreign data, so it works
 * regardless of which Zod major version the consumer is on.
 */
function buildDispatchSchema(registry: SkillRegistry): ValidatorInput {
  const skills = registry.list();
  if (skills.length === 0) {
    throw new Error("Cannot dispatch: SkillRegistry has no registered skills");
  }

  const hint = {
    anyOf: skills.map((skill) => ({
      type: "object",
      properties: {
        skill: { const: skill.name },
        args: toJsonSchema(skill.inputSchema),
      },
      required: ["skill", "args"],
      ...(skill.description ? { description: skill.description } : {}),
    })),
  };

  return {
    hint,
    validate: (output: unknown): boolean => {
      if (typeof output !== "object" || output === null) return false;
      const { skill: skillName, args } = output as { skill?: unknown; args?: unknown };
      if (typeof skillName !== "string") return false;
      const skill = registry.get(skillName);
      if (!skill) return false;
      return skill.inputSchema.safeParse(args).success;
    },
  };
}

/**
 * Asks the model to pick one registered skill and produce validated arguments for
 * it. A thin wrapper around `generate()` - same retry loop, same `guaranteeLevel`
 * semantics per backend, zero new dispatch-site code (see
 * `skill-based-generation-plan.md` §2).
 */
export async function generateSkillCall(
  model: ShapecraftModel,
  registry: SkillRegistry,
  prompt: string,
  options: GenerateOptions = {}
): Promise<SkillCall> {
  const dispatchSchema = buildDispatchSchema(registry);
  const result = await generate<SkillCall>(model, dispatchSchema, prompt, options);
  return result.data;
}

/**
 * Executes one skill call. Throws `SkillExecutionError` (not `SchemaViolationError`)
 * if the handler itself throws - the dispatch was already valid by this point, so
 * this is a business-logic failure, not something `generate()`'s retry loop should
 * ever swallow.
 */
export async function runSkill(registry: SkillRegistry, call: SkillCall): Promise<unknown> {
  const skill = registry.get(call.skill);
  if (!skill) {
    throw new Error(`No skill registered with name "${call.skill}"`);
  }
  try {
    return await skill.handler(call.args);
  } catch (err) {
    throw new SkillExecutionError(call.skill, err);
  }
}

function formatTurn(turn: SkillTurn): string {
  const called = `called "${turn.call.skill}" with ${JSON.stringify(turn.call.args)}`;
  return "result" in turn ? `- ${called} -> result: ${JSON.stringify(turn.result)}` : `- ${called} -> error: ${turn.error}`;
}

function buildTranscript(goal: string, turns: SkillTurn[]): string {
  if (turns.length === 0) return goal;
  return `Goal: ${goal}\n\nSteps so far:\n${turns.map(formatTurn).join("\n")}\n\nWhat's the next step?`;
}

/**
 * Repeatedly calls `generateSkillCall()` + `runSkill()`, threading prior calls and
 * their results/errors back into the next call's prompt, until a skill marked
 * `terminal: true` succeeds or `maxTurns` is exceeded. A handler failure is recorded
 * as an error turn and fed back to the model (so it can adapt - try different
 * arguments, a different skill, or give up) rather than aborting the whole loop;
 * `SkillExecutionError` only ever propagates out of `runSkill()` directly, not out of
 * a loop turn.
 *
 * `memory` is JSON-serializable and returned on `MaxSkillTurnsExceededError`, so a
 * caller can persist it and call `runSkillLoop()` again with a fresh `maxTurns`
 * budget to continue instead of starting over.
 */
export async function runSkillLoop(
  model: ShapecraftModel,
  registry: SkillRegistry,
  goal: string,
  options: RunSkillLoopOptions = {}
): Promise<{ result: unknown; memory: SkillLoopMemory }> {
  const maxTurns = options.maxTurns ?? 20;
  const memory: SkillLoopMemory = options.memory ?? { turns: [], status: "running", turnCount: 0 };

  if (memory.status === "complete") {
    throw new Error("This skill loop has already completed - start a new one.");
  }

  while (memory.turnCount < maxTurns) {
    memory.turnCount += 1;

    const prompt = buildTranscript(goal, memory.turns);
    const call = await generateSkillCall(model, registry, prompt, options);
    const skill = registry.get(call.skill);

    try {
      const result = await runSkill(registry, call);
      memory.turns.push({ call, result });
      if (skill?.terminal) {
        memory.status = "complete";
        return { result, memory };
      }
    } catch (err) {
      // Surface the handler's own failure reason, not SkillExecutionError's generic
      // wrapper text - that's what's actually useful for the model to adapt to.
      const cause = err instanceof SkillExecutionError ? err.cause : err;
      const message = cause instanceof Error ? cause.message : String(cause);
      memory.turns.push({ call, error: message });
    }
  }

  throw new MaxSkillTurnsExceededError(maxTurns, memory);
}
