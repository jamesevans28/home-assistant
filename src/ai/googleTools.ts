import { type Tool } from "@github/copilot-sdk";
import { isGoogleAuthenticated } from "../google/auth.js";
import {
  listGoogleEvents,
  createGoogleEvent,
  deleteGoogleEvent,
  formatGoogleEvent,
} from "../google/calendar.js";
import {
  listEmails,
  getEmailBody,
  sendEmail,
  searchEmails,
} from "../google/gmail.js";
import { parseNaturalDate, toISOUTC } from "../utils/dateParser.js";
import { formatInTimeZone } from "date-fns-tz";
import { addHours } from "date-fns";

export function createGoogleTools(userId: number, timezone: string): Tool[] {
  return [
    {
      name: "google_calendar_list",
      description:
        "List events from the user's Google Calendar. Use when they ask about their real calendar, schedule, or appointments.",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description:
              "Date to check, natural language like 'today', 'tomorrow', 'this week'. Defaults to today.",
          },
          days: {
            type: "number",
            description: "Number of days to look ahead. Default 1.",
          },
        },
      },
      handler: async (args: unknown) => {
        if (!isGoogleAuthenticated()) {
          return "Google Calendar is not connected. Ask the user to run /google to connect their account.";
        }

        const { date, days = 1 } = args as { date?: string; days?: number };
        const refDate = date
          ? parseNaturalDate(date, timezone) ?? new Date()
          : new Date();

        const timeMin = formatInTimeZone(
          refDate,
          timezone,
          "yyyy-MM-dd'T'00:00:00xxx"
        );
        const endDate = new Date(refDate.getTime() + days * 86400000);
        const timeMax = formatInTimeZone(
          endDate,
          timezone,
          "yyyy-MM-dd'T'23:59:59xxx"
        );

        const events = await listGoogleEvents(timeMin, timeMax);

        if (events.length === 0) {
          const label = formatInTimeZone(refDate, timezone, "EEEE d MMM");
          return `No events on Google Calendar for ${label}.`;
        }

        const formatted = events
          .map((e) => formatGoogleEvent(e, timezone))
          .join("\n");

        const label = formatInTimeZone(refDate, timezone, "EEEE d MMM");
        return `Google Calendar for ${label}${days > 1 ? ` (next ${days} days)` : ""}:\n${formatted}`;
      },
    },

    {
      name: "google_calendar_create",
      description:
        "Create an event on the user's Google Calendar. Use when they want to add something to their real calendar.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title" },
          start_at: {
            type: "string",
            description: "When it starts. Natural language or ISO 8601.",
          },
          duration_hours: {
            type: "number",
            description: "Duration in hours. Default 1.",
          },
          location: { type: "string", description: "Location" },
          description: { type: "string", description: "Event description" },
        },
        required: ["title", "start_at"],
      },
      handler: async (args: unknown) => {
        if (!isGoogleAuthenticated()) {
          return "Google Calendar is not connected. Ask the user to run /google to connect their account.";
        }

        const {
          title,
          start_at,
          duration_hours = 1,
          location,
          description,
        } = args as {
          title: string;
          start_at: string;
          duration_hours?: number;
          location?: string;
          description?: string;
        };

        let startDate = parseNaturalDate(start_at, timezone);
        if (!startDate) {
          startDate = new Date(start_at);
          if (isNaN(startDate.getTime())) {
            return `Could not understand the date "${start_at}".`;
          }
        }

        const endDate = addHours(startDate, duration_hours);

        const event = await createGoogleEvent(title, startDate, endDate, {
          location,
          description,
          timezone,
        });

        const formattedTime = formatInTimeZone(
          startDate,
          timezone,
          "EEEE d MMM 'at' h:mm a"
        );
        return `Added to Google Calendar: "${title}" — ${formattedTime}${location ? ` at ${location}` : ""}`;
      },
    },

    {
      name: "google_calendar_delete",
      description: "Delete an event from Google Calendar by its ID.",
      parameters: {
        type: "object",
        properties: {
          event_id: {
            type: "string",
            description: "The Google Calendar event ID",
          },
        },
        required: ["event_id"],
      },
      handler: async (args: unknown) => {
        if (!isGoogleAuthenticated()) {
          return "Google Calendar is not connected.";
        }

        const { event_id } = args as { event_id: string };
        await deleteGoogleEvent(event_id);
        return `Event deleted from Google Calendar.`;
      },
    },

    {
      name: "gmail_list",
      description:
        "List recent emails from the user's Gmail inbox. Use when they ask to check email.",
      parameters: {
        type: "object",
        properties: {
          count: {
            type: "number",
            description: "Number of emails to show. Default 5.",
          },
          query: {
            type: "string",
            description:
              "Gmail search query, e.g. 'from:boss@company.com', 'is:unread', 'subject:invoice'",
          },
        },
      },
      handler: async (args: unknown) => {
        if (!isGoogleAuthenticated()) {
          return "Gmail is not connected. Ask the user to run /google to connect their account.";
        }

        const { count = 5, query = "" } = args as {
          count?: number;
          query?: string;
        };

        const emails = await listEmails(count, query);

        if (emails.length === 0) {
          return query ? `No emails matching "${query}".` : "No recent emails.";
        }

        return emails
          .map((e, i) => {
            const unread = e.unread ? " [NEW]" : "";
            return `${i + 1}. ${e.subject}${unread}\n   From: ${e.from}\n   ${e.snippet.slice(0, 100)}...`;
          })
          .join("\n\n");
      },
    },

    {
      name: "gmail_read",
      description: "Read the full body of a specific email by its ID.",
      parameters: {
        type: "object",
        properties: {
          message_id: {
            type: "string",
            description: "The Gmail message ID to read",
          },
        },
        required: ["message_id"],
      },
      handler: async (args: unknown) => {
        if (!isGoogleAuthenticated()) {
          return "Gmail is not connected.";
        }

        const { message_id } = args as { message_id: string };
        const body = await getEmailBody(message_id);
        // Truncate very long emails
        return body.length > 3000
          ? body.slice(0, 3000) + "\n\n[...truncated]"
          : body;
      },
    },

    {
      name: "gmail_send",
      description:
        "Send an email via Gmail. Use when the user asks to send or compose an email.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject" },
          body: { type: "string", description: "Email body text" },
        },
        required: ["to", "subject", "body"],
      },
      handler: async (args: unknown) => {
        const { to, subject, body } = args as {
          to: string;
          subject: string;
          body: string;
        };

        if (!isGoogleAuthenticated()) {
          return "Gmail is not connected. Ask the user to run /google to connect their account.";
        }

        const messageId = await sendEmail(to, subject, body);
        return `Email sent to ${to} with subject "${subject}". Message ID: ${messageId}`;
      },
    },

    {
      name: "gmail_search",
      description:
        "Search emails in Gmail. Use Gmail search syntax like 'from:', 'to:', 'subject:', 'is:unread', 'has:attachment'.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Gmail search query",
          },
          count: {
            type: "number",
            description: "Max results. Default 5.",
          },
        },
        required: ["query"],
      },
      handler: async (args: unknown) => {
        if (!isGoogleAuthenticated()) {
          return "Gmail is not connected.";
        }

        const { query, count = 5 } = args as {
          query: string;
          count?: number;
        };

        const emails = await searchEmails(query, count);

        if (emails.length === 0) {
          return `No emails found for "${query}".`;
        }

        return emails
          .map((e, i) => {
            const unread = e.unread ? " [NEW]" : "";
            return `${i + 1}. ${e.subject}${unread}\n   From: ${e.from}\n   ${e.snippet.slice(0, 100)}...`;
          })
          .join("\n\n");
      },
    },
  ];
}
