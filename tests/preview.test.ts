import { describe, expect, it } from "vitest";
import { discoverUrls, canonicalizeUrl, normalizeThumbnail, PREVIEW_CACHE_VERSION } from "../src/preview/engine.js";
import sharp from "sharp";

describe("preview engine — discovery", () => {
  it("finds http(s) and www URLs, strips trailing punctuation, dedupes", () => {
    const urls = discoverUrls("check https://example.com/a, and www.foo.bar! plus https://example.com/a again");
    expect(urls).toContain("https://example.com/a");
    expect(urls.some((url) => url.startsWith("https://www.foo.bar"))).toBe(true);
    expect(urls.filter((url) => url === "https://example.com/a")).toHaveLength(1);
  });

  it("ignores junk", () => {
    expect(discoverUrls("no links here")).toEqual([]);
  });
});

describe("preview engine — canonicalization", () => {
  it("strips tracking params, hash, trailing slash, and forces https", () => {
    const canonical = canonicalizeUrl("http://WWW.Example.com/path/?utm_source=x&id=1&q=2#frag/");
    expect(canonical).toBe("https://www.example.com/path?id=1&q=2");
  });
});

describe("preview engine — validation and caching invariants", () => {
  it("version is schema-checked (renderer improvements invalidate old artifacts)", () => {
    expect(PREVIEW_CACHE_VERSION).toMatch(/^v\d+$/u);
  });

  it("normalizes thumbnails to bounded JPEG (never stores originals)", async () => {
    const png = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer();
    const normalized = await normalizeThumbnail(png);
    const meta = await sharp(normalized.bytes).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1920);
    expect(normalized.bytes.byteLength).toBeLessThan(512 * 1024);
  });
});
