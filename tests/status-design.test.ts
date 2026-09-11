import { describe, it, expect } from "vitest";
import {
  cleanTitle,
  hasHttpUrl,
  extractFirstHttpUrl,
  createGroupStatusDesign,
  STATUS_BACKGROUNDS,
  STATUS_URL_TEMPLATES,
  STATUS_TEXT_TEMPLATES,
} from "../src/ui/status-design.js";

describe("Status Aesthetic Engine (status-design)", () => {
  describe("cleanTitle", () => {
    it("strips brand suffixes and collapses whitespace", () => {
      expect(cleanTitle("My Awesome Project | GitHub")).toBe("My Awesome Project");
      expect(cleanTitle("Video Premiere - YouTube")).toBe("Video Premiere");
      expect(cleanTitle("Crypto Traders | WhatsApp Group")).toBe("Crypto Traders");
    });

    it("decodes basic HTML entities", () => {
      expect(cleanTitle("Rock &amp; Roll &lt;V2&gt;")).toBe("Rock & Roll <V2>");
      expect(cleanTitle("Bob&#039;s &quot;Sale&quot;")).toBe("Bob's \"Sale\"");
    });

    it("caps title at 36 characters", () => {
      const longTitle = "This is an extremely long title that exceeds the maximum limit allowed for group status headers";
      const cleaned = cleanTitle(longTitle);
      expect(cleaned.length).toBeLessThanOrEqual(36);
    });

    it("falls back to 'WhatsApp Group' if input is empty", () => {
      expect(cleanTitle("")).toBe("WhatsApp Group");
      expect(cleanTitle("   \n\t ")).toBe("WhatsApp Group");
    });
  });

  describe("URL detection", () => {
    it("detects and extracts HTTP/HTTPS URLs", () => {
      expect(hasHttpUrl("Check out https://chat.whatsapp.com/ABC1234")).toBe(true);
      expect(hasHttpUrl("No link here")).toBe(false);
      expect(extractFirstHttpUrl("Join https://chat.whatsapp.com/INVITE now!")).toBe("https://chat.whatsapp.com/INVITE");
      expect(extractFirstHttpUrl("Plain text")).toBeUndefined();
    });
  });

  describe("createGroupStatusDesign", () => {
    it("generates a valid URL status design with saturated background and font", () => {
      const design = createGroupStatusDesign({
        groupName: "Alpha Group",
        title: "Exclusive Alpha",
        text: "Join https://chat.whatsapp.com/INVITE123",
        seed: "sess1:group1:1001",
      });

      expect(design.mode).toBe("url");
      expect(design.title).toBe("Exclusive Alpha");
      expect(STATUS_BACKGROUNDS).toContain(design.backgroundColor);
      expect(design.textColor).toBe("#FFFFFF");
      expect(design.font).toBeGreaterThanOrEqual(0);
      expect(design.font).toBeLessThanOrEqual(9);
      expect(design.text).toContain("Exclusive Alpha");
      expect(design.text).toContain("https://chat.whatsapp.com/INVITE123");
    });

    it("generates a valid text-mode status when no URL is present", () => {
      const design = createGroupStatusDesign({
        groupName: "Announcements",
        text: "Meeting starts at 10 AM UTC tomorrow.",
        seed: "sess1:group1:1002",
      });

      expect(design.mode).toBe("text");
      expect(STATUS_BACKGROUNDS).toContain(design.backgroundColor);
      expect(design.text).toContain("Meeting starts at 10 AM UTC tomorrow.");
    });

    it("is deterministic based on seed and group details", () => {
      const input = {
        groupName: "Designers",
        title: "Figma Community",
        text: "https://figma.com/file/123",
        seed: "sessA:grpB:fixedSeed",
      };

      const design1 = createGroupStatusDesign(input);
      const design2 = createGroupStatusDesign(input);

      expect(design1.backgroundColor).toBe(design2.backgroundColor);
      expect(design1.font).toBe(design2.font);
      expect(design1.text).toBe(design2.text);
    });

    it("palette contains 20 distinct vibrant colors", () => {
      expect(STATUS_BACKGROUNDS.length).toBe(20);
      const uniqueColors = new Set(STATUS_BACKGROUNDS);
      expect(uniqueColors.size).toBe(20);
    });

    it("has 12 URL templates and 5 text templates", () => {
      expect(STATUS_URL_TEMPLATES.length).toBe(12);
      expect(STATUS_TEXT_TEMPLATES.length).toBe(5);
    });
  });
});
