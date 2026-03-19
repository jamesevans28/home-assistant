import { formatInTimeZone } from "date-fns-tz";
import { getConfig } from "../config.js";

const QUIET_START = 22; // 10pm
const QUIET_END = 6; // 6am

/**
 * Returns true if the current time is within quiet hours (10pm–6am)
 * in the configured timezone.
 */
export function isQuietHours(now = new Date()): boolean {
  const config = getConfig();
  const hour = parseInt(
    formatInTimeZone(now, config.DEFAULT_TIMEZONE, "H"),
    10
  );
  return hour >= QUIET_START || hour < QUIET_END;
}
