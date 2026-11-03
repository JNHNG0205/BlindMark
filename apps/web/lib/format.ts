export function pct(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

/** `*_ns` fields are decimal strings. */
export function nsToDate(ns: string): Date {
  return new Date(Number(BigInt(ns) / 1_000_000n));
}

export function formatDate(ns: string): string {
  return nsToDate(ns).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

/** Compact age such as "3h 12m" or "4d 2h", from a `*_ns` decimal string. */
export function timeAgo(ns: string, nowMs: number): string {
  const minutes = Math.max(
    0,
    Math.floor((nowMs - nsToDate(ns).getTime()) / 60_000),
  );
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
