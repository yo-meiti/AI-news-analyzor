import { RssItem } from "./types";

export function parseFeedUrls(rawFeeds: string): string[] {
  return rawFeeds.split(",").map((feed) => feed.trim()).filter(Boolean);
}

export async function fetchRssFeed(url: string): Promise<string> {
  const response = await fetch(url, { headers: { accept: "application/rss+xml,application/xml,text/xml" } });
  if (!response.ok) {
    throw new Error(`Failed to fetch RSS feed: ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

export function parseRssXml(xmlText: string): RssItem[] {
  const items: RssItem[] = [];
  const itemMatches = splitItems(xmlText);

  for (const rawItem of itemMatches) {
    const title = cleanText(extractTagText(rawItem, "title"));
    const link = cleanText(extractTagText(rawItem, "link"));
    const summary = cleanText(extractTagText(rawItem, "description") || extractTagText(rawItem, "content:encoded"));
    const publishedAt = parsePublishedAt(extractTagText(rawItem, "pubDate"));

    if (!title || !link) continue;
    items.push({ title, link, summary, sourceUrl: link, publishedAt });
  }

  return items;
}

export function chooseBestItem(items: RssItem[]): RssItem | null {
  let bestItem: RssItem | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const score = scoreItem(item);
    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }
  return bestItem;
}

export function makeExternalId(sourceUrl: string, title: string): string {
  return `news-${simpleHash(`${normalizeUrl(sourceUrl)}|${normalizeText(title)}`)}`;
}

export function buildNewsText(item: RssItem): string {
  return [
    `Title: ${item.title}`,
    item.summary ? `Summary: ${item.summary}` : "",
    `Source URL: ${item.sourceUrl}`,
    item.publishedAt ? `Published: ${item.publishedAt}` : "",
  ].filter(Boolean).join("\n");
}

function scoreItem(item: RssItem): number {
  let score = 0;
  if (item.publishedAt) score += 10;
  score += Math.min(item.summary.length / 50, 5);
  return score;
}

function cleanText(value: string): string {
  return collapseSpaces(value).trim();
}

function normalizeText(value: string): string {
  return cleanText(value).split("").filter((char) => isAllowedCharacter(char)).join("").toLowerCase();
}

function normalizeUrl(value: string): string {
  const cleaned = cleanText(value);
  const hashIndex = cleaned.indexOf("#");
  const withoutHash = hashIndex >= 0 ? cleaned.slice(0, hashIndex) : cleaned;
  return withoutHash.endsWith("/") ? withoutHash.slice(0, -1) : withoutHash;
}

function parsePublishedAt(value: string): string | null {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const date = new Date(cleaned);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(31, hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

function extractTagText(source: string, tagName: string): string {
  const startTag = `<${tagName}`;
  const startIndex = source.toLowerCase().indexOf(startTag.toLowerCase());
  if (startIndex < 0) return "";

  const startCloseIndex = source.indexOf(">", startIndex);
  if (startCloseIndex < 0) return "";

  const endTag = `</${tagName}>`;
  const endIndex = source.toLowerCase().indexOf(endTag.toLowerCase(), startCloseIndex + 1);
  if (endIndex < 0) return "";

  return decodeEntities(source.slice(startCloseIndex + 1, endIndex));
}

function decodeEntities(value: string): string {
  return value
    .split("&lt;").join("<")
    .split("&gt;").join(">")
    .split("&amp;").join("&")
    .split("&quot;").join('"')
    .split("&#39;").join("'")
    .replaceAll("\n", " ")
    .replaceAll("\r", " ")
    .replaceAll("\t", " ")
    .trim();
}

function collapseSpaces(value: string): string {
  let result = "";
  let inWhitespace = false;
  for (const char of String(value)) {
    const isWhitespace = char === " " || char === "\n" || char === "\r" || char === "\t";
    if (isWhitespace) {
      if (!inWhitespace) {
        result += " ";
        inWhitespace = true;
      }
    } else {
      result += char;
      inWhitespace = false;
    }
  }
  return result;
}

function isAllowedCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  const isUpper = code >= 65 && code <= 90;
  const isLower = code >= 97 && code <= 122;
  const isDigit = code >= 48 && code <= 57;
  return isUpper || isLower || isDigit || char === "_" || char === " " || char === "." || char === "-";
}

function splitItems(xmlText: string): string[] {
  const items: string[] = [];
  const lower = xmlText.toLowerCase();
  const openTag = "<item";
  const closeTag = "</item>";
  let searchIndex = 0;

  while (true) {
    const startIndex = lower.indexOf(openTag, searchIndex);
    if (startIndex < 0) break;

    const startCloseIndex = xmlText.indexOf(">", startIndex);
    if (startCloseIndex < 0) break;

    const endIndex = lower.indexOf(closeTag, startCloseIndex + 1);
    if (endIndex < 0) break;

    items.push(xmlText.slice(startIndex, endIndex + closeTag.length));
    searchIndex = endIndex + closeTag.length;
  }

  return items;
}