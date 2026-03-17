import { CopilotClient, CopilotSession, approveAll } from "@github/copilot-sdk";
import { getConfig } from "../config.js";
import { getLogger } from "../utils/logger.js";
import { buildSystemPrompt } from "./prompt.js";
import { createTools } from "./tools.js";
import { createGoogleTools } from "./googleTools.js";
import { createWebTools } from "./webTools.js";
import { getDatabase } from "../db/database.js";

let _client: CopilotClient | null = null;

interface SessionEntry {
  session: CopilotSession;
  userId: number;
  lastUsed: number;
}

const _sessions = new Map<number, SessionEntry>();

// Clean up sessions unused for 30 minutes
const SESSION_TTL_MS = 30 * 60 * 1000;
let _cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startSessionCleanup() {
  if (_cleanupTimer) return;
  _cleanupTimer = setInterval(async () => {
    const now = Date.now();
    for (const [telegramId, entry] of _sessions) {
      if (now - entry.lastUsed > SESSION_TTL_MS) {
        _sessions.delete(telegramId);
        try {
          await entry.session.disconnect();
        } catch {
          // ignore
        }
      }
    }
  }, 5 * 60 * 1000); // Check every 5 minutes
}

export async function initAgent(): Promise<CopilotClient> {
  const config = getConfig();
  const log = getLogger();

  _client = new CopilotClient({
    githubToken: config.GITHUB_TOKEN,
    logLevel: "error",
  });

  await _client.start();
  startSessionCleanup();
  log.info("Copilot SDK client started");
  return _client;
}

async function createSession(userId: number, telegramId: number): Promise<SessionEntry> {
  if (!_client) throw new Error("Agent not initialized. Call initAgent() first.");

  const systemPrompt = await buildSystemPrompt(userId);
  const tools = createTools(userId);

  const db = getDatabase();
  const user = db
    .prepare("SELECT timezone FROM users WHERE id = ?")
    .get(userId) as { timezone: string } | undefined;
  const timezone = user?.timezone ?? "Australia/Melbourne";
  const googleTools = createGoogleTools(userId, timezone);
  const webTools = createWebTools();

  const session = await _client.createSession({
    model: "gpt-4.1",
    systemMessage: {
      mode: "replace",
      content: systemPrompt,
    },
    tools: [...tools, ...googleTools, ...webTools],
    onPermissionRequest: approveAll,
  });

  const entry: SessionEntry = { session, userId, lastUsed: Date.now() };
  _sessions.set(telegramId, entry);
  return entry;
}

export async function chat(
  userId: number,
  telegramId: number,
  message: string
): Promise<string> {
  const log = getLogger();

  let entry = _sessions.get(telegramId);
  if (!entry) {
    entry = await createSession(userId, telegramId);
  }
  entry.lastUsed = Date.now();

  try {
    const response = await entry.session.sendAndWait(
      { prompt: message },
      120_000 // 2 minute timeout
    );

    if (response?.data.content) {
      return response.data.content;
    }

    return "I'm sorry, I didn't get a response. Please try again.";
  } catch (err) {
    log.error({ err, telegramId }, "Chat error");

    // If session is broken, remove it so a fresh one is created next time
    _sessions.delete(telegramId);
    try {
      await entry.session.disconnect();
    } catch {
      // ignore disconnect errors
    }

    return "Something went wrong. Please try again.";
  }
}

export async function refreshSession(telegramId: number) {
  const entry = _sessions.get(telegramId);
  if (entry) {
    _sessions.delete(telegramId);
    try {
      await entry.session.disconnect();
    } catch {
      // ignore
    }
  }
}

export async function stopAgent() {
  if (_cleanupTimer) {
    clearInterval(_cleanupTimer);
    _cleanupTimer = null;
  }

  for (const [, entry] of _sessions) {
    try {
      await entry.session.disconnect();
    } catch {
      // ignore
    }
  }
  _sessions.clear();

  if (_client) {
    await _client.stop();
    _client = null;
  }
}
