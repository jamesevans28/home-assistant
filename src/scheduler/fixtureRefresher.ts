import { Bot } from "grammy";
import { getConfig } from "../config.js";
import { getLogger } from "../utils/logger.js";
import { getDatabase } from "../db/database.js";
import { chat } from "../ai/agent.js";
import {
  upsertFixtures,
  getRefreshLog,
  updateRefreshLog,
  getFixtureCount,
  type FixtureInput,
} from "../db/repositories/fixtureRepo.js";

interface LeagueConfig {
  sport: string;
  /** Direct JSON feed URL template — {season} replaced at runtime */
  feedUrl?: string;
  searchHints: string[];
  hasHomeAway: boolean;
  /** Months the season spans (inclusive) */
  seasonMonths: [number, number];
}

const LEAGUE_CONFIGS: LeagueConfig[] = [
  {
    sport: "AFL",
    feedUrl: "https://fixturedownload.com/feed/json/afl-{season}",
    searchHints: ["afl.com.au/fixture", "foxsports.com.au/afl/fixtures"],
    hasHomeAway: true,
    seasonMonths: [3, 9],
  },
  {
    sport: "NRL",
    feedUrl: "https://fixturedownload.com/feed/json/nrl-{season}",
    searchHints: ["nrl.com/draw", "foxsports.com.au/nrl/fixtures"],
    hasHomeAway: true,
    seasonMonths: [3, 10],
  },
  {
    sport: "F1",
    searchHints: ["formula1.com/en/racing", "motorsport.com/f1/calendar"],
    hasHomeAway: false,
    seasonMonths: [3, 12],
  },
  {
    sport: "Super Netball",
    feedUrl: "https://fixturedownload.com/feed/json/super-netball-{season}",
    searchHints: ["supernetball.com.au/fixture", "foxsports.com.au/netball"],
    hasHomeAway: true,
    seasonMonths: [4, 8],
  },
];

function getAdminUserId(): number {
  const db = getDatabase();
  const config = getConfig();
  const user = db
    .prepare("SELECT id FROM users WHERE telegram_id = ?")
    .get(config.ADMIN_TELEGRAM_ID) as { id: number } | undefined;
  return user?.id ?? 1;
}

function buildFixturePrompt(league: LeagueConfig, season: number): string {
  const isF1 = league.sport === "F1";

  return `Find the COMPLETE ${season} ${league.sport} season fixture/schedule.
Search these sources: ${league.searchHints.join(", ")}. If those don't work, try ESPN, Fox Sports, or Google.

Return the data as a JSON array. ONLY output the JSON array, nothing else before or after.

${isF1 ? `Each entry should have:
{
  "round": "Round number or name (e.g. 'Round 1', 'Pre-Season Testing')",
  "event_name": "Full race/event name (e.g. 'Australian Grand Prix')",
  "start_time": "Race start in ISO 8601 with timezone (e.g. '2026-03-15T15:00:00+11:00'). Use the RACE start time, not practice/qualifying.",
  "venue": "Circuit name and city (e.g. 'Albert Park Circuit, Melbourne')",
  "broadcast": "TV channel if known"
}` : `Each entry should have:
{
  "round": "Round name (e.g. 'Round 1', 'Finals Week 1')",
  "home_team": "Full home team name",
  "away_team": "Full away team name",
  "start_time": "Game start in ISO 8601 with timezone (e.g. '2026-03-22T19:30:00+11:00'). Convert to AEST/AEDT.",
  "venue": "Stadium name",
  "broadcast": "TV channel if known"
}`}

IMPORTANT:
- Include ALL rounds/races for the entire season, not just the first few
- Start times MUST include timezone offset
- Use full team names (e.g. "Collingwood Magpies" not "Collingwood")
- If you can't find the full season, return as many rounds as you can find
- If a fixture is TBD, include it with the best date estimate you have
- Return ONLY valid JSON — no markdown code fences, no commentary`;
}

function buildResultsPrompt(league: LeagueConfig, season: number): string {
  const isF1 = league.sport === "F1";

  return `Find the LATEST ${league.sport} results from the last 3 days.
Search: ${league.searchHints.join(", ")}, ESPN, Fox Sports.

Return a JSON array of COMPLETED games/races. ONLY output JSON, nothing else.

${isF1 ? `Each entry:
{
  "round": "Round name",
  "event_name": "Race name",
  "start_time": "Race start ISO 8601 with timezone",
  "venue": "Circuit",
  "result_summary": "Winner and key details (e.g. 'Verstappen won, Piastri P3')"
}` : `Each entry:
{
  "round": "Round name",
  "home_team": "Full home team name",
  "away_team": "Full away team name",
  "start_time": "Game start ISO 8601 with timezone",
  "venue": "Stadium",
  "home_score": "Home team score",
  "away_score": "Away team score",
  "result_summary": "Brief result (e.g. 'Collingwood won by 22 points')"
}`}

Return ONLY valid JSON. If no recent results, return an empty array: []`;
}

function extractJSON(text: string): unknown[] | null {
  // Try direct parse first
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // ignore
  }

  // Try to extract JSON array from surrounding text
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // ignore
    }
  }

  // Try removing markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // ignore
    }
  }

  return null;
}

function parseFixtures(
  data: unknown[],
  league: LeagueConfig,
  season: number
): FixtureInput[] {
  const fixtures: FixtureInput[] = [];

  for (const item of data) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;

    const startTime = obj.start_time as string | undefined;
    if (!startTime) continue;

    // Validate the date
    const date = new Date(startTime);
    if (isNaN(date.getTime())) continue;

    fixtures.push({
      sport: league.sport,
      season,
      round: (obj.round as string) ?? null,
      home_team: league.hasHomeAway ? (obj.home_team as string) ?? null : undefined,
      away_team: league.hasHomeAway ? (obj.away_team as string) ?? null : undefined,
      event_name: !league.hasHomeAway ? (obj.event_name as string) ?? null : undefined,
      start_time: date.toISOString(),
      venue: (obj.venue as string) ?? null,
      status: (obj.status as string) ?? "scheduled",
      home_score: (obj.home_score as string) ?? undefined,
      away_score: (obj.away_score as string) ?? undefined,
      result_summary: (obj.result_summary as string) ?? undefined,
      broadcast: (obj.broadcast as string) ?? undefined,
    });
  }

  return fixtures;
}

/** Feed entry from fixturedownload.com */
interface FeedEntry {
  MatchNumber: number;
  RoundNumber: number;
  DateUtc: string;
  Location: string | null;
  HomeTeam: string;
  AwayTeam: string;
  Group: string | null;
  HomeTeamScore: number | string | null;
  AwayTeamScore: number | string | null;
}

function parseFeedFixtures(data: FeedEntry[], league: LeagueConfig, season: number): FixtureInput[] {
  const fixtures: FixtureInput[] = [];

  for (const entry of data) {
    if (!entry.DateUtc) continue;

    const date = new Date(entry.DateUtc.endsWith("Z") ? entry.DateUtc : entry.DateUtc + "Z");
    if (isNaN(date.getTime())) continue;

    const hasScores =
      entry.HomeTeamScore != null && entry.AwayTeamScore != null &&
      entry.HomeTeamScore !== "" && entry.AwayTeamScore !== "" &&
      String(entry.HomeTeamScore) !== "null";

    const isCompleted = hasScores && date < new Date();

    fixtures.push({
      sport: league.sport,
      season,
      round: entry.RoundNumber != null ? `Round ${entry.RoundNumber}` : null,
      home_team: entry.HomeTeam ?? null,
      away_team: entry.AwayTeam ?? null,
      start_time: date.toISOString(),
      venue: entry.Location ?? null,
      status: isCompleted ? "completed" : "scheduled",
      home_score: hasScores ? String(entry.HomeTeamScore) : undefined,
      away_score: hasScores ? String(entry.AwayTeamScore) : undefined,
      result_summary: isCompleted
        ? `${entry.HomeTeam} ${entry.HomeTeamScore} - ${entry.AwayTeamScore} ${entry.AwayTeam}`
        : undefined,
    });
  }

  return fixtures;
}

/** Delete all fixtures for a sport/season so feed data replaces them cleanly */
function clearFixturesForSport(sport: string, season: number): number {
  const db = getDatabase();
  const result = db.prepare(
    "DELETE FROM sports_fixtures WHERE sport = ? AND season = ?"
  ).run(sport, season);
  return result.changes;
}

async function refreshLeagueFromFeed(league: LeagueConfig, season: number): Promise<number | null> {
  const log = getLogger();
  if (!league.feedUrl) return null;

  const url = league.feedUrl.replace("{season}", String(season));
  log.info({ sport: league.sport, url }, "Fetching fixtures from JSON feed");

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "OpenClaw-HomeAssistant/1.0" },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      log.warn({ sport: league.sport, status: response.status }, "Feed returned non-OK status");
      return null; // Fall back to AI
    }

    const data = (await response.json()) as FeedEntry[];

    if (!Array.isArray(data) || data.length === 0) {
      log.warn({ sport: league.sport }, "Feed returned empty array");
      return null;
    }

    const fixtures = parseFeedFixtures(data, league, season);

    if (fixtures.length === 0) {
      log.warn({ sport: league.sport, rawCount: data.length }, "Could not parse any fixtures from feed");
      return null;
    }

    // Clear old data first to avoid duplicates from team name mismatches
    // (e.g. AI loaded "Gold Coast Suns" but feed sends "Gold Coast SUNS")
    const deleted = clearFixturesForSport(league.sport, season);
    if (deleted > 0) {
      log.info({ sport: league.sport, deleted }, "Cleared old fixtures before feed load");
    }

    const count = upsertFixtures(fixtures);
    updateRefreshLog(league.sport, season, count, "success", `Direct feed: ${url}`);

    log.info({ sport: league.sport, count }, "Fixtures loaded from JSON feed");
    return count;
  } catch (err) {
    log.warn({ err, sport: league.sport }, "Feed fetch failed, will try AI fallback");
    return null;
  }
}

async function refreshLeagueFromAI(league: LeagueConfig, season: number): Promise<number> {
  const log = getLogger();
  const config = getConfig();
  const adminUserId = getAdminUserId();

  log.info({ sport: league.sport, season }, "Refreshing fixtures via AI");

  const prompt = buildFixturePrompt(league, season);

  try {
    const response = await chat(adminUserId, config.ADMIN_TELEGRAM_ID, prompt);
    const data = extractJSON(response);

    if (!data || data.length === 0) {
      log.warn({ sport: league.sport }, "No fixture data returned from AI");
      updateRefreshLog(league.sport, season, 0, "failed", "No data returned");
      return 0;
    }

    const fixtures = parseFixtures(data, league, season);

    if (fixtures.length === 0) {
      log.warn({ sport: league.sport, rawCount: data.length }, "Could not parse any fixtures from AI response");
      updateRefreshLog(league.sport, season, 0, "failed", "Parse error");
      return 0;
    }

    const count = upsertFixtures(fixtures);
    const status = fixtures.length < 10 ? "partial" : "success";
    updateRefreshLog(league.sport, season, count, status, "AI web search");

    log.info({ sport: league.sport, count, status }, "Fixtures refreshed via AI");
    return count;
  } catch (err) {
    log.error({ err, sport: league.sport }, "Failed to refresh fixtures via AI");
    updateRefreshLog(league.sport, season, 0, "failed", String(err));
    return 0;
  }
}

async function refreshLeague(league: LeagueConfig, season: number): Promise<number> {
  // Try direct JSON feed first (fast, reliable)
  const feedCount = await refreshLeagueFromFeed(league, season);
  if (feedCount !== null && feedCount > 0) return feedCount;

  // Fall back to AI web search (for F1 or if feed fails)
  return refreshLeagueFromAI(league, season);
}

export async function refreshAllFixtures(bot: Bot): Promise<void> {
  const log = getLogger();
  const season = new Date().getFullYear();

  log.info({ season }, "Starting full fixture refresh");

  for (const league of LEAGUE_CONFIGS) {
    // Skip if refreshed within the last 3 days
    const lastRefresh = getRefreshLog(league.sport, season);
    if (lastRefresh && lastRefresh.status !== "failed") {
      const daysSince =
        (Date.now() - new Date(lastRefresh.refreshed_at + "Z").getTime()) /
        (1000 * 60 * 60 * 24);

      if (daysSince < 3) {
        log.info(
          { sport: league.sport, daysSince: Math.round(daysSince) },
          "Skipping — recently refreshed"
        );
        continue;
      }
    }

    await refreshLeague(league, season);

    // Small delay between leagues to avoid hammering the AI
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  log.info({ total: getFixtureCount() }, "Fixture refresh complete");
}

export async function refreshRecentResults(bot: Bot): Promise<void> {
  const log = getLogger();
  const config = getConfig();
  const adminUserId = getAdminUserId();
  const season = new Date().getFullYear();

  log.info("Refreshing recent results");

  for (const league of LEAGUE_CONFIGS) {
    try {
      // For leagues with a feed, just re-fetch the full feed (it includes scores)
      if (league.feedUrl) {
        const feedCount = await refreshLeagueFromFeed(league, season);
        if (feedCount !== null && feedCount > 0) {
          log.info({ sport: league.sport, count: feedCount }, "Results updated from feed");
          continue;
        }
      }

      // AI fallback for F1 or if feed fails
      const prompt = buildResultsPrompt(league, season);
      const response = await chat(adminUserId, config.ADMIN_TELEGRAM_ID, prompt);
      const data = extractJSON(response);

      if (!data || data.length === 0) {
        log.info({ sport: league.sport }, "No recent results");
        continue;
      }

      const fixtures = parseFixtures(data, league, season).map((f) => ({
        ...f,
        status: "completed" as const,
      }));

      if (fixtures.length > 0) {
        upsertFixtures(fixtures);
        log.info({ sport: league.sport, count: fixtures.length }, "Results updated via AI");
      }
    } catch (err) {
      log.error({ err, sport: league.sport }, "Failed to refresh results");
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

export async function checkAndRefreshFixtures(bot: Bot): Promise<void> {
  const log = getLogger();
  const count = getFixtureCount();

  if (count === 0) {
    log.info("No fixtures in DB — triggering initial load");
    // Run in background so it doesn't block startup
    refreshAllFixtures(bot).catch((err) => {
      log.error({ err }, "Initial fixture refresh failed");
    });
  } else {
    log.info({ count }, "Fixtures already loaded");
  }
}

export { LEAGUE_CONFIGS };
