import type { z } from "zod";

/**
 * Scans `text` for every top-level balanced `{ ... }` object, tolerating
 * markdown code fences, interleaved prose, and multiple candidate blocks
 * (models sometimes "think out loud" and emit several JSON drafts before a
 * final one). String literals and escapes are respected so braces inside
 * strings don't throw off brace-matching.
 */
export function findJsonObjects(text: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }

    if (c === '"') {
      inString = true;
    } else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) {
          objects.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }

  return objects;
}

/**
 * Returns the LAST JSON object in `text` that both parses and matches `schema`,
 * or `null` if none do. "Last" because when a model emits multiple drafts, the
 * final block is its finalized answer.
 */
export function parseLastValidJson<S extends z.ZodTypeAny>(
  text: string,
  schema: S,
): z.infer<S> | null {
  let match: z.infer<S> | null = null;
  for (const candidate of findJsonObjects(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const result = schema.safeParse(parsed);
    if (result.success) match = result.data;
  }
  return match;
}
