import { calendar_v3, calendar } from "@googleapis/calendar";
import { getOAuth2Client, isGoogleAuthenticated } from "./auth.js";
import { formatInTimeZone } from "date-fns-tz";

function getCalendar(): calendar_v3.Calendar {
  return calendar({ version: "v3", auth: getOAuth2Client() });
}

export async function listGoogleEvents(
  timeMin: string,
  timeMax: string,
  maxResults = 20
): Promise<calendar_v3.Schema$Event[]> {
  if (!isGoogleAuthenticated()) return [];

  const calendar = getCalendar();

  // Fetch all calendars the user has access to (owned + shared)
  const calList = await calendar.calendarList.list();
  const calendars = calList.data.items ?? [];

  const allEvents: calendar_v3.Schema$Event[] = [];

  for (const cal of calendars) {
    if (!cal.id) continue;
    const response = await calendar.events.list({
      calendarId: cal.id,
      timeMin,
      timeMax,
      maxResults,
      singleEvents: true,
      orderBy: "startTime",
    });
    allEvents.push(...(response.data.items ?? []));
  }

  // Sort all events by start time
  allEvents.sort((a, b) => {
    const aStart = a.start?.dateTime ?? a.start?.date ?? "";
    const bStart = b.start?.dateTime ?? b.start?.date ?? "";
    return aStart.localeCompare(bStart);
  });

  return allEvents.slice(0, maxResults);
}

export async function createGoogleEvent(
  title: string,
  startTime: Date,
  endTime: Date,
  opts?: { description?: string; location?: string; timezone?: string }
): Promise<calendar_v3.Schema$Event> {
  if (!isGoogleAuthenticated()) {
    throw new Error("Google not authenticated. Use /google to connect.");
  }

  const calendar = getCalendar();
  const tz = opts?.timezone ?? "Australia/Melbourne";

  const response = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: title,
      description: opts?.description,
      location: opts?.location,
      start: { dateTime: startTime.toISOString(), timeZone: tz },
      end: { dateTime: endTime.toISOString(), timeZone: tz },
    },
  });

  return response.data;
}

export async function deleteGoogleEvent(eventId: string): Promise<void> {
  if (!isGoogleAuthenticated()) {
    throw new Error("Google not authenticated. Use /google to connect.");
  }

  const calendar = getCalendar();
  await calendar.events.delete({
    calendarId: "primary",
    eventId,
  });
}

export function formatGoogleEvent(
  event: calendar_v3.Schema$Event,
  timezone: string
): string {
  const start = event.start?.dateTime ?? event.start?.date;
  const title = event.summary ?? "(no title)";

  if (!start) return `- ${title}`;

  const isAllDay = !event.start?.dateTime;
  if (isAllDay) {
    return `- All day: ${title}${event.location ? ` (${event.location})` : ""}`;
  }

  const time = formatInTimeZone(new Date(start), timezone, "h:mm a");
  return `- ${time}: ${title}${event.location ? ` (${event.location})` : ""}`;
}
