import { gmail_v1, gmail } from "@googleapis/gmail";
import { getOAuth2Client, isGoogleAuthenticated } from "./auth.js";

function getGmail(): gmail_v1.Gmail {
  return gmail({ version: "v1", auth: getOAuth2Client() });
}

export interface EmailSummary {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
}

export async function listEmails(
  maxResults = 10,
  query = ""
): Promise<EmailSummary[]> {
  if (!isGoogleAuthenticated()) return [];

  const gmail = getGmail();
  const response = await gmail.users.messages.list({
    userId: "me",
    q: query || undefined,
    maxResults,
  });

  if (!response.data.messages) return [];

  const emails: EmailSummary[] = [];
  for (const msg of response.data.messages) {
    const detail = await gmail.users.messages.get({
      userId: "me",
      id: msg.id!,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"],
    });

    const headers = detail.data.payload?.headers ?? [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
        ?.value ?? "";

    emails.push({
      id: msg.id!,
      from: getHeader("From"),
      subject: getHeader("Subject"),
      snippet: detail.data.snippet ?? "",
      date: getHeader("Date"),
      unread: (detail.data.labelIds ?? []).includes("UNREAD"),
    });
  }

  return emails;
}

export async function getEmailBody(messageId: string): Promise<string> {
  if (!isGoogleAuthenticated()) {
    throw new Error("Google not authenticated. Use /google to connect.");
  }

  const gmail = getGmail();
  const response = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  return extractBody(response.data);
}

function extractBody(message: gmail_v1.Schema$Message): string {
  const payload = message.payload;
  if (!payload) return message.snippet ?? "";

  const text = extractPartByMime(payload, "text/plain");
  if (text) return text;

  // Fall back to HTML stripped of tags
  const html = extractPartByMime(payload, "text/html");
  if (html) return stripHtml(html);

  // Fall back to snippet
  return message.snippet ?? "";
}

export function getEmailHtml(message: gmail_v1.Schema$Message): string {
  const payload = message.payload;
  if (!payload) return "";
  return extractPartByMime(payload, "text/html") ?? "";
}

function extractPartByMime(
  payload: gmail_v1.Schema$MessagePart,
  mimeType: string
): string | null {
  if (payload.mimeType === mimeType && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf-8");
  }

  for (const part of payload.parts ?? []) {
    // Recurse into multipart parts
    const found = extractPartByMime(part, mimeType);
    if (found) return found;
  }

  return null;
}

function stripHtml(html: string): string {
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
    .trim();
}

export function extractLinks(html: string): Array<{ text: string; href: string }> {
  const links: Array<{ text: string; href: string }> = [];
  const pattern = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const href = match[1].replace(/&amp;/g, "&");
    const text = match[2].replace(/<[^>]+>/g, "").trim();
    if (href && text) links.push({ text, href });
  }
  return links;
}

export async function getFullEmail(messageId: string) {
  if (!isGoogleAuthenticated()) {
    throw new Error("Google not authenticated.");
  }

  const gmail = getGmail();
  const response = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const headers = response.data.payload?.headers ?? [];
  const getHeader = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

  return {
    id: messageId,
    from: getHeader("From"),
    subject: getHeader("Subject"),
    date: getHeader("Date"),
    body: extractBody(response.data),
    html: getEmailHtml(response.data),
    links: extractLinks(getEmailHtml(response.data)),
    labelIds: response.data.labelIds ?? [],
  };
}

export async function sendEmail(
  to: string,
  subject: string,
  body: string
): Promise<string> {
  if (!isGoogleAuthenticated()) {
    throw new Error("Google not authenticated. Use /google to connect.");
  }

  const gmail = getGmail();

  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "MIME-Version: 1.0",
    "",
    body,
  ].join("\r\n");

  const encodedMessage = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encodedMessage },
  });

  return response.data.id ?? "";
}

export async function searchEmails(
  query: string,
  maxResults = 5
): Promise<EmailSummary[]> {
  return listEmails(maxResults, query);
}
