import { Bot } from "grammy";
import { getConfig } from "../config.js";
import { getLogger } from "../utils/logger.js";
import { getDatabase } from "../db/database.js";
import { isGoogleAuthenticated } from "../google/auth.js";
import { listEmails, getFullEmail } from "../google/gmail.js";
import { createReminder } from "../db/repositories/reminderRepo.js";
import { createEvent } from "../db/repositories/eventRepo.js";
import { chat } from "../ai/agent.js";
import { splitMessage } from "../utils/telegram.js";
import { toISOUTC } from "../utils/dateParser.js";
import {
  listShoppingItems,
  removeShoppingItemByName,
} from "../db/repositories/shoppingRepo.js";
import { saveSchoolEmail } from "../db/repositories/schoolEmailRepo.js";
import { isQuietHours } from "../utils/quietHours.js";

interface EmailRule {
  name: string;
  /** Gmail search query to find matching emails */
  query: string;
  /** Extra check on the from address (case-insensitive substring match) */
  fromMatch?: string;
  handler: (email: Awaited<ReturnType<typeof getFullEmail>>, bot: Bot) => Promise<void>;
}

function isProcessed(gmailId: string): boolean {
  const db = getDatabase();
  const row = db
    .prepare("SELECT id FROM processed_emails WHERE gmail_id = ?")
    .get(gmailId);
  return !!row;
}

function markProcessed(gmailId: string, ruleName: string) {
  const db = getDatabase();
  db.prepare(
    "INSERT OR IGNORE INTO processed_emails (gmail_id, rule_name) VALUES (?, ?)"
  ).run(gmailId, ruleName);
}

function getAdminUserId(): number {
  const db = getDatabase();
  const config = getConfig();
  const user = db
    .prepare("SELECT id FROM users WHERE telegram_id = ?")
    .get(config.ADMIN_TELEGRAM_ID) as { id: number } | undefined;
  return user?.id ?? 1;
}

async function fetchPageText(url: string): Promise<string> {
  const log = getLogger();
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; OpenClaw/1.0; +https://github.com/jamesevans28/home-assistant)",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return `Error fetching page: ${res.status}`;
    const html = await res.text();
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);
  } catch (err) {
    log.error({ err, url }, "Failed to fetch page for email rule");
    return "Could not fetch the linked page.";
  }
}

function buildRules(bot: Bot): EmailRule[] {
  const log = getLogger();
  const config = getConfig();
  const chatId = config.GROUP_CHAT_ID ?? config.ADMIN_TELEGRAM_ID;

  return [
    {
      name: "bentleigh_west_primary",
      query: "from:compass@compass.email newer_than:1d",
      fromMatch: "bentleigh west primary",
      handler: async (email) => {
        log.info(
          { subject: email.subject, id: email.id },
          "Processing Bentleigh West Primary email"
        );

        // Find "View news item" or similar Compass links
        const newsLinks = email.links.filter(
          (l) =>
            l.text.toLowerCase().includes("view") ||
            l.href.includes("/newsfeed/") ||
            l.href.includes("/note/") ||
            l.href.includes("compass.education")
        );

        let pageContent = "";
        if (newsLinks.length > 0) {
          // Follow the first matching link
          const targetUrl = newsLinks[0].href;
          log.info({ url: targetUrl }, "Following Compass link");
          pageContent = await fetchPageText(targetUrl);
        }

        // Use AI to summarise and detect events
        const adminUserId = getAdminUserId();
        const aiPrompt = `You received a school email from Bentleigh West Primary School.

SUBJECT: ${email.subject}
EMAIL BODY:
${email.body.slice(0, 3000)}

${pageContent ? `LINKED PAGE CONTENT:\n${pageContent}` : "No linked page content available."}

Please do TWO things:

1. **SUMMARY**: Write a concise, friendly summary of this school news for the family group chat. Use 2-4 sentences. Include key details (what, when, where, any actions needed). Start with "🏫 **School Update** — " followed by the topic.

2. **EVENTS**: If the email mentions ANY dates or events (e.g. school photos, excursions, pupil-free days, term dates, sports days, assemblies, etc.), list them in this EXACT format, one per line:
EVENT: <title> | <date in YYYY-MM-DD format> | <time if mentioned, otherwise "all day">

If there are no events, just write: NO_EVENTS

Output the summary first, then a line "---EVENTS---", then the events section.`;

        const response = await chat(adminUserId, config.ADMIN_TELEGRAM_ID, aiPrompt);

        // Split response into summary and events
        const [summaryPart, eventsPart] = response.split("---EVENTS---");

        // Send the summary to the group chat
        if (summaryPart?.trim()) {
          const chunks = splitMessage(summaryPart.trim());
          for (const chunk of chunks) {
            await bot.api
              .sendMessage(chatId, chunk, { parse_mode: "Markdown" })
              .catch(() => bot.api.sendMessage(chatId, chunk));
          }
        }

        // Parse and create events/reminders
        if (eventsPart && !eventsPart.includes("NO_EVENTS")) {
          const eventLines = eventsPart
            .split("\n")
            .filter((l) => l.trim().startsWith("EVENT:"));

          for (const line of eventLines) {
            const match = line.match(
              /EVENT:\s*(.+?)\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(.+)/
            );
            if (!match) continue;

            const [, title, dateStr, timeStr] = match;
            const isAllDay = timeStr.toLowerCase().includes("all day");

            // Create a calendar event
            const startAt = isAllDay
              ? `${dateStr}T09:00:00`
              : `${dateStr}T${parseTimeString(timeStr)}`;

            createEvent(adminUserId, `🏫 ${title.trim()}`, toISOUTC(new Date(startAt + getTimezoneOffset(config.DEFAULT_TIMEZONE))), {
              description: `From school email: ${email.subject}`,
            });

            // Create a reminder for the day before
            const eventDate = new Date(startAt + getTimezoneOffset(config.DEFAULT_TIMEZONE));
            const reminderDate = new Date(eventDate.getTime() - 86400000); // day before
            reminderDate.setHours(18, 0, 0, 0); // remind at 6pm the day before

            createReminder(adminUserId, `Tomorrow: 🏫 ${title.trim()}`, toISOUTC(reminderDate), {
              description: `School event from email: ${email.subject}`,
            });

            log.info(
              { title, date: dateStr },
              "Created school event and reminder"
            );
          }
        }

        // Persist email content for future Q&A (6-month retention)
        try {
          saveSchoolEmail({
            gmailId: email.id,
            subject: email.subject,
            receivedAt: new Date(email.date).toISOString(),
            bodyText: email.body.slice(0, 5000),
            linkedPageText: pageContent || undefined,
            aiSummary: summaryPart?.trim() || undefined,
          });
          log.info({ id: email.id }, "Saved school email for future reference");
        } catch (saveErr) {
          log.warn({ err: saveErr, id: email.id }, "Failed to save school email content");
        }
      },
    },

    {
      name: "coles_order",
      query: "from:coles.com.au newer_than:1d subject:order",
      fromMatch: "coles.com.au",
      handler: async (email) => {
        log.info(
          { subject: email.subject, id: email.id },
          "Processing Coles order email"
        );

        const adminUserId = getAdminUserId();

        // Use AI to extract ordered items from the email
        const aiPrompt = `You received a Coles online grocery order confirmation email.

SUBJECT: ${email.subject}
EMAIL BODY:
${email.body.slice(0, 5000)}

Extract the list of items ordered. Output ONLY the item names, one per line, in this format:
ITEM: <item name>

Keep names simple and short (e.g. "milk" not "Coles Full Cream Milk 2L"). Strip brand names and quantities — just the core item name that would match a shopping list.

If you can't find any items, output: NO_ITEMS`;

        const response = await chat(adminUserId, config.ADMIN_TELEGRAM_ID, aiPrompt);

        if (response.includes("NO_ITEMS")) {
          log.info("Coles email had no extractable items");
          return;
        }

        const orderedItems = response
          .split("\n")
          .filter((l) => l.trim().startsWith("ITEM:"))
          .map((l) => l.replace(/^ITEM:\s*/i, "").trim())
          .filter(Boolean);

        if (orderedItems.length === 0) return;

        // Cross-reference with shopping list and remove matches
        const currentList = listShoppingItems(adminUserId);
        const removed: string[] = [];

        for (const ordered of orderedItems) {
          if (removeShoppingItemByName(adminUserId, ordered)) {
            removed.push(ordered);
          }
        }

        // Notify group chat
        if (removed.length > 0) {
          const msg = `🛒 *Coles order received!*\n\nRemoved ${removed.length} item${removed.length !== 1 ? "s" : ""} from the shopping list: ${removed.join(", ")}`;
          await bot.api
            .sendMessage(chatId, msg, { parse_mode: "Markdown" })
            .catch(() => bot.api.sendMessage(chatId, msg));
        } else {
          const remaining = listShoppingItems(adminUserId);
          if (remaining.length > 0) {
            const msg = `🛒 *Coles order received!* Still on the shopping list: ${remaining.map((i) => i.item).join(", ")}`;
            await bot.api
              .sendMessage(chatId, msg, { parse_mode: "Markdown" })
              .catch(() => bot.api.sendMessage(chatId, msg));
          }
        }

        log.info(
          { ordered: orderedItems.length, removed: removed.length },
          "Processed Coles order"
        );
      },
    },
  ];
}

function parseTimeString(time: string): string {
  // Try to parse times like "9:00am", "2:30 PM", "14:00"
  const cleaned = time.trim().toLowerCase();
  const match = cleaned.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)?/);
  if (!match) return "09:00:00";

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const period = match[3];

  if (period === "pm" && hours < 12) hours += 12;
  if (period === "am" && hours === 12) hours = 0;

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:00`;
}

function getTimezoneOffset(timezone: string): string {
  // Get the UTC offset by comparing UTC and local representations
  const now = new Date();
  const utcDate = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  const tzDate = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  const diffMs = tzDate.getTime() - utcDate.getTime();
  const totalMinutes = Math.round(diffMs / 60000);
  const sign = totalMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(totalMinutes);
  const hrs = Math.floor(absMinutes / 60).toString().padStart(2, "0");
  const mins = (absMinutes % 60).toString().padStart(2, "0");
  return `${sign}${hrs}:${mins}`;
}

export async function checkEmails(bot: Bot) {
  const log = getLogger();

  // Don't process/send email alerts during quiet hours (10pm–6am)
  if (isQuietHours()) return;

  if (!isGoogleAuthenticated()) {
    return;
  }

  const rules = buildRules(bot);

  for (const rule of rules) {
    try {
      const emails = await listEmails(10, rule.query);

      for (const emailSummary of emails) {
        // Skip if already processed
        if (isProcessed(emailSummary.id)) continue;

        // Check fromMatch if specified
        if (
          rule.fromMatch &&
          !emailSummary.from.toLowerCase().includes(rule.fromMatch)
        ) {
          continue;
        }

        // Get the full email
        const fullEmail = await getFullEmail(emailSummary.id);

        log.info(
          { rule: rule.name, subject: fullEmail.subject, id: fullEmail.id },
          "Email matches rule, processing"
        );

        // Run the handler
        await rule.handler(fullEmail, bot);

        // Mark as processed
        markProcessed(emailSummary.id, rule.name);
      }
    } catch (err) {
      log.error({ err, rule: rule.name }, "Error processing email rule");
    }
  }
}
