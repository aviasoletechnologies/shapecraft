/**
 * Example: Turnaround — conversational, multi-turn schema collection.
 *
 * Instead of one prompt -> one structured object, the model interviews the
 * user across turns (per your systemPrompt) and shapecraft just relays its
 * replies. Nothing is validated until the model signals it's done — then
 * shapecraft extracts + validates once, over the whole transcript.
 *
 * `memory` is a plain, JSON-serializable object — thread the previous
 * result's `memory` back in on each call. In a real app each turn is a
 * separate HTTP request; persist `memory` between them (see the stateless
 * server pattern in README.md).
 */
import { generate, anthropic } from "@aviasole/shapecraft";

const model = anthropic({ model: "claude-haiku-4-5-20251001" });

const schema = {
  jsonSchema: {
    type: "object",
    required: ["problem", "idea", "user"],
    properties: {
      problem: { type: "string" },
      idea: { type: "string" },
      user: { type: "string" },
    },
  },
};

const FACILITATOR =
  "You are the Discover Facilitator. Ask exactly one focused question at a time to extract: " +
  "(1) What problem are we solving? (2) What is the idea? (3) Who is the user? " +
  "Probe vague answers for specifics. Do not invent details on the user's behalf.";

let r = await generate(model, schema, "Hii", { systemPrompt: FACILITATOR }, { turnaround: true });
console.log(r.status === "collecting" ? r.message : r); // "What problem are you trying to solve?"

r = await generate(
  model,
  schema,
  "Onboarding new hires takes 3 weeks because of manual account setup",
  { systemPrompt: FACILITATOR },
  { turnaround: true, memory: r.memory }
);
console.log(r.status === "collecting" ? r.message : r); // "What's your idea for solving this?"

r = await generate(
  model,
  schema,
  "A dashboard that auto-provisions accounts and routes approvals",
  { systemPrompt: FACILITATOR },
  { turnaround: true, memory: r.memory }
);
console.log(r.status === "collecting" ? r.message : r); // "Who is the user for this dashboard?"

r = await generate(
  model,
  schema,
  "HR onboarding coordinators",
  { systemPrompt: FACILITATOR },
  { turnaround: true, memory: r.memory }
);

if (r.status === "complete") {
  console.log(r.data); // { problem: "...", idea: "...", user: "..." } — extracted & validated once, here
}
