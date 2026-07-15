/** Compact relative time, e.g. "3h", "2d", "Jul 4". */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** 1200 -> "1.2k". */
export function compact(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0)}k`;
}
