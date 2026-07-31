export const DEFAULT_CALLSIGN = "PULSE";

/**
 * Produces the exact callsign alphabet accepted by the verified leaderboard.
 * NFKD keeps common accented Latin input friendly while the ASCII allow-list
 * prevents control characters, confusables, markup, and bidi surprises.
 */
export const sanitizeCallsign = (value: unknown): string => {
  if (typeof value !== "string" || value.length > 64) return DEFAULT_CALLSIGN;
  const callsign = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "")
    .slice(0, 12);
  return callsign.length >= 3 ? callsign : DEFAULT_CALLSIGN;
};
