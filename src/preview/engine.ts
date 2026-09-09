/**
 * Link Preview Engine (Phase 3, spec §25–§26) — a first-class subsystem.
 *
 * Lifecycle: DISCOVER → FETCH → NORMALIZE → THUMBNAIL → VALIDATE → READY → CACHE.
 * Incomplete results are never cached; thumbnails are normalized (sharp);
 * entries are versioned so renderer improvements never inherit stale
 * artifacts; concurrency is capped; per-URL work is single-flight.
 */

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import sharp from "sharp";
import { classifyError } from "../core/errors.js";

export const PREVIEW_CACHE_VERSION = "v1";
const FETCH_TIMEOUT_MS = 8_000;
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const NORMALIZED_MAX_DIMENSION = 1920;
const NORMALIZED_MAX_BYTES = 512 * 1024;
const CONCURRENCY = 8;
const LOCAL_CACHE_MAX = 512;
const SUCCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 60_000;

const URL_PATTERN = /(?:https?:\/\/|www\.)[a-z0-9-._~%]+(?::\d+)?(?:\/[a-z0-9-._~!$&'()*+,;=:@%]*)*(?:\?[a-z0-9-._~!$&'()*+,;=:@%\/?]*)?/gi;
const TRAILING_PUNCTUATION = /[),.;!?]+$/;

export interface PreviewRecord {
  schemaVersion: typeof PREVIEW_CACHE_VERSION;
  canonicalUrl: string;
  title?: string;
  description?: string;
  siteName?: string;
  /** Normalized JPEG bytes (validated) — this is what makes the preview complete. */
  thumbnail?: Buffer;
  sourceWidth?: number;
  sourceHeight?: number;
  fetchedAt: number;
  expiresAt: number;
}

export function discoverUrls(text: string): string[] {
  const matches = text.match(URL_PATTERN) ?? [];
  const cleaned = matches
    .map((url) => url.replace(TRAILING_PUNCTUATION, ""))
    .filter((url) => /^https?:\/\//iu.test(url) || /^www\./iu.test(url))
    .map((url) => (url.startsWith("www.") ? `https://${url}` : url));
  return [...new Set(cleaned)].slice(0, 5);
}

/** SSRF guard: reject loopback/private targets before fetching. */
function assertPublicHost(hostname: string): void {
  if (isIP(hostname) !== 0) {
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/u.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./u.test(hostname))
      throw new Error("Private network hosts are not fetched.");
    return;
  }
  if (/(^|\.)(localhost|internal|local)$/iu.test(hostname)) throw new Error("Private network hosts are not fetched.");
}

export function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url.startsWith("www.") ? `https://${url}` : url);
    parsed.protocol = "https:";
    parsed.hash = "";
    // Drop common tracking params (audited approach from the reference).
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref|ref_src|ref_dst)/iu.test(key)) parsed.searchParams.delete(key);
    }
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) parsed.pathname = parsed.pathname.slice(0, -1);
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString();
  } catch {
    return url;
  }
}

async function fetchWithRedirects(url: string, depth = 0): Promise<{ finalUrl: string; body: Buffer; contentType: string }> {
  if (depth > MAX_REDIRECTS) throw new Error("Too many redirects.");
  const parsed = new URL(url);
  assertPublicHost(parsed.hostname);
  // DNS pinning: resolve then fetch by IP with Host header is overkill here;
  // re-check resolved addresses to refuse DNS-rebinding to private space.
  if (isIP(parsed.hostname) === 0) {
    const addresses = await lookup(parsed.hostname, { all: true }).catch(() => []);
    for (const address of addresses) assertPublicHost(address.address);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(parsed, {
      signal: controller.signal,
      redirect: "manual",
      headers: { "user-agent": "Mozilla/5.0 (compatible; SaaSPromoterBot/1.0; link-preview)" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect without location.");
      return fetchWithRedirects(new URL(location, parsed).toString(), depth + 1);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_HTML_BYTES && contentType.includes("text/html")) throw new Error("HTML too large.");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > (contentType.includes("text/html") ? MAX_HTML_BYTES : MAX_IMAGE_BYTES))
      throw new Error("Payload too large.");
    return { finalUrl: parsed.toString(), body: buffer, contentType };
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, "\"")
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)));
}

function metaContent(html: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const patterns = [
      new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["']`, "iu"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${key}["']`, "iu"),
      new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["']`, "iu"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${key}["']`, "iu"),
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(html);
      if (match?.[1]) return decodeHtml(match[1]).trim();
    }
  }
  return undefined;
}

interface NormalizedMetadata {
  title?: string;
  description?: string;
  siteName?: string;
  imageUrl?: string;
}

function normalizeMetadata(html: string, baseUrl: string): NormalizedMetadata {
  const title = metaContent(html, ["og:title", "twitter:title"]) ?? /<title[^>]*>([^<]*)<\/title>/iu.exec(html)?.[1]?.trim();
  const description = metaContent(html, ["og:description", "twitter:description", "description"]);
  const siteName = metaContent(html, ["og:site_name"]);
  let imageUrl = metaContent(html, ["og:image", "og:image:secure_url", "twitter:image", "twitter:image:src"]);
  if (imageUrl && !/^https?:\/\//iu.test(imageUrl)) {
    try {
      imageUrl = new URL(imageUrl, baseUrl).toString();
    } catch {
      imageUrl = undefined;
    }
  }
  return {
    ...(title ? { title: decodeHtml(title).slice(0, 300) } : {}),
    ...(description ? { description: decodeHtml(description).slice(0, 500) } : {}),
    ...(siteName ? { siteName: decodeHtml(siteName) } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };
}

/** Normalize any image into a small JPEG thumbnail; validate before returning. */
export async function normalizeThumbnail(input: Buffer): Promise<{ bytes: Buffer; width: number; height: number }> {
  const image = sharp(input, { failOn: "warning" }).rotate();
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const needsResize = width > NORMALIZED_MAX_DIMENSION || height > NORMALIZED_MAX_DIMENSION;
  let pipeline = needsResize ? image.resize({ width: NORMALIZED_MAX_DIMENSION, height: NORMALIZED_MAX_DIMENSION, fit: "inside" }) : image;
  pipeline = pipeline.jpeg({ quality: 85 });
  const bytes = await pipeline.toBuffer();
  if (bytes.byteLength > NORMALIZED_MAX_BYTES) {
    const smaller = await sharp(input).rotate().resize({ width: 800, height: 800, fit: "inside" }).jpeg({ quality: 75 }).toBuffer();
    return { bytes: smaller, width: Math.min(width || 800, 800), height: Math.min(height || 800, 800) };
  }
  return { bytes, width, height };
}

// ---- Cache + concurrency ----

export interface PreviewCacheSink {
  get(key: string): Promise<PreviewRecord | undefined>;
  set(key: string, record: PreviewRecord, ttlMs: number): Promise<void>;
}

class MemoryCache implements PreviewCacheSink {
  private readonly entries = new Map<string, PreviewRecord>();
  async get(key: string): Promise<PreviewRecord | undefined> {
    const record = this.entries.get(key);
    if (!record) return undefined;
    if (record.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return record;
  }
  async set(key: string, record: PreviewRecord, ttlMs: number): Promise<void> {
    this.entries.set(key, record);
    if (this.entries.size > LOCAL_CACHE_MAX) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    void ttlMs;
  }
}

let cacheSink: PreviewCacheSink = new MemoryCache();
const inFlight = new Map<string, Promise<PreviewRecord | undefined>>();
const failureUntil = new Map<string, number>();
const queue: Array<() => void> = [];
let active = 0;

async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push(() => {
      active += 1;
      void task().then(resolve, reject).finally(() => {
        active -= 1;
        while (active < CONCURRENCY && queue.length) queue.shift()?.();
      });
    });
    while (active < CONCURRENCY && queue.length) queue.shift()?.();
  });
}

function cacheKey(canonicalUrl: string): string {
  return `${PREVIEW_CACHE_VERSION}:${createHash("sha256").update(canonicalUrl).digest("hex")}`;
}

/** Validate a candidate record: a preview without a thumbnail is incomplete. */
function validateRecord(record: PreviewRecord): PreviewRecord | undefined {
  if (!record.thumbnail || record.thumbnail.byteLength === 0) return undefined;
  if (!record.canonicalUrl.startsWith("https://")) return undefined;
  return record;
}

async function buildPreview(rawUrl: string): Promise<PreviewRecord | undefined> {
  const canonicalUrl = canonicalizeUrl(rawUrl);
  const key = cacheKey(canonicalUrl);
  const cached = await cacheSink.get(key);
  if (cached) return cached;
  const blockedUntil = failureUntil.get(key);
  if (blockedUntil !== undefined && blockedUntil > Date.now()) return undefined;

  const work = withSlot(async (): Promise<PreviewRecord | undefined> => {
    try {
      const page = await fetchWithRedirects(canonicalUrl);
      const html = page.body.toString("utf8");
      const metadata = normalizeMetadata(html, page.finalUrl);
      if (!metadata.title && !metadata.description) return undefined;

      let thumbnail: PreviewRecord["thumbnail"];
      let sourceWidth: number | undefined;
      let sourceHeight: number | undefined;
      if (metadata.imageUrl) {
        const imageData = await fetchWithRedirects(metadata.imageUrl);
        if (imageData.contentType.startsWith("image/")) {
          const normalized = await normalizeThumbnail(imageData.body);
          thumbnail = normalized.bytes;
          sourceWidth = normalized.width;
          sourceHeight = normalized.height;
        }
      }

      const record = validateRecord({
        schemaVersion: PREVIEW_CACHE_VERSION,
        canonicalUrl,
        ...(metadata.title ? { title: metadata.title } : {}),
        ...(metadata.description ? { description: metadata.description } : {}),
        ...(metadata.siteName ? { siteName: metadata.siteName } : {}),
        ...(thumbnail ? { thumbnail } : {}),
        ...(sourceWidth !== undefined ? { sourceWidth } : {}),
        ...(sourceHeight !== undefined ? { sourceHeight } : {}),
        fetchedAt: Date.now(),
        expiresAt: Date.now() + SUCCESS_TTL_MS,
      });

      if (!record) {
        // Incomplete (no validated thumbnail): short failure memory, never cached as success.
        failureUntil.set(key, Date.now() + FAILURE_TTL_MS);
        return undefined;
      }
      await cacheSink.set(key, record, SUCCESS_TTL_MS);
      return record;
    } catch (error) {
      const classified = classifyError(error);
      if (classified.kind !== "invalid_target") failureUntil.set(key, Date.now() + FAILURE_TTL_MS);
      return undefined;
    }
  });

  const existing = inFlight.get(key);
  if (existing) return existing;
  inFlight.set(key, work);
  try {
    return await work;
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Build previews for a text; returns validated records only (incomplete URLs
 * are silently absent — the renderer falls back to plain text, spec §25).
 */
export async function buildPreviews(text: string): Promise<PreviewRecord[]> {
  const urls = discoverUrls(text);
  if (!urls.length) return [];
  const records = await Promise.all(urls.map((url) => buildPreview(url)));
  return records.filter((record): record is PreviewRecord => record !== undefined);
}

/** Test/deployment seam: swap the cache sink (Redis-backed in production). */
export function setPreviewCacheSink(sink: PreviewCacheSink): void {
  cacheSink = sink;
}
