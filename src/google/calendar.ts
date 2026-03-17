import { google, calendar_v3 } from "googleapis";
import { getOAuth2Client, isGoogleAuthenticated } from "./auth.js";
import { formatInTimeZone } from "date-fns-tz";

function getCalendar(): calendar_v3.Calendar {
  return google.calendar({ version: "v3", auth: getOAuth2Client() });
}

export async function listGoogleEvents(
  timeMin: string,
  timeMax: string,
  maxResults = 20
): Promise<calendar_v3.Schema$Event[]> {
  if (!isGoogleAuthenticated()) return [];

  const calendar = getCalendar();
  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin,
    timeMax,
    maxResults,
    singleEvents: true,
    orderBy: "startTime",
  });

  return response.data.items ?? [];
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
