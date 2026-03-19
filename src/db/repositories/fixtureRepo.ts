import { getDatabase } from "../database.js";
import { getAllFavouriteTeams } from "./familyRepo.js";
import { formatInTimeZone } from "date-fns-tz";
import { addDays, subDays } from "date-fns";

export interface SportFixture {
  id: number;
  sport: string;
  season: number;
  round: string | null;
  home_team: string | null;
  away_team: string | null;
  event_name: string | null;
  start_time: string;
  venue: string | null;
  status: string;
  home_score: string | null;
  away_score: string | null;
  result_summary: string | null;
  broadcast: string | null;
  updated_at: string;
  created_at: string;
}

export interface FixtureInput {
  sport: string;
  season: number;
  round?: string;
  home_team?: string;
  away_team?: string;
  event_name?: string;
  start_time: string;
  venue?: string;
  status?: string;
  home_score?: string;
  away_score?: string;
  result_summary?: string;
  broadcast?: string;
}

export interface FixtureQuery {
  sport?: string;
  team?: string;
  fromDate?: string;
  toDate?: string;
  round?: string;
  status?: string;
  limit?: number;
}

export interface FixtureWithFollowers extends SportFixture {
  followers: string[];
}

// --- Upsert ---

export function upsertFixture(data: FixtureInput): void {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO sports_fixtures (sport, season, round, home_team, away_team, event_name, start_time, venue, status, home_score, away_score, result_summary, broadcast, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(sport, season, round, home_team, away_team, event_name)
     DO UPDATE SET
       start_time = COALESCE(excluded.start_time, start_time),
       venue = COALESCE(excluded.venue, venue),
       status = COALESCE(excluded.status, status),
       home_score = COALESCE(excluded.home_score, home_score),
       away_score = COALESCE(excluded.away_score, away_score),
       result_summary = COALESCE(excluded.result_summary, result_summary),
       broadcast = COALESCE(excluded.broadcast, broadcast),
       updated_at = datetime('now')`
  ).run(
    data.sport,
    data.season,
    data.round ?? null,
    data.home_team ?? null,
    data.away_team ?? null,
    data.event_name ?? null,
    data.start_time,
    data.venue ?? null,
    data.status ?? "scheduled",
    data.home_score ?? null,
    data.away_score ?? null,
    data.result_summary ?? null,
    data.broadcast ?? null
  );
}

export function upsertFixtures(fixtures: FixtureInput[]): number {
  const db = getDatabase();
  let count = 0;
  const transaction = db.transaction(() => {
    for (const f of fixtures) {
      upsertFixture(f);
      count++;
    }
  });
  transaction();
  return count;
}

// --- Queries ---

export function getFixturesForDate(
  date: string,
  timezone: string
): SportFixture[] {
  const db = getDatabase();
  const refDate = new Date(date);
  const dayStart = formatInTimeZone(refDate, timezone, "yyyy-MM-dd'T'00:00:00");
  const dayEnd = formatInTimeZone(refDate, timezone, "yyyy-MM-dd'T'23:59:59");

  // Convert local boundaries to UTC for querying
  const utcStart = new Date(dayStart + getTimezoneOffsetStr(timezone)).toISOString();
  const utcEnd = new Date(dayEnd + getTimezoneOffsetStr(timezone)).toISOString();

  return db
    .prepare(
      `SELECT * FROM sports_fixtures
       WHERE start_time >= ? AND start_time <= ?
       ORDER BY start_time`
    )
    .all(utcStart, utcEnd) as SportFixture[];
}

export function getFixturesForTeam(
  teamName: string,
  opts?: { limit?: number; fromDate?: string; upcoming?: boolean }
): SportFixture[] {
  const db = getDatabase();
  const canonical = resolveTeamName(teamName);
  const searchName = canonical ?? teamName;

  let sql = `SELECT * FROM sports_fixtures WHERE (
    LOWER(home_team) LIKE ? OR LOWER(away_team) LIKE ? OR LOWER(event_name) LIKE ?
  )`;
  const params: unknown[] = [
    `%${searchName.toLowerCase()}%`,
    `%${searchName.toLowerCase()}%`,
    `%${searchName.toLowerCase()}%`,
  ];

  if (opts?.upcoming) {
    sql += " AND start_time >= ? AND status = 'scheduled'";
    params.push(new Date().toISOString());
  } else if (opts?.fromDate) {
    sql += " AND start_time >= ?";
    params.push(opts.fromDate);
  }

  sql += " ORDER BY start_time";

  if (opts?.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }

  return db.prepare(sql).all(...params) as SportFixture[];
}

export function getFixturesForFavouriteTeams(
  userId: number,
  date: string,
  timezone: string
): FixtureWithFollowers[] {
  const teams = getAllFavouriteTeams(userId);
  if (teams.length === 0) return [];

  const dayFixtures = getFixturesForDate(date, timezone);
  if (dayFixtures.length === 0) return [];

  const results: FixtureWithFollowers[] = [];

  for (const fixture of dayFixtures) {
    const followers: string[] = [];

    for (const team of teams) {
      const canonical = resolveTeamName(team.team);
      const search = (canonical ?? team.team).toLowerCase();

      const matchesHome = fixture.home_team?.toLowerCase().includes(search);
      const matchesAway = fixture.away_team?.toLowerCase().includes(search);
      const matchesEvent = fixture.event_name?.toLowerCase().includes(search);

      if (matchesHome || matchesAway || matchesEvent) {
        followers.push(...team.members);
      }
    }

    if (followers.length > 0) {
      results.push({
        ...fixture,
        followers: [...new Set(followers)],
      });
    }
  }

  return results;
}

export function getUpcomingFixtures(
  sport: string,
  limit = 10
): SportFixture[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT * FROM sports_fixtures
       WHERE sport = ? AND start_time >= ? AND status = 'scheduled'
       ORDER BY start_time
       LIMIT ?`
    )
    .all(sport, new Date().toISOString(), limit) as SportFixture[];
}

export function getRecentResults(
  sport?: string,
  days = 3
): SportFixture[] {
  const db = getDatabase();
  const cutoff = subDays(new Date(), days).toISOString();

  if (sport) {
    return db
      .prepare(
        `SELECT * FROM sports_fixtures
         WHERE sport = ? AND status = 'completed' AND start_time >= ?
         ORDER BY start_time DESC
         LIMIT 20`
      )
      .all(sport, cutoff) as SportFixture[];
  }

  return db
    .prepare(
      `SELECT * FROM sports_fixtures
       WHERE status = 'completed' AND start_time >= ?
       ORDER BY start_time DESC
       LIMIT 20`
    )
    .all(cutoff) as SportFixture[];
}

export function queryFixtures(query: FixtureQuery): SportFixture[] {
  const db = getDatabase();
  let sql = "SELECT * FROM sports_fixtures WHERE 1=1";
  const params: unknown[] = [];

  if (query.sport) {
    sql += " AND UPPER(sport) = UPPER(?)";
    params.push(query.sport);
  }

  if (query.team) {
    const canonical = resolveTeamName(query.team);
    const search = (canonical ?? query.team).toLowerCase();
    sql += " AND (LOWER(home_team) LIKE ? OR LOWER(away_team) LIKE ? OR LOWER(event_name) LIKE ?)";
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (query.fromDate) {
    sql += " AND start_time >= ?";
    params.push(query.fromDate);
  }

  if (query.toDate) {
    sql += " AND start_time <= ?";
    params.push(query.toDate);
  }

  if (query.round) {
    sql += " AND LOWER(round) LIKE LOWER(?)";
    params.push(`%${query.round}%`);
  }

  if (query.status) {
    sql += " AND status = ?";
    params.push(query.status);
  }

  sql += " ORDER BY start_time";

  if (query.limit) {
    sql += " LIMIT ?";
    params.push(query.limit);
  } else {
    sql += " LIMIT 20";
  }

  return db.prepare(sql).all(...params) as SportFixture[];
}

// --- Team Aliases ---

export function resolveTeamName(input: string, sport?: string): string | null {
  const db = getDatabase();
  const normalized = input.toLowerCase().trim();

  // Direct alias lookup
  let sql = "SELECT canonical_name FROM team_aliases WHERE alias = ?";
  const params: unknown[] = [normalized];
  if (sport) {
    sql += " AND UPPER(sport) = UPPER(?)";
    params.push(sport);
  }

  const alias = db.prepare(sql).get(...params) as { canonical_name: string } | undefined;
  if (alias) return alias.canonical_name;

  // Fuzzy match in fixtures
  let fuzzySql = `SELECT DISTINCT home_team FROM sports_fixtures WHERE LOWER(home_team) LIKE ?`;
  const fuzzyParams: unknown[] = [`%${normalized}%`];
  if (sport) {
    fuzzySql += " AND UPPER(sport) = UPPER(?)";
    fuzzyParams.push(sport);
  }
  fuzzySql += " LIMIT 1";

  const fuzzy = db.prepare(fuzzySql).get(...fuzzyParams) as { home_team: string } | undefined;
  if (fuzzy) return fuzzy.home_team;

  return null;
}

export function upsertTeamAlias(
  alias: string,
  canonicalName: string,
  sport: string
): void {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO team_aliases (alias, canonical_name, sport)
     VALUES (?, ?, ?)
     ON CONFLICT(alias) DO UPDATE SET canonical_name = excluded.canonical_name, sport = excluded.sport`
  ).run(alias.toLowerCase().trim(), canonicalName, sport);
}

export function seedDefaultAliases(): void {
  const db = getDatabase();
  const count = db
    .prepare("SELECT COUNT(*) as c FROM team_aliases")
    .get() as { c: number };

  // Only seed if empty
  if (count.c > 0) return;

  const aliases: Array<[string, string, string]> = [
    // AFL
    ["adelaide", "Adelaide Crows", "AFL"],
    ["crows", "Adelaide Crows", "AFL"],
    ["brisbane", "Brisbane Lions", "AFL"],
    ["lions", "Brisbane Lions", "AFL"],
    ["carlton", "Carlton Blues", "AFL"],
    ["blues", "Carlton Blues", "AFL"],
    ["collingwood", "Collingwood Magpies", "AFL"],
    ["pies", "Collingwood Magpies", "AFL"],
    ["magpies", "Collingwood Magpies", "AFL"],
    ["essendon", "Essendon Bombers", "AFL"],
    ["bombers", "Essendon Bombers", "AFL"],
    ["dons", "Essendon Bombers", "AFL"],
    ["fremantle", "Fremantle Dockers", "AFL"],
    ["dockers", "Fremantle Dockers", "AFL"],
    ["freo", "Fremantle Dockers", "AFL"],
    ["geelong", "Geelong Cats", "AFL"],
    ["cats", "Geelong Cats", "AFL"],
    ["gold coast", "Gold Coast Suns", "AFL"],
    ["suns", "Gold Coast Suns", "AFL"],
    ["gws", "GWS Giants", "AFL"],
    ["giants", "GWS Giants", "AFL"],
    ["greater western sydney", "GWS Giants", "AFL"],
    ["hawthorn", "Hawthorn Hawks", "AFL"],
    ["hawks", "Hawthorn Hawks", "AFL"],
    ["melbourne", "Melbourne Demons", "AFL"],
    ["demons", "Melbourne Demons", "AFL"],
    ["north melbourne", "North Melbourne Kangaroos", "AFL"],
    ["kangaroos", "North Melbourne Kangaroos", "AFL"],
    ["roos", "North Melbourne Kangaroos", "AFL"],
    ["north", "North Melbourne Kangaroos", "AFL"],
    ["port adelaide", "Port Adelaide Power", "AFL"],
    ["power", "Port Adelaide Power", "AFL"],
    ["port", "Port Adelaide Power", "AFL"],
    ["richmond", "Richmond Tigers", "AFL"],
    ["tigers", "Richmond Tigers", "AFL"],
    ["st kilda", "St Kilda Saints", "AFL"],
    ["saints", "St Kilda Saints", "AFL"],
    ["sydney", "Sydney Swans", "AFL"],
    ["swans", "Sydney Swans", "AFL"],
    ["west coast", "West Coast Eagles", "AFL"],
    ["eagles", "West Coast Eagles", "AFL"],
    ["western bulldogs", "Western Bulldogs", "AFL"],
    ["bulldogs", "Western Bulldogs", "AFL"],
    ["dogs", "Western Bulldogs", "AFL"],
    ["footscray", "Western Bulldogs", "AFL"],

    // NRL
    ["broncos", "Brisbane Broncos", "NRL"],
    ["brisbane broncos", "Brisbane Broncos", "NRL"],
    ["raiders", "Canberra Raiders", "NRL"],
    ["canberra", "Canberra Raiders", "NRL"],
    ["bulldogs nrl", "Canterbury Bulldogs", "NRL"],
    ["canterbury", "Canterbury Bulldogs", "NRL"],
    ["sharks", "Cronulla Sharks", "NRL"],
    ["cronulla", "Cronulla Sharks", "NRL"],
    ["titans", "Gold Coast Titans", "NRL"],
    ["manly", "Manly Sea Eagles", "NRL"],
    ["sea eagles", "Manly Sea Eagles", "NRL"],
    ["storm", "Melbourne Storm", "NRL"],
    ["melbourne storm", "Melbourne Storm", "NRL"],
    ["knights", "Newcastle Knights", "NRL"],
    ["newcastle", "Newcastle Knights", "NRL"],
    ["cowboys", "North Queensland Cowboys", "NRL"],
    ["north queensland", "North Queensland Cowboys", "NRL"],
    ["eels", "Parramatta Eels", "NRL"],
    ["parramatta", "Parramatta Eels", "NRL"],
    ["panthers", "Penrith Panthers", "NRL"],
    ["penrith", "Penrith Panthers", "NRL"],
    ["dolphins", "Dolphins", "NRL"],
    ["redcliffe", "Dolphins", "NRL"],
    ["rabbitohs", "South Sydney Rabbitohs", "NRL"],
    ["souths", "South Sydney Rabbitohs", "NRL"],
    ["south sydney", "South Sydney Rabbitohs", "NRL"],
    ["roosters", "Sydney Roosters", "NRL"],
    ["sydney roosters", "Sydney Roosters", "NRL"],
    ["warriors", "New Zealand Warriors", "NRL"],
    ["nz warriors", "New Zealand Warriors", "NRL"],
    ["dragons", "St George Illawarra Dragons", "NRL"],
    ["st george", "St George Illawarra Dragons", "NRL"],
    ["wests tigers", "Wests Tigers", "NRL"],
    ["wests", "Wests Tigers", "NRL"],

    // F1 Constructors
    ["red bull", "Red Bull Racing", "F1"],
    ["redbull", "Red Bull Racing", "F1"],
    ["red bull racing", "Red Bull Racing", "F1"],
    ["mercedes", "Mercedes", "F1"],
    ["ferrari", "Ferrari", "F1"],
    ["mclaren", "McLaren", "F1"],
    ["aston martin", "Aston Martin", "F1"],
    ["alpine", "Alpine", "F1"],
    ["williams", "Williams", "F1"],
    ["haas", "Haas", "F1"],
    ["rb", "RB", "F1"],
    ["visa cash app rb", "RB", "F1"],
    ["sauber", "Sauber", "F1"],
    ["kick sauber", "Sauber", "F1"],

    // F1 Drivers (common names)
    ["verstappen", "Red Bull Racing", "F1"],
    ["max verstappen", "Red Bull Racing", "F1"],
    ["hamilton", "Ferrari", "F1"],
    ["leclerc", "Ferrari", "F1"],
    ["norris", "McLaren", "F1"],
    ["lando", "McLaren", "F1"],
    ["piastri", "McLaren", "F1"],
    ["oscar", "McLaren", "F1"],
    ["alonso", "Aston Martin", "F1"],

    // Super Netball
    ["vixens", "Melbourne Vixens", "Super Netball"],
    ["melbourne vixens", "Melbourne Vixens", "Super Netball"],
    ["fever", "West Coast Fever", "Super Netball"],
    ["west coast fever", "West Coast Fever", "Super Netball"],
    ["swifts", "NSW Swifts", "Super Netball"],
    ["nsw swifts", "NSW Swifts", "Super Netball"],
    ["firebirds", "Queensland Firebirds", "Super Netball"],
    ["queensland firebirds", "Queensland Firebirds", "Super Netball"],
    ["thunderbirds", "Adelaide Thunderbirds", "Super Netball"],
    ["adelaide thunderbirds", "Adelaide Thunderbirds", "Super Netball"],
    ["magpies netball", "Collingwood Magpies Netball", "Super Netball"],
    ["collingwood magpies netball", "Collingwood Magpies Netball", "Super Netball"],
    ["giants netball", "Giants Netball", "Super Netball"],
    ["sunshine coast lightning", "Sunshine Coast Lightning", "Super Netball"],
    ["lightning", "Sunshine Coast Lightning", "Super Netball"],
  ];

  const stmt = db.prepare(
    "INSERT OR IGNORE INTO team_aliases (alias, canonical_name, sport) VALUES (?, ?, ?)"
  );

  const transaction = db.transaction(() => {
    for (const [alias, canonical, sport] of aliases) {
      stmt.run(alias, canonical, sport);
    }
  });

  transaction();
}

// --- Refresh Log ---

export function getRefreshLog(
  sport: string,
  season?: number
): { refreshed_at: string; fixtures_count: number; status: string } | undefined {
  const db = getDatabase();
  const s = season ?? new Date().getFullYear();
  return db
    .prepare("SELECT refreshed_at, fixtures_count, status FROM fixture_refresh_log WHERE sport = ? AND season = ?")
    .get(sport, s) as { refreshed_at: string; fixtures_count: number; status: string } | undefined;
}

export function updateRefreshLog(
  sport: string,
  season: number,
  count: number,
  status: string,
  notes?: string
): void {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO fixture_refresh_log (sport, season, fixtures_count, status, notes, refreshed_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(sport, season) DO UPDATE SET
       fixtures_count = excluded.fixtures_count,
       status = excluded.status,
       notes = excluded.notes,
       refreshed_at = datetime('now')`
  ).run(sport, season, count, status, notes ?? null);
}

// --- Fixture Formatting ---

export function formatFixture(fixture: SportFixture, timezone: string): string {
  const time = formatInTimeZone(
    new Date(fixture.start_time),
    timezone,
    "EEE d MMM, h:mm a"
  );

  if (fixture.sport === "F1") {
    let line = `🏎️ ${fixture.event_name ?? "Race"}`;
    if (fixture.round) line += ` (${fixture.round})`;
    line += ` — ${time}`;
    if (fixture.venue) line += ` at ${fixture.venue}`;
    if (fixture.status === "completed" && fixture.result_summary) {
      line += ` | ${fixture.result_summary}`;
    }
    if (fixture.broadcast) line += ` | 📺 ${fixture.broadcast}`;
    return line;
  }

  let line = `${fixture.home_team ?? "TBD"} vs ${fixture.away_team ?? "TBD"}`;
  if (fixture.round) line += ` (${fixture.round})`;
  line += ` — ${time}`;
  if (fixture.venue) line += ` at ${fixture.venue}`;
  if (fixture.status === "completed") {
    if (fixture.home_score && fixture.away_score) {
      line += ` | ${fixture.home_score} - ${fixture.away_score}`;
    }
    if (fixture.result_summary) line += ` (${fixture.result_summary})`;
  }
  if (fixture.broadcast) line += ` | 📺 ${fixture.broadcast}`;

  return line;
}

export function getFixtureCount(): number {
  const db = getDatabase();
  const row = db.prepare("SELECT COUNT(*) as c FROM sports_fixtures").get() as { c: number };
  return row.c;
}

// --- Helpers ---

function getTimezoneOffsetStr(timezone: string): string {
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
