export function getByPath(source: unknown, path: string): unknown {
  if (!path.trim()) return undefined;

  const parts = path.split(".").map((part) => part.trim()).filter(Boolean);
  let cursor: unknown = source;

  for (const part of parts) {
    if (cursor === null || cursor === undefined) return undefined;

    if (Array.isArray(cursor)) {
      const idx = Number(part);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cursor.length) return undefined;
      cursor = cursor[idx];
      continue;
    }

    if (typeof cursor !== "object") return undefined;

    cursor = (cursor as Record<string, unknown>)[part];
  }

  return cursor;
}
