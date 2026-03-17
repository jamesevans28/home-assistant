import { formatInTimeZone } from "date-fns-tz";
import { getDatabase } from "../db/database.js";
import { getUserByTelegramId } from "../db/repositories/userRepo.js";

interface FamilyMember {
  name: string;
  relationship: string | null;
  age: number | null;
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
    .prepare("SELECT name, relationship, age FROM family_members WHERE user_id = ?")
    .all(userId) as FamilyMember[];

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

  let prompt = `You are OpenClaw, a personal home and life assistant for ${userName}'s family.
You communicate via Telegram. Be concise, warm, and helpful.

Current date/time: ${now}
User timezone: ${timezone}

`;

  if (family.length > 0) {
    prompt += "Family members:\n";
    for (const member of family) {
      const parts = [`- ${member.name}`];
      if (member.relationship) parts.push(`(${member.relationship})`);
      if (member.age) parts.push(`age ${member.age}`);
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

  prompt += `You have tools to manage reminders, events, and family members. Use them when the user asks.
You also have Google Calendar and Gmail tools — use them when the user asks about their calendar, schedule, emails, or wants to send an email.
When the user mentions a time, interpret it in their timezone (${timezone}).
Always confirm before creating reminders, events, or sending emails.
Keep responses concise — this is a chat app, not an essay.`;

  return prompt;
}
