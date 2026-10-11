/** "Oct 10, 5:10 pm": local time, no seconds, no year. */
export function shortDateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("hour")}:${get("minute")} ${get("dayPeriod").toLowerCase()}`;
}
