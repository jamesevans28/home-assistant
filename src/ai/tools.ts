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
  getProfile,
  updateProfile,
  type ProfileData,
} from "../db/repositories/familyRepo.js";
import {
  addShoppingItem,
  listShoppingItems,
  removeShoppingItemByName,
  clearShoppingList,
} from "../db/repositories/shoppingRepo.js";
import {
  addMeal,
  updateMeal,
  removeMeal,
  findMealByName,
  logMeal,
  getMealHistory,
  getMealsWithLastCooked,
} from "../db/repositories/mealRepo.js";
import {
  createTask,
  listTasks,
  completeTask,
} from "../db/repositories/taskRepo.js";
import {
  searchSchoolEmails,
  listRecentSchoolEmails,
} from "../db/repositories/schoolEmailRepo.js";
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
        `Manage family members, friends, and their profiles. IMPORTANT: Whenever you learn personal info about someone from conversation (favourite food, coffee order, hobbies, goals, fears, fun facts, etc.), PROACTIVELY save it using action="update" with the profile parameter. This builds up a rich profile that makes your responses more personal.
Actions: add, update, remove, list, profile (view full profile).`,
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["add", "update", "remove", "list", "profile"],
            description: "What to do. Use 'profile' to view someone's full profile.",
          },
          name: { type: "string", description: "Person's name" },
          relationship: {
            type: "string",
            description: "Relationship to you — e.g. 'friend', 'spouse', 'child', 'parent', 'sibling', 'colleague'. Friends get private birthday reminders; family get group chat announcements.",
          },
          age: { type: "number", description: "Age" },
          date_of_birth: {
            type: "string",
            description: "Date of birth in YYYY-MM-DD format",
          },
          interests: {
            type: "string",
            description: "Comma-separated interests and hobbies (e.g. 'soccer, lego, dinosaurs')",
          },
          dietary: {
            type: "string",
            description: "Dietary preferences or requirements (e.g. 'vegetarian', 'no dairy')",
          },
          allergies: {
            type: "string",
            description: "Known allergies (e.g. 'peanuts, penicillin')",
          },
          school_or_work: {
            type: "string",
            description: "School, childcare, or workplace name",
          },
          medical_notes: {
            type: "string",
            description: "Relevant medical info (e.g. 'asthma - uses blue inhaler')",
          },
          favourite_teams: {
            type: "string",
            description: "Comma-separated favourite sports teams (e.g. 'Collingwood, Melbourne City FC, Red Bull Racing'). Used for game day alerts and morning digest sports section.",
          },
          telegram_id: {
            type: "number",
            description: "The person's Telegram user ID (numeric). Link a family member to their Telegram account so Susie knows who they are in the group chat.",
          },
          notes: { type: "string", description: "Any other notes about this person" },
          profile: {
            type: "object",
            description: "Extended profile data to save. Use this to store ANY personal info learned from conversation: favourite_colour, favourite_food, favourite_movie, favourite_book, favourite_music, favourite_tv_shows, favourite_restaurant, love_language, personality_type, morning_person_or_night_owl, comfort_food, go_to_drink, go_to_snack, current_goals, dreams, bucket_list, stressors, hobbies_active, skills, learning, best_friends, social_preferences, job_title, work_schedule, exercise_routine, sleep_schedule, anniversary, important_dates, shoe_size, clothing_size, best_friends_at_school, after_school_activities, pet_peeves, quirks, fun_facts, gift_ideas, wish_list, recent_wins, holiday_destination_dream, last_holiday, guilty_pleasure, hidden_talent, childhood_memory, proudest_moment, biggest_fear, superpower_choice, ideal_weekend, favourite_season, cooking_specialty, takeaway_order, or any other key you think is relevant.",
          },
        },
        required: ["action", "name"],
      },
      handler: async (args: unknown) => {
        const { action, name, relationship, age, notes, date_of_birth, interests, dietary, allergies, school_or_work, medical_notes, favourite_teams, telegram_id, profile } = args as {
          action: "add" | "update" | "remove" | "list" | "profile";
          name: string;
          relationship?: string;
          age?: number;
          notes?: string;
          date_of_birth?: string;
          interests?: string;
          dietary?: string;
          allergies?: string;
          school_or_work?: string;
          medical_notes?: string;
          favourite_teams?: string;
          telegram_id?: number;
          profile?: ProfileData;
        };

        const opts = { relationship, age, notes, date_of_birth, interests, dietary, allergies, school_or_work, medical_notes, favourite_teams, telegram_id };

        if (action === "list") {
          const all = listFamilyMembers(userId);
          if (all.length === 0) return "No family members or friends saved yet.";
          return all
            .map((m) => {
              const parts = [`${m.name} (${m.relationship ?? "family"}${m.age ? `, ${m.age}` : ""})`];
              if (m.date_of_birth) parts.push(`DOB: ${m.date_of_birth}`);
              if (m.interests) parts.push(`interests: ${m.interests}`);
              if (m.favourite_teams) parts.push(`teams: ${m.favourite_teams}`);
              if (m.telegram_id) parts.push(`telegram: ${m.telegram_id}`);
              return parts.join(" — ");
            })
            .join("\n");
        }

        if (action === "profile") {
          const existing = findFamilyMemberByName(userId, name);
          if (!existing) return `Could not find "${name}".`;
          const profileData = getProfile(existing.id);
          const entries = Object.entries(profileData).filter(([, v]) => v != null && v !== "");
          const basicInfo = [
            existing.relationship && `Relationship: ${existing.relationship}`,
            existing.age && `Age: ${existing.age}`,
            existing.date_of_birth && `DOB: ${existing.date_of_birth}`,
            existing.interests && `Interests: ${existing.interests}`,
            existing.dietary && `Dietary: ${existing.dietary}`,
            existing.allergies && `Allergies: ${existing.allergies}`,
            existing.school_or_work && `School/Work: ${existing.school_or_work}`,
            existing.favourite_teams && `Teams: ${existing.favourite_teams}`,
          ].filter(Boolean);

          let result = `Profile for ${existing.name}:\n`;
          if (basicInfo.length > 0) result += basicInfo.join("\n") + "\n";
          if (entries.length > 0) {
            result += "\nExtended profile:\n" + entries
              .map(([k, v]) => `• ${k.replace(/_/g, " ")}: ${Array.isArray(v) ? v.join(", ") : v}`)
              .join("\n");
          } else {
            result += "\nNo extended profile data yet.";
          }
          return result;
        }

        if (action === "add") {
          const member = addFamilyMember(userId, name, opts);
          if (profile) updateProfile(member.id, userId, profile);
          return `Added ${name}${relationship ? ` (${relationship})` : ""}${age ? `, age ${age}` : ""} to your family. ID: ${member.id}`;
        }

        if (action === "update") {
          const existing = findFamilyMemberByName(userId, name);
          if (!existing) return `Could not find family member "${name}".`;
          updateFamilyMember(existing.id, userId, opts);
          if (profile) updateProfile(existing.id, userId, profile);
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
            ? `Family: ${family.map((f) => {
                const parts = [`${f.name} (${f.relationship ?? "member"}${f.age ? `, ${f.age}` : ""})`];
                if (f.interests) parts.push(`interests: ${f.interests}`);
                if (f.dietary) parts.push(`dietary: ${f.dietary}`);
                if (f.allergies) parts.push(`allergies: ${f.allergies}`);
                return parts.join(" — ");
              }).join("; ")}`
            : "No family members registered.";

        return `Please generate a ${category} suggestion for this family. ${familyInfo}. Consider the day of the week and time of year.`;
      },
    },

    {
      name: "shopping_list",
      description:
        "Manage the shared family shopping list. Use when someone mentions needing to buy something, or says they've bought/got something (remove it). Examples: 'we need milk' → add milk. 'add bread and eggs' → add both. 'I got the bread' or 'picked up milk' → remove. 'what's on the list?' → list. 'clear the shopping list' → clear.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["add", "remove", "list", "clear"],
            description: "What to do",
          },
          items: {
            type: "array",
            items: { type: "string" },
            description:
              "Item names to add or remove. For remove, matches by name (case-insensitive).",
          },
        },
        required: ["action"],
      },
      handler: async (args: unknown) => {
        const { action, items = [] } = args as {
          action: "add" | "remove" | "list" | "clear";
          items?: string[];
        };

        if (action === "list") {
          const current = listShoppingItems(userId);
          if (current.length === 0) return "The shopping list is empty.";
          return (
            "Shopping list:\n" +
            current
              .map(
                (item, i) =>
                  `${i + 1}. ${item.item}${item.meal_ref ? ` (${item.meal_ref})` : ""}${item.added_by ? ` — added by ${item.added_by}` : ""}`
              )
              .join("\n")
          );
        }

        if (action === "add") {
          if (items.length === 0) return "No items specified to add.";
          const added: string[] = [];
          for (const item of items) {
            if (item.trim()) {
              addShoppingItem(userId, item.trim());
              added.push(item.trim());
            }
          }
          return added.length === 1
            ? `Added "${added[0]}" to the shopping list.`
            : `Added ${added.length} items to the shopping list: ${added.join(", ")}`;
        }

        if (action === "remove") {
          if (items.length === 0) return "No items specified to remove.";
          const removed: string[] = [];
          const notFound: string[] = [];
          for (const item of items) {
            if (removeShoppingItemByName(userId, item)) {
              removed.push(item);
            } else {
              notFound.push(item);
            }
          }
          const parts: string[] = [];
          if (removed.length > 0) parts.push(`Removed: ${removed.join(", ")}`);
          if (notFound.length > 0)
            parts.push(`Not found on list: ${notFound.join(", ")}`);
          return parts.join(". ");
        }

        if (action === "clear") {
          const count = clearShoppingList(userId);
          return count > 0
            ? `Cleared ${count} item${count !== 1 ? "s" : ""} from the shopping list.`
            : "The shopping list is already empty.";
        }

        return "Unknown action.";
      },
    },

    {
      name: "meal_planner",
      description:
        `Manage the family meal library and plan dinners. Use for anything meal-related.
Actions:
- add: Add a meal to the library. IMPORTANT: If ingredients are not provided, you MUST ask the user for the main ingredients in a follow-up message.
- update: Update a meal's tags, ingredients, notes, or GF status.
- remove: Remove a meal from the library.
- log: Record that we had a meal (logs it with today's date).
- list: Show all meals, optionally filtered by tag.
- suggest: Get a dinner suggestion based on filters (quick, kid-friendly, leftovers, gluten-free). Avoids recently-cooked meals.
- history: Show recent meal history.
- shop: Add a meal's ingredients to the shopping list (each item tagged with the meal name).

Tags available: kid-friendly, quick, leftovers, gluten-free, healthy, comfort, weekend
Note: Kristy is celiac. When adding meals, note if GF or if a GF variant is needed (e.g. "use rice for Kristy, pasta for kids").`,
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["add", "update", "remove", "log", "list", "suggest", "history", "shop"],
            description: "What to do",
          },
          name: { type: "string", description: "Meal name" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags: kid-friendly, quick, leftovers, gluten-free, healthy, comfort, weekend",
          },
          ingredients: {
            type: "array",
            items: { type: "string" },
            description: "Main ingredients needed for this meal",
          },
          notes: { type: "string", description: "Notes about the meal (GF variants, tips, etc.)" },
          is_gluten_free: { type: "boolean", description: "Whether this meal is naturally gluten free" },
          filter: { type: "string", description: "For suggest action: what kind of meal (e.g. 'quick', 'kid-friendly', 'leftovers')" },
        },
        required: ["action"],
      },
      handler: async (args: unknown) => {
        const {
          action, name, tags, ingredients, notes, is_gluten_free, filter,
        } = args as {
          action: "add" | "update" | "remove" | "log" | "list" | "suggest" | "history" | "shop";
          name?: string;
          tags?: string[];
          ingredients?: string[];
          notes?: string;
          is_gluten_free?: boolean;
          filter?: string;
        };

        if (action === "add") {
          if (!name) return "Please provide a meal name.";
          const existing = findMealByName(userId, name);
          if (existing) return `"${name}" is already in the meal library. Use update to modify it.`;

          const meal = addMeal(userId, name, {
            tags: tags?.join(",") ?? undefined,
            ingredients: ingredients?.join(",") ?? undefined,
            notes,
            isGlutenFree: is_gluten_free,
          });

          let response = `Added "${meal.name}" to the meal library.`;
          if (tags?.length) response += ` Tags: ${tags.join(", ")}.`;
          if (!ingredients?.length) {
            response += "\n\nWhat are the main ingredients for this meal? I'll save them so we can add them to the shopping list later.";
          }
          return response;
        }

        if (action === "update") {
          if (!name) return "Please provide the meal name to update.";
          const existing = findMealByName(userId, name);
          if (!existing) return `Could not find "${name}" in the meal library.`;

          updateMeal(existing.id, userId, {
            tags: tags?.join(","),
            ingredients: ingredients?.join(","),
            notes,
            isGlutenFree: is_gluten_free,
          });
          return `Updated "${name}".`;
        }

        if (action === "remove") {
          if (!name) return "Please provide the meal name to remove.";
          const existing = findMealByName(userId, name);
          if (!existing) return `Could not find "${name}" in the meal library.`;
          removeMeal(existing.id, userId);
          return `Removed "${name}" from the meal library.`;
        }

        if (action === "log") {
          if (!name) return "What meal did you have?";
          let meal = findMealByName(userId, name);
          if (!meal) {
            // Auto-add the meal if it doesn't exist
            meal = addMeal(userId, name);
          }
          const entry = logMeal(meal.id);
          let response = `Logged "${entry.meal_name}" for today.`;
          if (!meal.ingredients) {
            response += "\n\nWhat are the main ingredients for this meal? I'll save them for next time.";
          }
          return response;
        }

        if (action === "list") {
          const meals = getMealsWithLastCooked(userId);
          if (meals.length === 0) return "No meals in the library yet. Tell me about your favourite meals to get started!";

          let filtered = meals;
          if (filter) {
            filtered = meals.filter((m) =>
              m.tags?.toLowerCase().includes(filter.toLowerCase())
            );
            if (filtered.length === 0) return `No meals tagged as "${filter}". Try a different filter or add tags to your meals.`;
          }

          return filtered
            .map((m) => {
              const parts = [`• ${m.name}`];
              if (m.tags) parts.push(`[${m.tags}]`);
              if (m.is_gluten_free) parts.push("🌾GF");
              if (m.last_cooked) {
                parts.push(`— last had: ${m.last_cooked.slice(0, 10)}`);
              } else {
                parts.push("— never logged");
              }
              return parts.join(" ");
            })
            .join("\n");
        }

        if (action === "suggest") {
          const meals = getMealsWithLastCooked(userId);
          const history = getMealHistory(userId, 14);
          const family = listFamilyMembers(userId);

          const familyInfo = family
            .map((f) => {
              const parts = [f.name];
              if (f.dietary) parts.push(`dietary: ${f.dietary}`);
              if (f.allergies) parts.push(`allergies: ${f.allergies}`);
              return parts.join(" — ");
            })
            .join("; ");

          const mealList = meals.length > 0
            ? meals
                .map((m) => {
                  const parts = [`${m.name}`];
                  if (m.tags) parts.push(`tags: ${m.tags}`);
                  if (m.is_gluten_free) parts.push("gluten-free");
                  if (m.ingredients) parts.push(`ingredients: ${m.ingredients}`);
                  if (m.notes) parts.push(`notes: ${m.notes}`);
                  if (m.last_cooked) parts.push(`last cooked: ${m.last_cooked.slice(0, 10)}`);
                  else parts.push("never cooked");
                  return `- ${parts.join(" | ")}`;
                })
                .join("\n")
            : "No meals in the library yet.";

          const recentMeals = history.length > 0
            ? history.map((h) => `${h.cooked_at.slice(0, 10)}: ${h.meal_name}`).join(", ")
            : "No recent meals logged";

          return `Suggest a dinner for tonight based on the family's meal library.

FILTER: ${filter ?? "no specific preference"}
FAMILY: ${familyInfo || "No family info"}
RECENT MEALS (avoid these): ${recentMeals}

MEAL LIBRARY:
${mealList}

Rules:
- Pick from the library if possible, preferring meals not had in the last 7-10 days
- If the library is small or nothing matches, suggest something new that fits the filter
- Always consider dietary needs (Kristy is celiac — note GF options)
- If suggesting something with a GF variant, mention it
- Keep the response concise and appetising`;
        }

        if (action === "history") {
          const history = getMealHistory(userId);
          if (history.length === 0) return "No meal history yet. Tell me when you've had dinner and I'll track it!";

          return "Recent meals:\n" + history
            .map((h) => `• ${h.cooked_at.slice(0, 10)}: ${h.meal_name}`)
            .join("\n");
        }

        if (action === "shop") {
          if (!name) return "Which meal should I add ingredients for?";
          const meal = findMealByName(userId, name);
          if (!meal) return `Could not find "${name}" in the meal library.`;
          if (!meal.ingredients) return `"${name}" doesn't have ingredients recorded. What are the main ingredients?`;

          const ingredientList = meal.ingredients.split(",").map((i) => i.trim()).filter(Boolean);
          for (const ingredient of ingredientList) {
            addShoppingItem(userId, ingredient, { mealRef: meal.name });
          }

          return `Added ${ingredientList.length} ingredients for "${meal.name}" to the shopping list: ${ingredientList.join(", ")}`;
        }

        return "Unknown action.";
      },
    },

    {
      name: "create_task",
      description:
        "Create a task with a due date and optional assignment to a family member. Tasks get milestone reminders as the due date approaches (1 month, 2 weeks, 1 week, 3 days, 1 day, and on the day). Use for things that need to be done by a deadline.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "What needs to be done" },
          description: { type: "string", description: "Additional details about the task" },
          due_at: {
            type: "string",
            description: "When the task is due. Natural language like 'next Friday' or 'April 15' or ISO 8601.",
          },
          assigned_to: {
            type: "string",
            description: "Name of the family member to assign this task to",
          },
        },
        required: ["title", "due_at"],
      },
      handler: async (args: unknown) => {
        const { title, description, due_at, assigned_to } = args as {
          title: string;
          description?: string;
          due_at: string;
          assigned_to?: string;
        };

        let dueDate = parseNaturalDate(due_at, timezone);
        if (!dueDate) {
          dueDate = new Date(due_at);
          if (isNaN(dueDate.getTime())) {
            return `Could not understand the date "${due_at}". Please try again with a clearer date.`;
          }
        }

        let familyMemberId: number | undefined;
        if (assigned_to) {
          const member = findFamilyMemberByName(userId, assigned_to);
          if (member) familyMemberId = member.id;
        }

        const task = createTask(userId, title, toISOUTC(dueDate), {
          description,
          familyMemberId,
        });

        const formattedDate = formatInTimeZone(dueDate, timezone, "EEEE d MMM yyyy");
        return `Task created: "${title}" — due ${formattedDate}${assigned_to ? ` (assigned to ${assigned_to})` : ""}. ID: ${task.id}\n\nYou'll get reminders at: 1 month, 2 weeks, 1 week, 3 days, 1 day before, and on the day.`;
      },
    },

    {
      name: "list_tasks",
      description:
        "List tasks. Use when the user asks about tasks, things to do, deadlines, or what's due.",
      parameters: {
        type: "object",
        properties: {
          assigned_to: { type: "string", description: "Filter by family member name" },
          include_completed: { type: "boolean", description: "Whether to include completed tasks" },
        },
      },
      handler: async (args: unknown) => {
        const { assigned_to, include_completed } = args as {
          assigned_to?: string;
          include_completed?: boolean;
        };

        let familyMemberId: number | undefined;
        if (assigned_to) {
          const member = findFamilyMemberByName(userId, assigned_to);
          if (member) familyMemberId = member.id;
        }

        const tasks = listTasks(userId, {
          familyMemberId,
          includeCompleted: include_completed,
        });

        if (tasks.length === 0) return "No tasks found.";

        return tasks
          .map((t) => {
            const due = formatInTimeZone(new Date(t.due_at + "Z"), timezone, "EEE d MMM yyyy");
            const status = t.is_completed ? " [done]" : "";
            let assignee = "";
            if (t.family_member_id) {
              const db = getDatabase();
              const member = db
                .prepare("SELECT name FROM family_members WHERE id = ?")
                .get(t.family_member_id) as { name: string } | undefined;
              if (member) assignee = ` (${member.name})`;
            }
            return `- [${t.id}] ${t.title} — due ${due}${assignee}${status}`;
          })
          .join("\n");
      },
    },

    {
      name: "complete_task",
      description:
        "Mark a task as completed. Use when someone says they've finished a task or it's done.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "number", description: "The ID of the task to complete" },
        },
        required: ["task_id"],
      },
      handler: async (args: unknown) => {
        const { task_id } = args as { task_id: number };
        const success = completeTask(task_id, userId);
        return success
          ? `Task ${task_id} marked as done.`
          : `Could not find task ${task_id}.`;
      },
    },

    {
      name: "search_school_emails",
      description:
        "Search stored Bentleigh West Primary School emails (last 6 months). Use when the user asks about school events, dates, NAPLAN, athletics, pupil-free days, term dates, school weeks, excursions, assemblies, or anything school-related. Can search by keyword or list recent emails.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Keywords to search for in school emails (e.g. 'athletics', 'NAPLAN', 'pupil free day', 'term dates'). Leave empty to list recent emails.",
          },
          from_date: {
            type: "string",
            description: "Start date for search range (natural language or ISO 8601). Optional.",
          },
          to_date: {
            type: "string",
            description: "End date for search range. Optional.",
          },
        },
      },
      handler: async (args: unknown) => {
        const { query, from_date, to_date } = args as {
          query?: string;
          from_date?: string;
          to_date?: string;
        };

        let fromDate: string | undefined;
        let toDate: string | undefined;
        if (from_date) {
          const d = parseNaturalDate(from_date, timezone);
          if (d) fromDate = toISOUTC(d);
        }
        if (to_date) {
          const d = parseNaturalDate(to_date, timezone);
          if (d) toDate = toISOUTC(d);
        }

        const results = query?.trim()
          ? searchSchoolEmails(query.trim(), { fromDate, toDate, limit: 10 })
          : listRecentSchoolEmails(10);

        if (results.length === 0) {
          return query
            ? `No school emails found matching "${query}". Try different keywords or a broader date range.`
            : "No school emails stored yet.";
        }

        return results
          .map((e) => {
            const date = formatInTimeZone(
              new Date(e.received_at),
              timezone,
              "EEE d MMM yyyy"
            );
            let entry = `[${date}] ${e.subject}`;
            if (e.ai_summary) entry += `\nSummary: ${e.ai_summary}`;
            if (query && e.body_text) {
              entry += `\nDetails: ${e.body_text.slice(0, 500)}`;
            }
            if (query && e.linked_page_text) {
              entry += `\nPage content: ${e.linked_page_text.slice(0, 500)}`;
            }
            return entry;
          })
          .join("\n\n---\n\n");
      },
    },
  ];
}
