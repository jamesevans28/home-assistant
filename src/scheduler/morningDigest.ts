import { Bot } from "grammy";
import { getConfig } from "../config.js";
import { getLogger } from "../utils/logger.js";
import { getDatabase } from "../db/database.js";
import { isGoogleAuthenticated } from "../google/auth.js";
import { listGoogleEvents, formatGoogleEvent } from "../google/calendar.js";
import { listEmails, type EmailSummary } from "../google/gmail.js";
import { listReminders } from "../db/repositories/reminderRepo.js";
import { listFamilyMembers, getAllFavouriteTeams } from "../db/repositories/familyRepo.js";
import { listEvents } from "../db/repositories/eventRepo.js";
import { getTodayAndTomorrowBirthdays } from "./birthdayChecker.js";
import { getBinWeek, getBinMessage } from "./binReminder.js";
import { listShoppingItems } from "../db/repositories/shoppingRepo.js";
import { addDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { chat } from "../ai/agent.js";
import { splitMessage } from "../utils/telegram.js";

async function fetchWeather(apiKey: string, location: string): Promise<string> {
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&units=metric&appid=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return "Weather unavailable.";
    const data = (await res.json()) as {
      main: { temp: number; feels_like: number; humidity: number };
      weather: Array<{ description: string }>;
      wind: { speed: number };
    };
    const temp = Math.round(data.main.temp);
    const feelsLike = Math.round(data.main.feels_like);
    const desc = data.weather[0]?.description ?? "unknown";
    const humidity = data.main.humidity;
    const wind = Math.round(data.wind.speed * 3.6); // m/s to km/h
    return `${desc}, ${temp}°C (feels like ${feelsLike}°C), humidity ${humidity}%, wind ${wind}km/h`;
  } catch {
    return "Weather unavailable.";
  }
}

async function fetchForecast(apiKey: string, location: string): Promise<string> {
  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(location)}&units=metric&cnt=4&appid=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return "";
    const data = (await res.json()) as {
      list: Array<{
        dt_txt: string;
        main: { temp: number };
        weather: Array<{ description: string }>;
      }>;
    };
    const points = data.list.map((p) => {
      const time = p.dt_txt.split(" ")[1]?.slice(0, 5) ?? "";
      return `${time}: ${Math.round(p.main.temp)}°C ${p.weather[0]?.description ?? ""}`;
    });
    return points.join(" → ");
  } catch {
    return "";
  }
}

async function fetchCalendarEvents(timezone: string): Promise<string> {
  if (!isGoogleAuthenticated()) return "Google Calendar not connected.";

  try {
    const now = new Date();
    const timeMin = formatInTimeZone(now, timezone, "yyyy-MM-dd'T'00:00:00xxx");
    const timeMax = formatInTimeZone(now, timezone, "yyyy-MM-dd'T'23:59:59xxx");

    const events = await listGoogleEvents(timeMin, timeMax);
    if (events.length === 0) return "No events today.";

    return events.map((e) => formatGoogleEvent(e, timezone)).join("\n");
  } catch {
    return "Could not fetch calendar.";
  }
}

async function fetchImportantEmails(timezone: string): Promise<string> {
  if (!isGoogleAuthenticated()) return "Gmail not connected.";

  try {
    // Get emails from the last 24 hours that are unread or important
    const emails = await listEmails(15, "is:unread newer_than:1d");
    if (emails.length === 0) return "No new emails since yesterday.";

    return emails
      .map((e, i) => `${i + 1}. ${e.subject}\n   From: ${e.from}\n   ${e.snippet.slice(0, 120)}`)
      .join("\n\n");
  } catch {
    return "Could not fetch emails.";
  }
}

function fetchLocalReminders(userId: number, timezone: string): string {
  try {
    const now = new Date();
    const todayStart = formatInTimeZone(now, timezone, "yyyy-MM-dd'T'00:00:00");
    const todayEnd = formatInTimeZone(now, timezone, "yyyy-MM-dd'T'23:59:59");

    const reminders = listReminders(userId, { fromDate: todayStart, toDate: todayEnd });
    if (reminders.length === 0) return "No reminders due today.";

    return reminders
      .map((r) => {
        const due = formatInTimeZone(new Date(r.due_at + "Z"), timezone, "h:mm a");
        return `- ${due}: ${r.title}`;
      })
      .join("\n");
  } catch {
    return "Could not fetch reminders.";
  }
}

function fetchUpcomingEvents(userId: number, timezone: string): string {
  try {
    const now = new Date();
    const weekAhead = addDays(now, 7);
    const tomorrowStart = formatInTimeZone(addDays(now, 1), timezone, "yyyy-MM-dd'T'00:00:00");
    const weekEnd = formatInTimeZone(weekAhead, timezone, "yyyy-MM-dd'T'23:59:59");

    const events = listEvents(userId, { fromDate: tomorrowStart, toDate: weekEnd });
    if (events.length === 0) return "No upcoming events this week.";

    return events
      .map((e) => {
        const date = formatInTimeZone(new Date(e.start_at + "Z"), timezone, "EEE d MMM, h:mm a");
        return `- ${date}: ${e.title}${e.location ? ` (${e.location})` : ""}`;
      })
      .join("\n");
  } catch {
    return "Could not fetch upcoming events.";
  }
}

function getBirthdayContext(userId: number, timezone: string): string {
  const { today, tomorrow } = getTodayAndTomorrowBirthdays(userId, timezone);
  const lines: string[] = [];
  for (const m of today) {
    const age = m.turningAge !== null ? ` (turning ${m.turningAge})` : "";
    lines.push(`🎂 TODAY: ${m.name}'s birthday${age}!`);
  }
  for (const m of tomorrow) {
    const age = m.turningAge !== null ? ` (turning ${m.turningAge})` : "";
    lines.push(`🎁 TOMORROW: ${m.name}'s birthday${age}`);
  }
  return lines.join("\n");
}

function getFamilyContext(userId: number): string {
  const members = listFamilyMembers(userId);
  if (members.length === 0) return "";
  return members
    .map((m) => `${m.name} (${m.relationship ?? "family"}${m.age ? `, ${m.age}` : ""})`)
    .join(", ");
}

export async function sendMorningDigest(bot: Bot) {
  const log = getLogger();
  const config = getConfig();

  const chatId = config.GROUP_CHAT_ID ?? config.ADMIN_TELEGRAM_ID;
  if (!chatId) {
    log.warn("No GROUP_CHAT_ID or ADMIN_TELEGRAM_ID set, skipping morning digest");
    return;
  }

  const timezone = config.DEFAULT_TIMEZONE;
  const today = formatInTimeZone(new Date(), timezone, "EEEE, d MMMM yyyy");

  log.info("Generating morning digest...");

  // Gather all data in parallel
  const [weather, forecast, calendarEvents, emails, localReminders, upcomingEvents] =
    await Promise.all([
      config.OPENWEATHER_API_KEY
        ? fetchWeather(config.OPENWEATHER_API_KEY, config.WEATHER_LOCATION)
        : "Weather not configured (set OPENWEATHER_API_KEY).",
      config.OPENWEATHER_API_KEY
        ? fetchForecast(config.OPENWEATHER_API_KEY, config.WEATHER_LOCATION)
        : "",
      fetchCalendarEvents(timezone),
      fetchImportantEmails(timezone),
      Promise.resolve(fetchLocalReminders(getAdminUserId(), timezone)),
      Promise.resolve(fetchUpcomingEvents(getAdminUserId(), timezone)),
    ]);

  const familyContext = getFamilyContext(getAdminUserId());
  const birthdayContext = getBirthdayContext(getAdminUserId(), timezone);
  const shoppingItems = listShoppingItems(getAdminUserId());
  const familyTeams = getAllFavouriteTeams(getAdminUserId());
  const teamsContext = familyTeams.length > 0
    ? familyTeams.map((t) => `${t.team} (followed by ${t.members.join(", ")})`).join(", ")
    : null;

  const shoppingContext =
    shoppingItems.length > 0
      ? `${shoppingItems.length} item${shoppingItems.length !== 1 ? "s" : ""}: ${shoppingItems.map((i) => i.item).join(", ")}`
      : null;

  // Only include bin reminder on Mondays
  const todayDow = parseInt(formatInTimeZone(new Date(), timezone, "i"), 10); // 1=Mon
  const binContext =
    todayDow === 1
      ? getBinMessage(getBinWeek(new Date(), timezone))
      : null;

  // Build the context for the AI to compose a nice digest
  const digestPrompt = `You are composing the morning briefing for the family group chat. Today is ${today}.

Here is all the raw data — synthesize it into a friendly, scannable morning digest message. Use emoji headers for each section. Be concise but informative.

FORMAT RULES:
- Start with a greeting and the date
- Use these sections with emoji headers: ☀️ Weather, 📅 Today's Schedule, 📆 Coming Up This Week, ✅ Reminders, 📧 Email Summary, 🏈 Sports & News
- If there are any birthdays today or tomorrow, add a 🎂 Birthdays section right after the greeting — make it celebratory!
- If there is bin information, include a 🗑️ Bins Tonight section and mention what goes out
- If there are items on the shopping list, include a 🛒 Shopping List section
- Keep each section brief — bullet points, not paragraphs
- For emails: highlight anything that looks important or needs action (school notices, bills, appointments). Skip obvious spam/marketing
- For the Sports & News section: Search for the latest AFL, F1, and NBL news and scores. Also include any MAJOR trending Australian or world news headlines that are breaking or trending right now
- End with a motivational or fun note for the day
- If a section has no data, skip it or note it briefly

RAW DATA:

WEATHER:
${weather}
${forecast ? `Forecast: ${forecast}` : ""}

CALENDAR EVENTS:
${calendarEvents}

REMINDERS DUE TODAY:
${localReminders}

UPCOMING EVENTS (next 7 days):
${upcomingEvents}

EMAILS (last 24h, unread):
${emails}

BIRTHDAYS:
${birthdayContext || "No birthdays today or tomorrow."}
${binContext ? `\nBINS TONIGHT:\n${binContext}` : ""}
${shoppingContext ? `\nSHOPPING LIST:\n${shoppingContext}` : ""}

FAMILY: ${familyContext || "No family members registered yet."}

IMPORTANT: For the Sports & News section, you MUST use your web search capabilities to find:
${teamsContext ? `FAMILY'S TEAMS: ${teamsContext}\n- Search for the latest news, scores, and upcoming fixtures for each of these teams. Mention which family member follows each team.\n- If any team is playing today/tonight, highlight it!` : `- Search for the latest AFL, F1, and NBL news and scores.`}
- Top 3-5 MAJOR trending news stories (Australian and world) — especially breaking news everyone should know about
- Search major outlets like ABC News, news.com.au, ESPN, Fox Sports, BBC
- Try multiple search queries — do NOT give up after one failed search.

Compose the digest now.`;

  try {
    const adminUserId = getAdminUserId();
    const response = await chat(adminUserId, config.ADMIN_TELEGRAM_ID, digestPrompt);

    const chunks = splitMessage(response);
    for (const chunk of chunks) {
      await bot.api
        .sendMessage(chatId, chunk, { parse_mode: "Markdown" })
        .catch(() => bot.api.sendMessage(chatId, chunk));
    }

    log.info("Morning digest sent successfully");
  } catch (err) {
    log.error({ err }, "Failed to send morning digest");

    // Send a fallback basic digest without AI
    try {
      const fallback = `☀️ *Morning Digest — ${today}*

*Weather:* ${weather}

*📅 Calendar:*
${calendarEvents}

*✅ Reminders:*
${localReminders}

*📧 Emails:*
${emails.slice(0, 500)}

_AI summary unavailable — showing raw data_`;

      await bot.api
        .sendMessage(chatId, fallback, { parse_mode: "Markdown" })
        .catch(() => bot.api.sendMessage(chatId, fallback));
    } catch (fallbackErr) {
      log.error({ err: fallbackErr }, "Failed to send fallback morning digest");
    }
  }
}

function getAdminUserId(): number {
  const db = getDatabase();
  const config = getConfig();
  const user = db
    .prepare("SELECT id FROM users WHERE telegram_id = ?")
    .get(config.ADMIN_TELEGRAM_ID) as { id: number } | undefined;
  return user?.id ?? 1;
}
