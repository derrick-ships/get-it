/**
 * Lenient JSON extraction shared by every provider. Models occasionally
 * wrap structured output in markdown fences or add a stray prose line; we
 * strip fences, and as a last resort slice from the first `{`/`[` to the
 * matching last `}`/`]`. Throws if nothing parses (the caller retries once).
 */
export function parseJsonLoose<T>(raw: string | undefined): T {
  const text = raw?.trim();
  if (!text) throw new Error("Empty response from model");

  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Fall back to the outermost JSON object/array in the text.
    const firstObj = cleaned.indexOf("{");
    const firstArr = cleaned.indexOf("[");
    const start =
      firstObj === -1
        ? firstArr
        : firstArr === -1
          ? firstObj
          : Math.min(firstObj, firstArr);
    if (start >= 0) {
      const lastObj = cleaned.lastIndexOf("}");
      const lastArr = cleaned.lastIndexOf("]");
      const end = Math.max(lastObj, lastArr);
      if (end > start) {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      }
    }
    throw new Error("Model did not return valid JSON");
  }
}
