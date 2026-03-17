import * as chrono from "chrono-node";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

export function parseNaturalDate(
  text: string,
  timezone: string,
  referenceDate?: Date
): Date | null {
  // Convert "now" to the user's local wall-clock time so chrono resolves
  // relative day names (e.g. "Thursday") against the correct local date.
  const ref = referenceDate ?? toZonedTime(new Date(), timezone);
  const results = chrono.parse(text, ref, { forwardDate: true });

  if (results.length === 0) return null;

  const parsed = results[0].start.date();

  // chrono parses in local time; convert from user's timezone to UTC
  return fromZonedTime(parsed, timezone);
}

export function toISOUTC(date: Date): string {
  return date.toISOString().replace("Z", "").slice(0, 19);
}
