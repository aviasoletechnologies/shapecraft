import type { GbnfInput } from "../types.js";

/**
 * A pragmatic GBNF (GGML BNF) grammar interpreter — the same subset posture as
 * `checkJsonSchema` (a useful subset of JSON Schema, not the whole spec). It
 * parses a grammar once, then checks whether a candidate string is in the
 * grammar's language. Used to validate output on backends that cannot apply the
 * grammar at the token level (everything except `llamaCpp()`).
 *
 * Supported: string literals, rule references, sequences, alternation `|`,
 * grouping `( )`, repetition `* + ? {m} {m,} {m,n}`, character classes
 * `[a-z] [^0-9]` with ranges and escapes (`\n \t \" \\ \xNN \uNNNN \UNNNNNNNN`),
 * and `#` line comments. Not supported (documented in the README ledger):
 * left-recursive rules (matched as nothing, never hangs), nested/imported
 * grammars, and llama.cpp-specific extensions — an unsupported construct throws
 * at parse time, before the model is ever called.
 */

type GNode =
  | { type: "lit"; value: string }
  | { type: "class"; negated: boolean; ranges: Array<[number, number]> }
  | { type: "ref"; name: string }
  | { type: "seq"; items: GNode[] }
  | { type: "alt"; options: GNode[] }
  | { type: "rep"; node: GNode; min: number; max: number };

export type GbnfGrammar = Map<string, GNode>;

function fail(msg: string): never {
  throw new Error(`Invalid GBNF grammar: ${msg}`);
}

class GbnfParser {
  private pos = 0;
  constructor(private readonly src: string) {}

  parse(): GbnfGrammar {
    const rules: GbnfGrammar = new Map();
    this.skipWs();
    while (this.pos < this.src.length) {
      const name = this.parseName();
      this.skipWs();
      this.expect("::=");
      rules.set(name, this.parseAlternation());
      this.skipWs();
    }
    if (rules.size === 0) fail("grammar is empty");
    if (!rules.has("root")) fail("grammar has no `root` rule (the entry point)");
    return rules;
  }

  private skipWs(): void {
    while (this.pos < this.src.length) {
      const c = this.src[this.pos]!;
      if (c === " " || c === "\t" || c === "\r" || c === "\n") {
        this.pos++;
        continue;
      }
      if (c === "#") {
        // line comment — skip to end of line (never inside a string/class, since
        // those are consumed whole by their own parsers)
        while (this.pos < this.src.length && this.src[this.pos] !== "\n") this.pos++;
        continue;
      }
      break;
    }
  }

  private expect(s: string): void {
    if (this.src.startsWith(s, this.pos)) {
      this.pos += s.length;
      return;
    }
    fail(`expected "${s}" at position ${this.pos}`);
  }

  private isNameStart(c: string | undefined): boolean {
    return !!c && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z"));
  }

  private isNameChar(c: string | undefined): boolean {
    return !!c && (this.isNameStart(c) || (c >= "0" && c <= "9") || c === "-");
  }

  private parseName(): string {
    this.skipWs();
    if (!this.isNameStart(this.src[this.pos])) fail(`expected a rule name at position ${this.pos}`);
    const start = this.pos;
    this.pos++;
    while (this.isNameChar(this.src[this.pos])) this.pos++;
    return this.src.slice(start, this.pos);
  }

  private parseAlternation(): GNode {
    const options: GNode[] = [this.parseSequence()];
    this.skipWs();
    while (this.src[this.pos] === "|") {
      this.pos++;
      options.push(this.parseSequence());
      this.skipWs();
    }
    return options.length === 1 ? options[0]! : { type: "alt", options };
  }

  private parseSequence(): GNode {
    const items: GNode[] = [];
    while (true) {
      this.skipWs();
      const c = this.src[this.pos];
      if (this.pos >= this.src.length || c === "|" || c === ")") break;
      if (this.atRuleStart()) break; // start of the next `name ::=` rule
      items.push(this.parseElement());
    }
    // An empty sequence (e.g. `( )` or `"a" | `) is the empty match.
    if (items.length === 0) return { type: "lit", value: "" };
    return items.length === 1 ? items[0]! : { type: "seq", items };
  }

  /** Lookahead: are we at the start of a new `name ::=` rule (vs. a reference)? */
  private atRuleStart(): boolean {
    const save = this.pos;
    try {
      if (!this.isNameStart(this.src[this.pos])) return false;
      this.pos++;
      while (this.isNameChar(this.src[this.pos])) this.pos++;
      this.skipWs();
      return this.src.startsWith("::=", this.pos);
    } finally {
      this.pos = save;
    }
  }

  private parseElement(): GNode {
    this.skipWs();
    const c = this.src[this.pos];
    let node: GNode;
    if (c === '"') node = this.parseString();
    else if (c === "[") node = this.parseClass();
    else if (c === "(") {
      this.pos++;
      node = this.parseAlternation();
      this.skipWs();
      this.expect(")");
    } else if (this.isNameStart(c)) {
      node = { type: "ref", name: this.parseName() };
    } else {
      fail(`unexpected character ${JSON.stringify(c ?? "<eof>")} at position ${this.pos}`);
    }
    return this.parsePostfix(node);
  }

  private parsePostfix(node: GNode): GNode {
    const c = this.src[this.pos];
    if (c === "*") {
      this.pos++;
      return { type: "rep", node, min: 0, max: Infinity };
    }
    if (c === "+") {
      this.pos++;
      return { type: "rep", node, min: 1, max: Infinity };
    }
    if (c === "?") {
      this.pos++;
      return { type: "rep", node, min: 0, max: 1 };
    }
    if (c === "{") return this.parseBraceRep(node);
    return node;
  }

  private parseBraceRep(node: GNode): GNode {
    this.pos++; // consume "{"
    const readInt = (): number => {
      const start = this.pos;
      while (this.src[this.pos]! >= "0" && this.src[this.pos]! <= "9") this.pos++;
      if (this.pos === start) fail(`expected a number in {m,n} at position ${this.pos}`);
      return parseInt(this.src.slice(start, this.pos), 10);
    };
    const min = readInt();
    let max = min;
    if (this.src[this.pos] === ",") {
      this.pos++;
      max = this.src[this.pos] === "}" ? Infinity : readInt();
    }
    this.expect("}");
    if (max < min) fail(`repetition {${min},${max}} has max < min`);
    return { type: "rep", node, min, max };
  }

  private parseString(): GNode {
    this.pos++; // opening quote
    let value = "";
    while (this.pos < this.src.length) {
      const c = this.src[this.pos]!;
      if (c === '"') {
        this.pos++;
        return { type: "lit", value };
      }
      if (c === "\\") {
        this.pos++;
        value += String.fromCodePoint(this.readEscape());
        continue;
      }
      value += c;
      this.pos++;
    }
    return fail("unterminated string literal");
  }

  private parseClass(): GNode {
    this.pos++; // "["
    let negated = false;
    if (this.src[this.pos] === "^") {
      negated = true;
      this.pos++;
    }
    const ranges: Array<[number, number]> = [];
    while (this.pos < this.src.length) {
      if (this.src[this.pos] === "]") {
        this.pos++;
        return { type: "class", negated, ranges };
      }
      const lo = this.readClassChar();
      // "a-z" range, but a trailing "-" (before "]") is a literal dash
      if (this.src[this.pos] === "-" && this.src[this.pos + 1] !== "]") {
        this.pos++; // "-"
        const hi = this.readClassChar();
        ranges.push([lo, hi]);
      } else {
        ranges.push([lo, lo]);
      }
    }
    return fail("unterminated character class");
  }

  private readClassChar(): number {
    if (this.src[this.pos] === "\\") {
      this.pos++;
      return this.readEscape();
    }
    const cp = this.src.codePointAt(this.pos)!;
    this.pos += cp > 0xffff ? 2 : 1;
    return cp;
  }

  private readEscape(): number {
    const c = this.src[this.pos];
    this.pos++;
    switch (c) {
      case "n": return 0x0a;
      case "r": return 0x0d;
      case "t": return 0x09;
      case "\\": return 0x5c;
      case '"': return 0x22;
      case "'": return 0x27;
      case "[": return 0x5b;
      case "]": return 0x5d;
      case "-": return 0x2d;
      case "/": return 0x2f;
      case "x": return this.readHex(2);
      case "u": return this.readHex(4);
      case "U": return this.readHex(8);
      default:
        if (c === undefined) return fail("dangling escape at end of grammar");
        return c.codePointAt(0)!; // any other escaped char is that literal char
    }
  }

  private readHex(n: number): number {
    const start = this.pos;
    for (let i = 0; i < n; i++) {
      const c = this.src[this.pos];
      const isHex = !!c && ((c >= "0" && c <= "9") || (c >= "a" && c <= "f") || (c >= "A" && c <= "F"));
      if (!isHex) fail(`expected ${n}-digit hex escape at position ${start}`);
      this.pos++;
    }
    return parseInt(this.src.slice(start, this.pos), 16);
  }
}

// Grammars are small and re-validated across retries — cache the parse.
const parseCache = new Map<string, GbnfGrammar>();

export function parseGbnf(source: string): GbnfGrammar {
  const cached = parseCache.get(source);
  if (cached) return cached;
  const grammar = new GbnfParser(source).parse();
  parseCache.set(source, grammar);
  return grammar;
}

const STEP_BUDGET = 2_000_000;

/**
 * Returns true iff `input` is fully in the language of the grammar's `root`
 * rule. A set-returning matcher (each node yields the set of positions it can
 * end at) — this handles alternation, greedy/backtracking repetition, and
 * optional/right-recursive rules without the entanglement a continuation-passing
 * matcher has, and it detects left recursion cleanly (a left-recursive rule
 * contributes no positions, so it never hangs).
 */
export function matchesGbnf(source: string, input: string): boolean {
  const rules = parseGbnf(source);
  const inProgress = new Set<string>();
  let steps = 0;

  function matchSet(node: GNode, pos: number): Set<number> {
    if (++steps > STEP_BUDGET) {
      throw new Error("GBNF match exceeded step budget — grammar is too ambiguous for this input");
    }

    switch (node.type) {
      case "lit":
        return input.startsWith(node.value, pos) ? new Set([pos + node.value.length]) : new Set();

      case "class": {
        if (pos >= input.length) return new Set();
        const cp = input.codePointAt(pos)!;
        const width = cp > 0xffff ? 2 : 1;
        let inRange = false;
        for (const [lo, hi] of node.ranges) {
          if (cp >= lo && cp <= hi) {
            inRange = true;
            break;
          }
        }
        return inRange !== node.negated ? new Set([pos + width]) : new Set();
      }

      case "ref": {
        const target = rules.get(node.name);
        if (!target) throw new Error(`Invalid GBNF grammar: references undefined rule "${node.name}"`);
        const key = `${node.name}@${pos}`;
        if (inProgress.has(key)) return new Set(); // left recursion at this position — dead end
        inProgress.add(key);
        const out = matchSet(target, pos);
        inProgress.delete(key);
        return out;
      }

      case "seq": {
        let frontier = new Set<number>([pos]);
        for (const item of node.items) {
          const next = new Set<number>();
          for (const p of frontier) for (const np of matchSet(item, p)) next.add(np);
          if (next.size === 0) return next;
          frontier = next;
        }
        return frontier;
      }

      case "alt": {
        const out = new Set<number>();
        for (const opt of node.options) for (const np of matchSet(opt, pos)) out.add(np);
        return out;
      }

      case "rep": {
        // BFS over repetition counts. Positions strictly advance each step (we
        // skip zero-width matches), so this terminates even for unbounded `max`.
        const out = new Set<number>();
        if (node.min === 0) out.add(pos);
        const seen = new Set<number>([pos]);
        let frontier = new Set<number>([pos]);
        let count = 0;
        while (count < node.max && frontier.size > 0) {
          const next = new Set<number>();
          for (const p of frontier) {
            for (const np of matchSet(node.node, p)) {
              if (np === p) continue; // zero-width — cannot make progress
              next.add(np);
            }
          }
          count++;
          if (count >= node.min) for (const np of next) out.add(np);
          frontier = new Set<number>();
          for (const np of next) {
            if (!seen.has(np)) {
              seen.add(np);
              frontier.add(np);
            }
          }
        }
        return out;
      }
    }
  }

  try {
    return matchSet(rules.get("root")!, 0).has(input.length);
  } catch (err) {
    // matchSet recurses through the JS call stack for every rule *reference*
    // (unlike `*`/`+`, which are iterative BFS and never recurse) — a
    // deeply right-recursive rule (`list ::= item "," list | item`) against a
    // long input can exhaust it. Surface a clear, documented failure instead
    // of a raw native RangeError with an unrelated-looking stack trace.
    if (err instanceof RangeError) {
      throw new Error(
        "GBNF grammar recursion is too deep for this input — a right-recursive rule " +
          "(e.g. `list ::= item \",\" list | item`) needs one JS call per repetition. " +
          "Prefer `*`/`+` over recursive rule references for long repeated sequences " +
          "(they're matched iteratively and have no depth limit)."
      );
    }
    throw err;
  }
}

/**
 * System-prompt instruction for backends that cannot apply the grammar at the
 * token level. Embeds the grammar text and asks for a bare conforming string.
 * Parses the grammar as a side effect so an invalid grammar throws here —
 * before any model call — the same fail-fast contract the XML template has.
 */
export function buildGbnfSystemPrompt(schema: GbnfInput): string {
  parseGbnf(schema.gbnf); // validate up front; throws on a malformed grammar
  return (
    `Respond with a single output string that conforms EXACTLY to the following ` +
    `GBNF grammar. Output only that string — no markdown, no code fences, no ` +
    `explanation, no surrounding quotes.\n\nGBNF grammar:\n${schema.gbnf}`
  );
}
