import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Parse a timestamp string to Date, fixing UTC issues with backend timestamps */
export function parseTimestamp(timestamp: string | number): Date {
  if (typeof timestamp === "number") return new Date(timestamp);
  let ts = timestamp;
  if (ts.includes("T") && !/[Z+-]/.test(ts.slice(-6))) {
    ts = ts + "Z";
  } else if (!ts.includes("T")) {
    ts = ts.replace(" ", "T") + "Z";
  }
  return new Date(ts);
}

/** Extract character fields from raw unparsed JSON */
export function extractCharacterFromRaw<T extends Record<string, unknown>>(data: T | undefined): T | undefined {
  if (!data) return undefined;

  // If data is already parsed, return as-is
  if (data.inner_thoughts || data.action || data.dialogue) {
    return data;
  }

  // Check for raw field that needs parsing
  const raw = data.raw as string | undefined;
  if (!raw || typeof raw !== "string") return data;

  const extracted: Record<string, unknown> = { ...data };

  try {
    let text = raw;
    if (text.includes("```json")) text = text.split("```json")[1] || text;
    if (text.includes("```")) text = text.split("```")[0] || text;

    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last !== -1) {
      let jsonStr = text.slice(first, last + 1);
      try {
        const parsed = JSON.parse(jsonStr);
        Object.assign(extracted, parsed);
      } catch {
        // LLM sometimes outputs unescaped quotes inside values — try fixing
        const fields = ["inner_thoughts", "action", "dialogue", "emotional_state", "desires_update"];
        const fieldPattern = fields.join("|");
        const fixed = jsonStr.replace(
          new RegExp(`("(?:${fieldPattern})":\\s*")(.*?)("\\s*[,}])`, "gs"),
          (_m, pre, content, post) => pre + content.replace(/"/g, '\\"') + post,
        );
        const parsed = JSON.parse(fixed);
        Object.assign(extracted, parsed);
      }
    }
  } catch {
    // Regex fallback — use greedy match between field boundaries
    const fields = ["inner_thoughts", "action", "dialogue", "emotional_state", "desires_update"];
    const fieldPattern = fields.join("|");
    const extractField = (field: string): string | undefined => {
      // Match from field to next field or closing brace
      const pattern = new RegExp(`"${field}"\\s*:\\s*"(.*?)"\\s*(?:,\\s*"(?:${fieldPattern})"|})`,"s");
      const match = raw.match(pattern);
      if (match?.[1]) {
        return match[1]
          .replace(/\\n/g, "\n")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
      }
      return undefined;
    };
    for (const field of fields) {
      const val = extractField(field);
      if (val) (extracted as Record<string, unknown>)[field] = val;
    }
  }

  return extracted as T;
}
