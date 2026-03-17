import { type Tool } from "@github/copilot-sdk";
import { getLogger } from "../utils/logger.js";

/**
 * Fetches a web page and extracts text content.
 * Uses a simple approach — fetch HTML, strip tags.
 */
async function fetchPageText(url: string): Promise<string> {
  const log = getLogger();
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; OpenClaw/1.0; +https://github.com/jamesevans28/home-assistant)",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return `Error fetching ${url}: ${res.status}`;
    const html = await res.text();

    // Strip HTML tags and extract text
    const text = html
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

    // Limit to ~4000 chars
    return text.slice(0, 4000);
  } catch (err) {
    log.error({ err, url }, "Failed to fetch page");
    return `Failed to fetch ${url}`;
  }
}

/**
 * Simple web search using DuckDuckGo HTML search (no API key needed).
 */
async function searchWeb(query: string, maxResults = 5): Promise<string> {
  const log = getLogger();
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; OpenClaw/1.0; +https://github.com/jamesevans28/home-assistant)",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return `Search failed: ${res.status}`;
    const html = await res.text();

    // Extract search results from DuckDuckGo HTML
    const results: string[] = [];
    const resultPattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetPattern = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    const links: Array<{ url: string; title: string }> = [];
    let match;
    while ((match = resultPattern.exec(html)) !== null) {
      const href = decodeURIComponent(
        match[1].replace(/.*uddg=/, "").replace(/&.*/, "")
      );
      const title = match[2].replace(/<[^>]+>/g, "").trim();
      links.push({ url: href, title });
    }

    const snippets: string[] = [];
    while ((match = snippetPattern.exec(html)) !== null) {
      snippets.push(match[1].replace(/<[^>]+>/g, "").trim());
    }

    for (let i = 0; i < Math.min(links.length, maxResults); i++) {
      const snippet = snippets[i] ? `\n   ${snippets[i]}` : "";
      results.push(`${i + 1}. ${links[i].title}\n   ${links[i].url}${snippet}`);
    }

    return results.length > 0
      ? results.join("\n\n")
      : "No search results found.";
  } catch (err) {
    log.error({ err, query }, "Web search failed");
    return `Search failed for "${query}"`;
  }
}

export function createWebTools(): Tool[] {
  return [
    {
      name: "web_search",
      description:
        "Search the web for current information. Use for news, sports scores, weather, trending topics, or any real-time data. Returns titles, URLs, and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Search query, e.g. 'AFL latest news scores March 2026', 'F1 race results today'",
          },
          max_results: {
            type: "number",
            description: "Maximum results to return. Default 5.",
          },
        },
        required: ["query"],
      },
      handler: async (args: unknown) => {
        const { query, max_results = 5 } = args as {
          query: string;
          max_results?: number;
        };
        return searchWeb(query, max_results);
      },
    },
    {
      name: "web_fetch",
      description:
        "Fetch and read the text content of a web page. Use to read full articles, news stories, or any URL. Returns plain text extracted from the page.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to fetch",
          },
        },
        required: ["url"],
      },
      handler: async (args: unknown) => {
        const { url } = args as { url: string };
        return fetchPageText(url);
      },
    },
  ];
}
