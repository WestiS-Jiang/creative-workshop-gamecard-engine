type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (Array.isArray(base)) {
    if (Array.isArray(patch)) {
      return patch as T;
    }
    return base;
  }

  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return (patch as T) ?? base;
  }

  const out: PlainObject = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }

    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key] as PlainObject, value);
      continue;
    }

    out[key] = value;
  }

  return out as T;
}

