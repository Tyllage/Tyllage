const toCamel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

/** Converts a DB row's snake_case keys to camelCase for API responses (shallow). */
export function camelize(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
  return out;
}

export const camelizeAll = (rows) => rows.map(camelize);
