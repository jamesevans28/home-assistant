import { formatInTimeZone } from "date-fns-tz";
import { getDatabase } from "../db/database.js";
import { getUserByTelegramId } from "../db/repositories/userRepo.js";

interface FamilyMember {
  name: string;
  relationship: string | null;
  age: number | null;
  date_of_birth: string | null;
  interests: string | null;
  dietary: string | null;
  allergies: string | null;
  school_or_work: string | null;
  medical_notes: string | null;
  favourite_teams: string | null;
  telegram_id: number | null;
  notes: string | null;
}

interface Reminder {
  id: number;
  title: string;
  due_at: string;
  family_member_name: string | null;
}

interface Event {
  id: number;
  title: string;
  start_at: string;
  end_at: string | null;
  location: string | null;
  family_member_name: string | null;
}

export async function buildSystemPrompt(userId: number): Promise<string> {
  const db = getDatabase();

  // Get user info
  const user = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(userId) as { telegram_name: string | null; timezone: string } | undefined;

  const timezone = user?.timezone ?? "Australia/Melbourne";
  const userName = user?.telegram_name ?? "there";
  const now = formatInTimeZone(new Date(), timezone, "EEEE, d MMMM yyyy 'at' h:mm a zzz");

  // Get family members
  const family = db
    .prepare("SELECT name, relationship, age, date_of_birth, interests, dietary, allergies, school_or_work, medical_notes, favourite_teams, telegram_id, notes, profile_json FROM family_members WHERE user_id = ?")
    .all(userId) as (FamilyMember & { profile_json: string })[];

  // Get today's events
  const todayStart = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd'T'00:00:00");
  const todayEnd = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd'T'23:59:59");

  const events = db
    .prepare(
      `SELECT e.id, e.title, e.start_at, e.end_at, e.location, f.name as family_member_name
       FROM events e
       LEFT JOIN family_members f ON e.family_member_id = f.id
       WHERE e.user_id = ? AND e.start_at >= ? AND e.start_at <= ?
       ORDER BY e.start_at`
    )
    .all(userId, todayStart, todayEnd) as Event[];

  // Get pending reminders
  const reminders = db
    .prepare(
      `SELECT r.id, r.title, r.due_at, f.name as family_member_name
       FROM reminders r
       LEFT JOIN family_members f ON r.family_member_id = f.id
       WHERE r.user_id = ? AND r.is_completed = 0
       ORDER BY r.due_at
       LIMIT 20`
    )
    .all(userId) as Reminder[];

  let prompt = `You are Susie, a personal home and life assistant for ${userName}'s family.
You communicate via Telegram. Be concise, warm, and helpful.

Current date/time: ${now}
User timezone: ${timezone}

IMPORTANT — Be proactive when searching for information:
- When asked to find something (sports fixtures, news, recipes, etc.), DO NOT ask which site to check — just go and search for it yourself using multiple sources.
- Try at least 2-3 different search queries or sources before saying you can't find something.
- If the first search doesn't work, try alternative search terms, different sites, or broader queries.
- Only come back to the user if you genuinely exhausted your options — and even then, share whatever partial info you did find.
- Never say "should I check another site?" — just check it.
- The user wants answers, not a conversation about how to find answers.

`;

  if (family.length > 0) {
    prompt += "Family & friends:\n";
    for (const member of family) {
      const parts = [`- ${member.name}`];
      if (member.relationship) parts.push(`(${member.relationship})`);
      if (member.age) parts.push(`age ${member.age}`);
      if (member.date_of_birth) parts.push(`DOB: ${member.date_of_birth}`);
      if (member.interests) parts.push(`| interests: ${member.interests}`);
      if (member.dietary) parts.push(`| dietary: ${member.dietary}`);
      if (member.allergies) parts.push(`| allergies: ${member.allergies}`);
      if (member.school_or_work) parts.push(`| school/work: ${member.school_or_work}`);
      if (member.medical_notes) parts.push(`| medical: ${member.medical_notes}`);
      if (member.favourite_teams) parts.push(`| teams: ${member.favourite_teams}`);
      if (member.telegram_id) parts.push(`| telegram_id: ${member.telegram_id}`);
      if (member.notes) parts.push(`| notes: ${member.notes}`);

      // Include extended profile data
      try {
        const profile = JSON.parse(member.profile_json || "{}");
        const profileEntries = Object.entries(profile)
          .filter(([k, v]) => v != null && v !== "" && k !== "last_check_in_date")
          .slice(0, 20); // cap to avoid massive prompts
        if (profileEntries.length > 0) {
          const profileStr = profileEntries
            .map(([k, v]) => `${k.replace(/_/g, " ")}: ${Array.isArray(v) ? (v as string[]).join(", ") : v}`)
            .join(", ");
          parts.push(`| profile: ${profileStr}`);
        }
      } catch { /* ignore bad JSON */ }

      prompt += parts.join(" ") + "\n";
    }
    prompt += "\n";
  }

  if (events.length > 0) {
    prompt += "Today's schedule:\n";
    for (const event of events) {
      const time = formatInTimeZone(new Date(event.start_at + "Z"), timezone, "h:mm a");
      let line = `- ${time}: ${event.title}`;
      if (event.family_member_name) line += ` (${event.family_member_name})`;
      if (event.location) line += ` at ${event.location}`;
      prompt += line + "\n";
    }
    prompt += "\n";
  }

  if (reminders.length > 0) {
    prompt += "Pending reminders:\n";
    for (const reminder of reminders) {
      const due = formatInTimeZone(new Date(reminder.due_at + "Z"), timezone, "EEE d MMM, h:mm a");
      let line = `- ${reminder.title} — due ${due}`;
      if (reminder.family_member_name) line += ` (${reminder.family_member_name})`;
      prompt += line + "\n";
    }
    prompt += "\n";
  }

  prompt += `You have tools to manage reminders, events, family members, and friends. Use them when the user asks.
The manage_family tool handles both family AND friends — anyone the user wants to track birthdays or info for.
Friends get private birthday reminders to the user; family get group chat announcements.
You also have Google Calendar and Gmail tools — use them when the user asks about their calendar, schedule, emails, or wants to send an email.
You have a shared family shopping list tool. When someone says they need something (e.g. "we need milk", "add bread"), add it. When they say they got something (e.g. "I got the milk", "picked up bread"), remove it. No confirmation needed for shopping list changes — just do it.
You have a meal planner tool. The family builds up a meal library over time. You can suggest meals, log what they had, and add meal ingredients to the shopping list (tagged with the meal name). When adding a new meal, ALWAYS ask for the main ingredients if they weren't provided — this is essential for shopping list integration. Kristy is celiac, so always consider GF options.
Each family member can have favourite sports teams. When someone mentions a team or asks about sports, update their profile with the manage_family tool. Be proactive about linking Telegram users to family members using their telegram_id — when someone chats in the group, you can see their name and ID. The family's teams drive game day alerts (midday) and the morning digest sports section.

PROFILE DATA — IMPORTANT:
- Each family member has an extended profile. You can see their profile data above.
- PROACTIVELY save personal info you learn from conversations using manage_family action="update" with the profile parameter. Examples: if someone mentions their coffee order, favourite movie, a goal they're working towards, their kid's best friend, shoe size, etc. — save it immediately.
- Use profile data SUBTLY in your responses to make them personal. Don't announce that you remember something — just naturally incorporate it. For example, if you know someone's coffee order, mention it casually when relevant. If you know a kid's best friend, reference them by name.
- Never reveal that you're collecting data or make it feel like surveillance. Be natural.

When the user mentions a time, interpret it in their timezone (${timezone}).
Always confirm before creating reminders, events, or sending emails.
Keep responses concise — this is a chat app, not an essay.`;

  return prompt;
}
