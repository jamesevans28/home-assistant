import { CopilotClient, CopilotSession, approveAll } from "@github/copilot-sdk";
import { getConfig } from "../config.js";
import { getLogger } from "../utils/logger.js";
import { buildSystemPrompt } from "./prompt.js";
import { createTools } from "./tools.js";
import { createGoogleTools } from "./googleTools.js";
import { getDatabase } from "../db/database.js";

let _client: CopilotClient | null = null;
const _sessions = new Map<number, CopilotSession>();

export async function initAgent(): Promise<CopilotClient> {
  const config = getConfig();
  const log = getLogger();

  _client = new CopilotClient({
    githubToken: config.GITHUB_TOKEN,
    logLevel: "error",
  });

  await _client.start();
  log.info("Copilot SDK client started");
  return _client;
}

async function getOrCreateSession(userId: number, telegramId: number): Promise<CopilotSession> {
  const existing = _sessions.get(telegramId);
  if (existing) return existing;

  if (!_client) throw new Error("Agent not initialized. Call initAgent() first.");

  const systemPrompt = await buildSystemPrompt(userId);
  const tools = createTools(userId);

  // Get user timezone for Google tools
  const db = getDatabase();
  const user = db
    .prepare("SELECT timezone FROM users WHERE id = ?")
    .get(userId) as { timezone: string } | undefined;
  const timezone = user?.timezone ?? "Australia/Melbourne";
  const googleTools = createGoogleTools(userId, timezone);

  const session = await _client.createSession({
    model: "gpt-4.1",
    systemMessage: {
      mode: "replace",
      content: systemPrompt,
    },
    tools: [...tools, ...googleTools],
    onPermissionRequest: approveAll,
  });

  _sessions.set(telegramId, session);
  return session;
}

export async function chat(
  userId: number,
  telegramId: number,
  message: string
): Promise<string> {
  const log = getLogger();
  const session = await getOrCreateSession(userId, telegramId);

  // Update system prompt with latest state before each message
  const systemPrompt = await buildSystemPrompt(userId);
  // Note: system prompt is set at session creation; for updates we recreate if needed

  try {
    const response = await session.sendAndWait(
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
      await session.disconnect();
    } catch {
      // ignore disconnect errors
    }

    return "Something went wrong. Please try again.";
  }
}

export async function refreshSession(telegramId: number) {
  const session = _sessions.get(telegramId);
  if (session) {
    _sessions.delete(telegramId);
    try {
      await session.disconnect();
    } catch {
      // ignore
    }
  }
}

export async function stopAgent() {
  for (const [id, session] of _sessions) {
    try {
      await session.disconnect();
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
