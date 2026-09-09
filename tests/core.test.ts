import { describe, expect, it } from "vitest";
import { parseCommand, MAX_CHAIN_DEPTH, type PrefixConfig } from "../src/core/command-parser.js";
import { CommandRegistry, type CommandDefinition } from "../src/core/command-registry.js";
import {
  isLidIdentity,
  maskedPhoneLabel,
  phoneDigitsFromIdentity,
  phoneJidFromIdentity,
  verifiedTargetJids,
  verifiedTargetPhone,
} from "../src/core/identity.js";
import { canInvoke, resolveRole } from "../src/core/permissions.js";
import { ClassifiedError, classifyError, isRetryable, userMessage } from "../src/core/errors.js";
import { startOperation, type OperationTarget } from "../src/core/operation-engine.js";

const prefixRequired: PrefixConfig = { prefix: ".", prefixMode: "required" };
const prefixOptional: PrefixConfig = { prefix: ".", prefixMode: "optional" };
const prefixNone: PrefixConfig = { prefix: "", prefixMode: "none" };

// Realistic known-name set: "hi" is payload text, not a command, and must
// never be treated as one during chain unwrapping.
const known = new Set(["menu", "tag", "join"]);

describe("command parser — prefix modes", () => {
  it("parses required-prefixed commands", () => {
    const parsed = parseCommand({ text: ".menu", prefixConfig: prefixRequired, knownNames: known });
    expect(parsed?.name).toBe("menu");
    expect(parsed?.prefixUsed).toBe(".");
  });

  it("rejects bare commands in required mode for unknown names", () => {
    const parsed = parseCommand({ text: "hello there", prefixConfig: prefixRequired, knownNames: known });
    expect(parsed).toBeNull();
  });

  it("accepts bare known commands in none mode and ignores conversation", () => {
    const parsed = parseCommand({ text: "menu", prefixConfig: prefixNone, knownNames: known });
    expect(parsed?.name).toBe("menu");
    const chat = parseCommand({ text: "how are you", prefixConfig: prefixNone, knownNames: known });
    expect(chat).toBeNull();
  });

  it("supports custom prefixes per session", () => {
    const parsed = parseCommand({ text: "!join 123", prefixConfig: { prefix: "!", prefixMode: "required" }, knownNames: known });
    expect(parsed?.name).toBe("join");
    expect(parsed?.args).toEqual(["123"]);
  });

  it("accepts dot fallback on the telegram bridge even when prefix differs", () => {
    const parsed = parseCommand({ text: ".menu", prefixConfig: { prefix: "!", prefixMode: "required" }, knownNames: known, allowBareCommands: true });
    expect(parsed?.name).toBe("menu");
  });
});

describe("command parser — self-chaining (spec §23)", () => {
  it("unwraps nested tag chains", () => {
    // "tag tag hi" unwraps deterministically to the innermost command with a
    // bounded depth (spec §23: parser feature, never a self-triggering loop).
    const parsed = parseCommand({ text: ".tag tag hi", prefixConfig: prefixRequired, knownNames: known });
    expect(parsed?.name).toBe("tag");
    expect(parsed?.rawPayload).toBe("hi");
    expect(parsed?.chainDepth).toBe(1);
  });

  it("enforces maximum chain depth", () => {
    const text = `.tag ${"tag ".repeat(MAX_CHAIN_DEPTH + 2)}hi`;
    const parsed = parseCommand({ text, prefixConfig: prefixRequired, knownNames: known });
    expect(parsed?.chainDepth).toBeLessThanOrEqual(MAX_CHAIN_DEPTH);
  });
});

describe("command registry", () => {
  const registry = new CommandRegistry();
  const definition: CommandDefinition = {
    name: "pmt",
    aliases: ["promote"],
    category: "members",
    description: "Promote a member",
    groupOnly: true,
    run: async () => "ok",
  };
  registry.register(definition);

  it("resolves aliases to canonical commands and rejects duplicates", () => {
    expect(registry.resolve("promote")?.name).toBe("pmt");
    expect(registry.resolve("pmt")?.name).toBe("pmt");
    expect(registry.resolve("missing")).toBeUndefined();
    expect(() => registry.register({ ...definition, name: "other", aliases: ["promote"] })).toThrow(/duplicate alias/iu);
  });
});

describe("identity normalization — LID policy (spec §29)", () => {
  it("extracts digits from JIDs and formatted numbers", () => {
    expect(phoneDigitsFromIdentity("2348012345678@s.whatsapp.net")).toBe("2348012345678");
    expect(phoneDigitsFromIdentity("+234 801 234 5678")).toBe("2348012345678");
    expect(phoneJidFromIdentity("2348012345678")).toBe("2348012345678@s.whatsapp.net");
  });

  it("detects and rejects LID-only identities", () => {
    expect(isLidIdentity("10873652@lid")).toBe(true);
    expect(phoneDigitsFromIdentity("10873652@lid")).toBeUndefined();
    expect(verifiedTargetPhone(["10873652@lid"], undefined, undefined)).toBeUndefined();
  });

  it("never leaks LIDs into labels", () => {
    expect(maskedPhoneLabel(undefined)).toContain("unavailable");
    expect(maskedPhoneLabel("2348012345678")).toMatch(/^\+234•••5678$/u);
  });

  it("collects verified targets from mentions, quotes, and args", () => {
    // "999" is too short to be a verified phone (7-15 digits required).
    const targets = verifiedTargetJids(["13325"], ["2348012345678@s.whatsapp.net"], "4412345678901@s.whatsapp.net");
    expect(targets).toEqual(["2348012345678@s.whatsapp.net", "4412345678901@s.whatsapp.net"]);
    expect(verifiedTargetJids(["999"], undefined, undefined)).toEqual([]);
  });
});

describe("permissions", () => {
  const scope = {
    ownerTelegramUserId: "111",
    sessionSudoPhones: ["2348000000001"],
    workspaceSudoPhones: ["2348000000002"],
  };

  it("orders roles owner > sudo > global > none", () => {
    expect(resolveRole({ fromSelf: true }, scope)).toBe("owner");
    expect(resolveRole({ telegramUserId: "111" }, scope)).toBe("owner");
    expect(resolveRole({ phoneDigits: "2348000000001" }, scope)).toBe("sudo");
    expect(resolveRole({ phoneDigits: "2348000000002" }, scope)).toBe("global");
    expect(resolveRole({ phoneDigits: "1" }, scope)).toBe("none");
  });

  it("enforces ownerOnly", () => {
    expect(canInvoke("sudo", true)).toBe(false);
    expect(canInvoke("owner", true)).toBe(true);
    expect(canInvoke("global", false)).toBe(true);
  });
});

describe("error classification (spec §44)", () => {
  it("classifies retryable and permanent failures", () => {
    expect(isRetryable(new Error("connection closed"))).toBe(true);
    expect(isRetryable(new Error("rate limited: too many requests"))).toBe(true);
    expect(isRetryable(new Error("invite link expired"))).toBe(false);
    expect(isRetryable(new ClassifiedError("permission", "not an admin"))).toBe(false);
  });

  it("never exposes raw internals to users", () => {
    const message = userMessage(new Error("ECONNRESET at socket 0xdeadbeef stack"));
    expect(message).not.toMatch(/0xdeadbeef/u);
    expect(message.length).toBeGreaterThan(0);
  });
});

describe("operation engine", () => {
  const targets: OperationTarget[] = [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
    { id: "c", name: "Gamma" },
  ];

  it("tracks completed, skipped, and failed counts without inventing success", async () => {
    const handle = startOperation(
      { type: "test", workspaceId: "w", sessionId: "s", targets, delayMs: 0 },
      async (target) => (target.id === "a" ? "completed" : target.id === "b" ? "skipped" : (() => { throw new Error("invite expired"); })()),
    );
    const snapshot = await handle.done;
    expect(snapshot.status).toBe("completed");
    expect(snapshot.completed).toBe(1);
    expect(snapshot.skipped).toBe(1);
    expect(snapshot.failed).toBe(1);
    expect(snapshot.remaining).toBe(0);
    expect(snapshot.lastFailure?.kind).toBe("invalid_target");
  });

  it("retries retryable failures then succeeds", async () => {
    let attempts = 0;
    const handle = startOperation(
      { type: "test", workspaceId: "w", sessionId: "s", targets: [targets[0]!], delayMs: 0, retryPolicy: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 } },
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("socket closed");
        return "completed";
      },
    );
    const snapshot = await handle.done;
    expect(attempts).toBe(3);
    expect(snapshot.completed).toBe(1);
  });

  it("cancels remaining work and reports cancelled counts", async () => {
    const handle = startOperation(
      { type: "test", workspaceId: "w", sessionId: "s", targets, delayMs: 0 },
      async (target, control) => {
        if (target.id === "a") {
          control.cancel();
          return "completed";
        }
        return "completed";
      },
    );
    const snapshot = await handle.done;
    expect(snapshot.cancelled).toBeGreaterThanOrEqual(1);
    expect(snapshot.completed).toBe(1);
  });

  it("rejects duplicate idempotency keys (spec §45)", async () => {
    const def = { type: "test", workspaceId: "w", sessionId: "s", targets: [targets[0]!], delayMs: 0, idempotencyKey: "op-key-1" };
    const first = startOperation(def, async () => "completed");
    await first.done;
    expect(() => startOperation(def, async () => "completed")).toThrow(/already executed/iu);
  });
});
