export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Percentage helper. Returns null when the denominator is zero or missing. */
export function percent(numerator, denominator, digits = 1) {
  if (!denominator || Number(denominator) <= 0) return null;
  const factor = 10 ** digits;
  return Math.round((Number(numerator) / Number(denominator)) * 100 * factor) / factor;
}
