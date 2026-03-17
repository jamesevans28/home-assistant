import { type Tool } from "@github/copilot-sdk";
import { getDatabase } from "../db/database.js";
import {
  createReminder,
  listReminders,
  completeReminder,
} from "../db/repositories/reminderRepo.js";
import {
  createEvent,
  listEvents,
} from "../db/repositories/eventRepo.js";
import {
  addFamilyMember,
  updateFamilyMember,
  removeFamilyMember,
  listFamilyMembers,
  findFamilyMemberByName,
} from "../db/repositories/familyRepo.js";
import { parseNaturalDate, toISOUTC } from "../utils/dateParser.js";
import { formatInTimeZone } from "date-fns-tz";

function getUserTimezone(userId: number): string {
  const db = getDatabase();
  const user = db
    .prepare("SELECT timezone FROM users WHERE id = ?")
    .get(userId) as { timezone: string } | undefined;
  return user?.timezone ?? "Australia/Melbourne";
}

export function createTools(userId: number): Tool[] {
  const timezone = getUserTimezone(userId);

  return [
    {
      name: "create_reminder",
      description:
        "Create a new reminder for the user. Use this when the user asks to be reminded of something.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "What to remind about" },
          due_at: {
            type: "string",
            description: "When the reminder is due. Natural language like 'tomorrow at 3pm' or ISO 8601 format.",
          },
          recurrence: {
            type: "string",
            enum: ["daily", "weekly", "monthly"],
            description: "How often this reminder should repeat",
          },
          family_member: {
            type: "string",
            description: "Name of the family member this reminder is for",
          },
        },
        required: ["title", "due_at"],
      },
      handler: async (args: unknown) => {
        const { title, due_at, recurrence, family_member } = args as {
          title: string;
          due_at: string;
          recurrence?: string;
          family_member?: string;
        };

        let dueDate = parseNaturalDate(due_at, timezone);
        if (!dueDate) {
          dueDate = new Date(due_at);
          if (isNaN(dueDate.getTime())) {
            return `Could not understand the date "${due_at}". Please try again with a clearer time.`;
          }
        }

        let familyMemberId: number | undefined;
        if (family_member) {
          const member = findFamilyMemberByName(userId, family_member);
          if (member) familyMemberId = member.id;
        }

        const reminder = createReminder(userId, title, toISOUTC(dueDate), {
          recurrence,
          familyMemberId,
        });

        const formattedTime = formatInTimeZone(dueDate, timezone, "EEEE d MMM 'at' h:mm a");
        return `Reminder created: "${title}" — due ${formattedTime}${family_member ? ` (for ${family_member})` : ""}${recurrence ? `, repeats ${recurrence}` : ""}. ID: ${reminder.id}`;
      },
    },

    {
      name: "list_reminders",
      description: "List upcoming reminders. Use when the user asks what reminders they have.",
      parameters: {
        type: "object",
        properties: {
          family_member: { type: "string", description: "Filter by family member name" },
          include_completed: { type: "boolean", description: "Whether to include completed reminders" },
        },
      },
      handler: async (args: unknown) => {
        const { family_member, include_completed } = args as {
          family_member?: string;
          include_completed?: boolean;
        };

        let familyMemberId: number | undefined;
        if (family_member) {
          const member = findFamilyMemberByName(userId, family_member);
          if (member) familyMemberId = member.id;
        }

        const reminders = listReminders(userId, {
          familyMemberId,
          includeCompleted: include_completed,
        });

        if (reminders.length === 0) return "No reminders found.";

        return reminders
          .map((r) => {
            const due = formatInTimeZone(
              new Date(r.due_at + "Z"),
              timezone,
              "EEE d MMM, h:mm a"
            );
            const status = r.is_completed ? " [done]" : "";
            return `- [${r.id}] ${r.title} — ${due}${status}`;
          })
          .join("\n");
      },
    },

    {
      name: "complete_reminder",
      description:
        "Mark a reminder as completed. Use when the user says they've done something or wants to dismiss a reminder.",
      parameters: {
        type: "object",
        properties: {
          reminder_id: { type: "number", description: "The ID of the reminder to complete" },
        },
        required: ["reminder_id"],
      },
      handler: async (args: unknown) => {
        const { reminder_id } = args as { reminder_id: number };
        const success = completeReminder(reminder_id, userId);
        return success
          ? `Reminder ${reminder_id} marked as done.`
          : `Could not find reminder ${reminder_id}.`;
      },
    },

    {
      name: "create_event",
      description:
        "Create a calendar event. Use when the user mentions an appointment, meeting, or scheduled activity.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title" },
          start_at: {
            type: "string",
            description: "When the event starts. Natural language or ISO 8601.",
          },
          end_at: { type: "string", description: "When the event ends" },
          location: { type: "string", description: "Where the event takes place" },
          family_member: {
            type: "string",
            description: "Name of the family member this event is for",
          },
        },
        required: ["title", "start_at"],
      },
      handler: async (args: unknown) => {
        const { title, start_at, end_at, location, family_member } = args as {
          title: string;
          start_at: string;
          end_at?: string;
          location?: string;
          family_member?: string;
        };

        let startDate = parseNaturalDate(start_at, timezone);
        if (!startDate) {
          startDate = new Date(start_at);
          if (isNaN(startDate.getTime())) {
            return `Could not understand the date "${start_at}".`;
          }
        }

        let endDateStr: string | undefined;
        if (end_at) {
          let endDate = parseNaturalDate(end_at, timezone);
          if (!endDate) endDate = new Date(end_at);
          if (!isNaN(endDate!.getTime())) endDateStr = toISOUTC(endDate!);
        }

        let familyMemberId: number | undefined;
        if (family_member) {
          const member = findFamilyMemberByName(userId, family_member);
          if (member) familyMemberId = member.id;
        }

        const event = createEvent(userId, title, toISOUTC(startDate), {
          endAt: endDateStr,
          location,
          familyMemberId,
        });

        const formattedTime = formatInTimeZone(startDate, timezone, "EEEE d MMM 'at' h:mm a");
        return `Event created: "${title}" — ${formattedTime}${location ? ` at ${location}` : ""}${family_member ? ` (for ${family_member})` : ""}. ID: ${event.id}`;
      },
    },

    {
      name: "list_events",
      description: "List calendar events. Use when the user asks about their schedule.",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "Date to check, natural language like 'today', 'tomorrow', 'next week'. Defaults to today.",
          },
          family_member: { type: "string", description: "Filter by family member name" },
        },
      },
      handler: async (args: unknown) => {
        const { date, family_member } = args as {
          date?: string;
          family_member?: string;
        };

        const refDate = date ? parseNaturalDate(date, timezone) ?? new Date() : new Date();
        const dayStart = formatInTimeZone(refDate, timezone, "yyyy-MM-dd'T'00:00:00");
        const dayEnd = formatInTimeZone(refDate, timezone, "yyyy-MM-dd'T'23:59:59");

        let familyMemberId: number | undefined;
        if (family_member) {
          const member = findFamilyMemberByName(userId, family_member);
          if (member) familyMemberId = member.id;
        }

        const events = listEvents(userId, {
          fromDate: dayStart,
          toDate: dayEnd,
          familyMemberId,
        });

        if (events.length === 0) {
          const dayLabel = formatInTimeZone(refDate, timezone, "EEEE d MMM");
          return `No events scheduled for ${dayLabel}.`;
        }

        return events
          .map((e) => {
            const time = formatInTimeZone(
              new Date(e.start_at + "Z"),
              timezone,
              "h:mm a"
            );
            let line = `- [${e.id}] ${time}: ${e.title}`;
            if (e.location) line += ` (${e.location})`;
            return line;
          })
          .join("\n");
      },
    },

    {
      name: "manage_family",
      description:
        "Add, update, or remove a family member. Use when the user wants to manage their family list.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["add", "update", "remove"],
            description: "What to do",
          },
          name: { type: "string", description: "Family member name" },
          relationship: {
            type: "string",
            description: "Relationship (spouse, child, parent, etc.)",
          },
          age: { type: "number", description: "Age" },
          notes: { type: "string", description: "Any notes about this person" },
        },
        required: ["action", "name"],
      },
      handler: async (args: unknown) => {
        const { action, name, relationship, age, notes } = args as {
          action: "add" | "update" | "remove";
          name: string;
          relationship?: string;
          age?: number;
          notes?: string;
        };

        if (action === "add") {
          const member = addFamilyMember(userId, name, { relationship, age, notes });
          return `Added ${name}${relationship ? ` (${relationship})` : ""}${age ? `, age ${age}` : ""} to your family. ID: ${member.id}`;
        }

        if (action === "update") {
          const existing = findFamilyMemberByName(userId, name);
          if (!existing) return `Could not find family member "${name}".`;
          updateFamilyMember(existing.id, userId, { relationship, age, notes });
          return `Updated ${name}'s info.`;
        }

        if (action === "remove") {
          const existing = findFamilyMemberByName(userId, name);
          if (!existing) return `Could not find family member "${name}".`;
          removeFamilyMember(existing.id, userId);
          return `Removed ${name} from your family list.`;
        }

        return "Unknown action.";
      },
    },

    {
      name: "get_suggestion",
      description:
        "Generate a suggestion for the user. Use when they ask for ideas about meals, activities, chores, or general life tips.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["meal", "activity", "chore", "general"],
            description: "What kind of suggestion",
          },
        },
        required: ["category"],
      },
      handler: async (args: unknown) => {
        const { category } = args as { category: string };
        const family = listFamilyMembers(userId);
        const familyInfo =
          family.length > 0
            ? `Family: ${family.map((f) => `${f.name} (${f.relationship ?? "member"}${f.age ? `, ${f.age}` : ""})`).join(", ")}`
            : "No family members registered.";

        return `Please generate a ${category} suggestion for this family. ${familyInfo}. Consider the day of the week and time of year.`;
      },
    },
  ];
}
