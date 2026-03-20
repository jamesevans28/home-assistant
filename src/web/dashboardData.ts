import { createRequire } from "module";
import { getDatabase } from "../db/database.js";
import { getConfig } from "../config.js";
import { listReminders } from "../db/repositories/reminderRepo.js";
import { getTasksDueInRange } from "../db/repositories/taskRepo.js";
import { listShoppingItems } from "../db/repositories/shoppingRepo.js";
import { getMealHistory } from "../db/repositories/mealRepo.js";
import { listRecentSchoolEmails } from "../db/repositories/schoolEmailRepo.js";
import { listFamilyMembers } from "../db/repositories/familyRepo.js";
import { listEvents } from "../db/repositories/eventRepo.js";
import {
  getFixturesForFavouriteTeams,
  getRecentResults,
} from "../db/repositories/fixtureRepo.js";
import { getMessageCountsByDay } from "../db/repositories/messageRepo.js";
import { formatInTimeZone } from "date-fns-tz";
import { addDays } from "date-fns";
import { getLogger } from "../utils/logger.js";

function getVersion(): string {
  const require = createRequire(import.meta.url);
  const pkg = require("../../package.json");
  return pkg.version;
}

function getAdminUserId(): number {
  const db = getDatabase();
  const config = getConfig();
  const user = db
    .prepare("SELECT id FROM users WHERE telegram_id = ?")
    .get(config.ADMIN_TELEGRAM_ID) as { id: number } | undefined;
  return user?.id ?? 1;
}

/** Safely run a function, returning fallback on error */
function safe<T>(label: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    const log = getLogger();
    log.error({ err, section: label }, "Dashboard data section failed");
    return fallback;
  }
}

export interface DashboardData {
  generatedAt: string;
  version: string;
  stats: {
    remindersDueToday: number;
    tasksDueSoon: number;
    tasksOverdue: number;
    shoppingCount: number;
    mealsThisWeek: number;
  };
  remindersToday: Array<{ title: string; dueAt: string; familyMember?: string }>;
  tasksDueSoon: Array<{ title: string; dueAt: string; familyMember?: string }>;
  nextGames: Array<{
    sport: string;
    homeTeam: string | null;
    awayTeam: string | null;
    eventName: string | null;
    startTime: string;
    venue: string | null;
    followers: string[];
  }>;
  recentResults: Array<{
    sport: string;
    homeTeam: string | null;
    awayTeam: string | null;
    eventName: string | null;
    homeScore: string | null;
    awayScore: string | null;
    resultSummary: string | null;
  }>;
  schoolNews: Array<{ subject: string; summary: string | null; receivedAt: string }>;
  usageByDay: Array<{ date: string; count: number }>;
  shoppingList: Array<{ item: string; mealRef: string | null; addedBy: string | null }>;
  mealsThisWeek: Array<{ name: string; cookedAt: string }>;
  upcomingEvents: Array<{ title: string; startAt: string; location: string | null }>;
  upcomingBirthdays: Array<{
    name: string;
    dateOfBirth: string;
    daysUntil: number;
    turningAge: number | null;
  }>;
}

export function buildDashboardData(): DashboardData {
  const config = getConfig();
  const timezone = config.DEFAULT_TIMEZONE;
  const userId = getAdminUserId();
  const now = new Date();

  const todayStart = formatInTimeZone(now, timezone, "yyyy-MM-dd'T'00:00:00");
  const todayEnd = formatInTimeZone(now, timezone, "yyyy-MM-dd'T'23:59:59");
  const twoWeeksOut = formatInTimeZone(addDays(now, 14), timezone, "yyyy-MM-dd'T'23:59:59");
  const weekAheadStr = formatInTimeZone(addDays(now, 7), timezone, "yyyy-MM-dd'T'23:59:59");

  // Family member lookup for names
  const familyLookup = new Map<number, string>();
  const allFamily = safe("family", () => listFamilyMembers(userId), []);
  for (const m of allFamily) {
    familyLookup.set(m.id, m.name);
  }

  // Reminders due today
  const { activeReminders } = safe("reminders", () => {
    const reminders = listReminders(userId, { fromDate: todayStart, toDate: todayEnd });
    return { activeReminders: reminders.filter((r) => !r.is_completed && !r.notified) };
  }, { activeReminders: [] as Array<{ title: string; due_at: string; family_member_id?: number; is_completed: boolean; notified: boolean }> });

  // Tasks due within 2 weeks
  const { tasks, overdueTasks } = safe("tasks", () => {
    const t = getTasksDueInRange(todayStart, twoWeeksOut);
    return { tasks: t, overdueTasks: t.filter((tk) => tk.due_at < now.toISOString()) };
  }, { tasks: [] as Array<{ title: string; due_at: string; family_member_id?: number }>, overdueTasks: [] as any[] });

  // Shopping
  const shoppingItems = safe("shopping", () => listShoppingItems(userId), []);

  // Meals cooked this week
  const mealsThisWeek = safe("meals", () => {
    const mealHistory = getMealHistory(userId, 30);
    const weekAgo = addDays(now, -7);
    return mealHistory.filter((m) => new Date(m.cooked_at + "Z") >= weekAgo);
  }, []);

  // School news
  const schoolEmails = safe("schoolEmails", () => listRecentSchoolEmails(5), []);

  // Usage stats
  const usageByDay = safe("usage", () => getMessageCountsByDay(7), []);

  // Events (next 7 days)
  const events = safe("events", () => listEvents(userId, { fromDate: todayStart, toDate: weekAheadStr }), []);

  // Sports - today's games for favourite teams
  const todayFixtures = safe("fixtures", () =>
    getFixturesForFavouriteTeams(userId, now.toISOString(), timezone), []);

  // Recent results
  const recentResultsList = safe("results", () => getRecentResults(undefined, 3), []);

  // Upcoming birthdays (next 30 days)
  const upcomingBirthdays: DashboardData["upcomingBirthdays"] = [];

  for (const member of allFamily) {
    try {
      if (!member.date_of_birth) continue;
      const dob = member.date_of_birth; // YYYY-MM-DD
      const dobMonth = dob.slice(5, 7);
      const dobDay = dob.slice(8, 10);

      const thisYear = parseInt(formatInTimeZone(now, timezone, "yyyy"), 10);
      let birthdayThisYear = new Date(`${thisYear}-${dobMonth}-${dobDay}T00:00:00`);
      if (birthdayThisYear < now) {
        birthdayThisYear = new Date(`${thisYear + 1}-${dobMonth}-${dobDay}T00:00:00`);
      }
      const daysUntil = Math.ceil(
        (birthdayThisYear.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysUntil <= 30) {
        const birthYear = parseInt(dob.slice(0, 4), 10);
        const age = birthYear > 1900 ? birthdayThisYear.getFullYear() - birthYear : null;

        upcomingBirthdays.push({
          name: member.name,
          dateOfBirth: dob,
          daysUntil,
          turningAge: age,
        });
      }
    } catch {
      // Skip malformed birthday entries
    }
  }

  upcomingBirthdays.sort((a, b) => a.daysUntil - b.daysUntil);

  return {
    generatedAt: formatInTimeZone(now, timezone, "yyyy-MM-dd'T'HH:mm:ssxxx"),
    version: getVersion(),
    stats: {
      remindersDueToday: activeReminders.length,
      tasksDueSoon: tasks.length,
      tasksOverdue: overdueTasks.length,
      shoppingCount: shoppingItems.length,
      mealsThisWeek: mealsThisWeek.length,
    },
    remindersToday: activeReminders.map((r) => ({
      title: r.title,
      dueAt: safe("reminder-format", () => formatInTimeZone(new Date(r.due_at + "Z"), timezone, "h:mm a"), ""),
      familyMember: r.family_member_id
        ? familyLookup.get(r.family_member_id)
        : undefined,
    })),
    tasksDueSoon: tasks.slice(0, 10).map((t) => ({
      title: t.title,
      dueAt: safe("task-format", () => formatInTimeZone(new Date(t.due_at + "Z"), timezone, "EEE d MMM"), ""),
      familyMember: t.family_member_id
        ? familyLookup.get(t.family_member_id)
        : undefined,
    })),
    nextGames: todayFixtures.map((f) => ({
      sport: f.sport,
      homeTeam: f.home_team,
      awayTeam: f.away_team,
      eventName: f.event_name,
      startTime: safe("fixture-format", () => formatInTimeZone(new Date(f.start_time), timezone, "h:mm a"), ""),
      venue: f.venue,
      followers: f.followers,
    })),
    recentResults: recentResultsList.slice(0, 5).map((f) => ({
      sport: f.sport,
      homeTeam: f.home_team,
      awayTeam: f.away_team,
      eventName: f.event_name,
      homeScore: f.home_score,
      awayScore: f.away_score,
      resultSummary: f.result_summary,
    })),
    schoolNews: schoolEmails.map((e) => ({
      subject: e.subject,
      summary: e.ai_summary,
      receivedAt: safe("email-format", () => formatInTimeZone(
        new Date(e.received_at + "Z"),
        timezone,
        "EEE d MMM"
      ), ""),
    })),
    usageByDay,
    shoppingList: shoppingItems.map((i) => ({
      item: i.item,
      mealRef: i.meal_ref,
      addedBy: i.added_by,
    })),
    mealsThisWeek: mealsThisWeek.map((m) => ({
      name: m.meal_name,
      cookedAt: safe("meal-format", () => formatInTimeZone(
        new Date(m.cooked_at + "Z"),
        timezone,
        "EEE"
      ), ""),
    })),
    upcomingEvents: events.slice(0, 10).map((e) => ({
      title: e.title,
      startAt: safe("event-format", () => formatInTimeZone(
        new Date(e.start_at + "Z"),
        timezone,
        "EEE d MMM, h:mm a"
      ), ""),
      location: e.location,
    })),
    upcomingBirthdays,
  };
}
