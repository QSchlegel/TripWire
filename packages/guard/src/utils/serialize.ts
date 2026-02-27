function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = sortValue(record[key]);
    }
    return out;
  }

  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sanitizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[0-9]+/g, "#")
    .replace(/\b[a-f0-9]{12,}\b/g, "hex")
    .replace(/\s+/g, " ")
    .trim();
}

function inferType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

export function argShapeSignature(value: unknown): string {
  if (!value || typeof value !== "object") {
    return inferType(value);
  }

  if (Array.isArray(value)) {
    const member = value.length === 0 ? "empty" : argShapeSignature(value[0]);
    return `array<${member}>`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return keys
    .map((key) => `${key}:${argShapeSignature(obj[key])}`)
    .join("|");
}
