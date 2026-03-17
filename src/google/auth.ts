import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname } from "path";
import { mkdirSync } from "fs";
import { getConfig } from "../config.js";
import { getLogger } from "../utils/logger.js";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
];

let _oauth2Client: OAuth2Client | null = null;
let _authenticated = false;

export function getOAuth2Client(): OAuth2Client {
  if (_oauth2Client) return _oauth2Client;

  const config = getConfig();

  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env"
    );
  }

  _oauth2Client = new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    config.GOOGLE_REDIRECT_URI
  );

  // Try to load saved token
  const tokenPath = config.GOOGLE_TOKEN_PATH;
  if (existsSync(tokenPath)) {
    const token = JSON.parse(readFileSync(tokenPath, "utf-8"));
    _oauth2Client.setCredentials(token);
    _authenticated = true;

    // Auto-refresh on token update
    _oauth2Client.on("tokens", (tokens) => {
      const log = getLogger();
      const existing = JSON.parse(readFileSync(tokenPath, "utf-8"));
      const updated = { ...existing, ...tokens };
      saveToken(updated);
      log.info("Google OAuth token refreshed");
    });
  }

  return _oauth2Client;
}

export function isGoogleAuthenticated(): boolean {
  return _authenticated;
}

export function getAuthUrl(): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function handleAuthCode(code: string): Promise<void> {
  const log = getLogger();
  const client = getOAuth2Client();

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  saveToken(tokens);
  _authenticated = true;

  // Set up auto-refresh listener
  client.on("tokens", (newTokens) => {
    const config = getConfig();
    const existing = JSON.parse(
      readFileSync(config.GOOGLE_TOKEN_PATH, "utf-8")
    );
    const updated = { ...existing, ...newTokens };
    saveToken(updated);
    log.info("Google OAuth token refreshed");
  });

  log.info("Google OAuth authentication complete");
}

function saveToken(tokens: unknown) {
  const config = getConfig();
  const tokenPath = config.GOOGLE_TOKEN_PATH;
  const dir = dirname(tokenPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
}

export function isGoogleConfigured(): boolean {
  const config = getConfig();
  return !!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
}
