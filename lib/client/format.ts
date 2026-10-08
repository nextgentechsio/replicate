// --------------------------------------------------
// DISPLAY FORMATTING (browser only)
// --------------------------------------------------

const SAME_YEAR = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

const OTHER_YEAR = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

// "8 Oct, 12:25 pm" (year only when it isn't this year);
// month names avoid the 10/8 vs 8/10 ambiguity
export function formatDateTime(value: string | Date): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "—";

  return (
    date.getFullYear() === new Date().getFullYear()
      ? SAME_YEAR
      : OTHER_YEAR
  ).format(date);
}

export function formatDuration(seconds: number | null | undefined) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "—";

  return seconds < 60
    ? `${seconds.toFixed(1)}s`
    : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
