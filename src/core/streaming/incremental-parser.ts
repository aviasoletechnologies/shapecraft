/**
 * Scans a growing JSON buffer for top-level object fields whose value has
 * fully closed syntactically (string/number/bool/null terminated, or a
 * nested object/array's matching bracket reached at depth 0), and returns
 * their raw JSON text. Fields still being written are skipped - they'll show
 * up on a later call once complete. Only understands an object at the root;
 * any other root shape (array, XML, plain string) returns {} immediately,
 * which is the correct "not applicable" result for those schema types.
 *
 * This gives field-level completion boundaries without a full recursive
 * parse - nested content inside a field's value is treated as an opaque
 * blob (validated as a whole once that field closes), not decomposed further.
 */
export function extractCompletedTopLevelFields(buffer: string): Record<string, string> {
  const result: Record<string, string> = {};
  const n = buffer.length;
  let i = 0;

  const skipWs = () => {
    while (i < n && /\s/.test(buffer[i]!)) i++;
  };

  // Find the first '{' anywhere, not just at position 0 - a best-effort backend
  // may wrap the object in prose or a ```json fence (the same tolerance the
  // final extractJson step already applies). A stray '{' in unrelated prose
  // is harmless: the very next check requires a '"' key start immediately
  // after it, which ordinary text won't satisfy, so scanning just yields {}.
  const braceIndex = buffer.indexOf("{");
  if (braceIndex === -1) return result;
  i = braceIndex + 1;

  while (i < n) {
    skipWs();
    if (i >= n || buffer[i] === "}") break;
    if (buffer[i] !== '"') break; // not at a key start -> nothing more is complete yet

    const keyStart = i;
    i++;
    let escaped = false;
    while (i < n) {
      if (buffer[i] === "\\" && !escaped) {
        escaped = true;
        i++;
        continue;
      }
      if (buffer[i] === '"' && !escaped) break;
      escaped = false;
      i++;
    }
    if (i >= n) break; // key string not yet closed
    const keyEnd = i;
    i++;
    const key = JSON.parse(buffer.slice(keyStart, keyEnd + 1)) as string;

    skipWs();
    if (buffer[i] !== ":") break; // colon not yet written
    i++;
    skipWs();
    if (i >= n) break;

    const valueStart = i;
    let valueEnd = -1;

    if (buffer[i] === '"') {
      i++;
      let esc = false;
      let closed = false;
      while (i < n) {
        if (buffer[i] === "\\" && !esc) {
          esc = true;
          i++;
          continue;
        }
        if (buffer[i] === '"' && !esc) {
          closed = true;
          i++;
          break;
        }
        esc = false;
        i++;
      }
      if (!closed) break;
      valueEnd = i;
    } else if (buffer[i] === "{" || buffer[i] === "[") {
      const open = buffer[i];
      const close = open === "{" ? "}" : "]";
      let depth = 0;
      let esc = false;
      let inStr = false;
      let closed = false;
      while (i < n) {
        const c = buffer[i];
        if (inStr) {
          if (c === "\\" && !esc) {
            esc = true;
            i++;
            continue;
          }
          if (c === '"' && !esc) inStr = false;
          esc = false;
          i++;
          continue;
        }
        if (c === '"') {
          inStr = true;
          i++;
          continue;
        }
        if (c === open) depth++;
        else if (c === close) {
          depth--;
          if (depth === 0) {
            i++;
            closed = true;
            break;
          }
        }
        i++;
      }
      if (!closed) break;
      valueEnd = i;
    } else {
      // number / true / false / null - needs a terminator to be sure it's
      // not still growing (e.g. "3" could still become "30").
      while (i < n && !/[,}\s]/.test(buffer[i]!)) i++;
      if (i >= n) break;
      valueEnd = i;
    }

    result[key] = buffer.slice(valueStart, valueEnd);

    skipWs();
    if (buffer[i] === ",") {
      i++;
      continue;
    }
    break; // "}" (object done) or anything else - stop scanning this pass
  }

  return result;
}

export interface CompletedField {
  key: string;
  value: unknown;
}

/**
 * Incremental Parser stage: accumulates raw text deltas from the tokenizer
 * and surfaces each newly-closed top-level field exactly once, already
 * parsed to a JS value. One instance per stream attempt - a fresh instance
 * is created for each retry, so a field seen on a failed attempt is not
 * treated as "already seen" on the next.
 */
export class IncrementalParser {
  private buffer = "";
  private seenKeys = new Set<string>();

  /** Feed the next raw text delta; returns fields that closed for the first time. */
  feed(delta: string): CompletedField[] {
    this.buffer += delta;
    const completed = extractCompletedTopLevelFields(this.buffer);
    const newlyCompleted: CompletedField[] = [];

    for (const [key, raw] of Object.entries(completed)) {
      if (this.seenKeys.has(key)) continue;
      this.seenKeys.add(key);
      try {
        newlyCompleted.push({ key, value: JSON.parse(raw) });
      } catch {
        // shouldn't happen - the scanner only returns syntactically closed values
      }
    }

    return newlyCompleted;
  }

  /** Full accumulated text so far (all deltas fed, in order). */
  get text(): string {
    return this.buffer;
  }
}
