import { google, gmail_v1 } from "googleapis";
import { getOAuth2Client, isGoogleAuthenticated } from "./auth.js";

function getGmail(): gmail_v1.Gmail {
  return google.gmail({ version: "v1", auth: getOAuth2Client() });
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

  // Simple text/plain body
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf-8");
  }

  // Multipart — find text/plain part
  const parts = payload.parts ?? [];
  for (const part of parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return Buffer.from(part.body.data, "base64").toString("utf-8");
    }
  }

  // Fall back to snippet
  return message.snippet ?? "";
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
