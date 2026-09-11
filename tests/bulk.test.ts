import { describe, expect, it } from "vitest";
import { CommandRegistry } from "../src/core/command-registry.js";
import { registerBulkCommands, type BulkDeps, type BulkTransport } from "../src/commands/bulk.js";
import { extractInviteUrls, registerJoinCommands } from "../src/commands/join.js";
import type { OperationHandle } from "../src/core/operation-engine.js";
import type { ResponseCard } from "../src/ui/renderer.js";

function textOf(card: ResponseCard | string | undefined): string {
  if (card === undefined) return "";
  return typeof card === "string" ? card : card.headline ?? card.title;
}

function makeEnv() {
  const registry = new CommandRegistry();
  const sent: Array<{ jid: string; kind: string; text: string }> = [];
  const groups = [
    { jid: "111@g.us", name: "One" },
    { jid: "222@g.us", name: "Two" },
    { jid: "333@g.us", name: "Three" },
  ];
  const transport: BulkTransport = {
    listGroupJids: async () => groups,
    sendGroupStatus: async (jid, payload) => {
      sent.push({ jid, kind: "gstatus", text: payload.text ?? "" });
    },
    sendGroupTextWithMentions: async (jid, text) => {
      sent.push({ jid, kind: "mentions", text });
    },
    sendGroupTextHidden: async (jid, text) => {
      sent.push({ jid, kind: "hidden", text });
    },
    sendTargetGroupStatus: async (jid, payload) => {
      sent.push({ jid, kind: "target-gstatus", text: payload.text ?? "" });
    },
  };
  const runtime = { transport, delayMs: 0, idempotencyKeys: new Set<string>() };
  const operations = new Map<string, OperationHandle>();
  registerBulkCommands(registry, { runtime, operations });
  const ctxBase = {
    platform: "whatsapp" as const,
    workspaceId: "w",
    sessionId: "s",
    command: "gstatus",
    senderRole: "owner" as const,
    args: [] as string[],
    rawPayload: "",
    prefixConfig: { prefix: ".", prefixMode: "required" as const },
    mentions: [],
    chatJid: "111@g.us",
    reply: async () => undefined,
  };
  return { registry, sent, groups, runtime, ctxBase, operations };
}

describe("bulk command families", () => {
  it("gstatus posts immediately and reports honestly", async () => {
    const { registry, sent, ctxBase } = makeEnv();
    const definition = registry.resolve("gstatus")!;
    const card = (await definition.run({ ...ctxBase, rawPayload: "hello status" })) as ResponseCard;
    expect(sent).toHaveLength(1);
    expect(sent[0]?.kind).toBe("gstatus");
    expect(textOf(card)).toContain("Posted");
  });

  it("allstatus fans out via the operation engine with live progress", async () => {
    const { registry, sent, ctxBase, operations } = makeEnv();
    const definition = registry.resolve("allstatus")!;
    const card = (await definition.run({ ...ctxBase, rawPayload: "broadcast" })) as ResponseCard;
    expect(card.kind).toBe("operation");
    const handle = [...operations.values()][0]!;
    const snapshot = await handle.done;
    expect(snapshot.completed).toBe(3);
    expect(snapshot.failed).toBe(0);
    expect(sent).toHaveLength(3);
  });

  it("allchat uses the same engine (no duplicated schedulers)", async () => {
    const { registry, ctxBase, operations } = makeEnv();
    const definition = registry.resolve("allchat")!;
    await definition.run({ ...ctxBase, rawPayload: "hi all" });
    const handle = [...operations.values()][0]!;
    const snapshot = await handle.done;
    expect(snapshot.type).toBe("ALLCHAT");
    expect(snapshot.completed).toBe(3);
  });

  it("gstatusx rejects out-of-range counts without silently changing them", async () => {
    const { registry, sent, ctxBase } = makeEnv();
    const definition = registry.resolve("gstatusx")!;
    const card = (await definition.run({ ...ctxBase, rawPayload: "99 spam" })) as ResponseCard;
    expect(textOf(card)).toContain("1–20");
    expect(sent).toHaveLength(0);
  });

  it("gstatusd generates an aesthetic canvas and delivers to group status", async () => {
    const { registry, sent, ctxBase } = makeEnv();
    const definition = registry.resolve("gstatusd")!;
    const card = (await definition.run({ ...ctxBase, rawPayload: "Check out https://chat.whatsapp.com/TEST1234" })) as ResponseCard;
    expect(sent).toHaveLength(1);
    expect(sent[0]?.kind).toBe("gstatus");
    expect(sent[0]?.text).toContain("https://chat.whatsapp.com/TEST1234");
    expect(card.title).toBe("Designed Status");
  });

  it("allstatusd fans out designed statuses with unique seeds", async () => {
    const { registry, sent, ctxBase, operations } = makeEnv();
    const definition = registry.resolve("allstatusd")!;
    const card = (await definition.run({ ...ctxBase, rawPayload: "Broadcast https://example.com" })) as ResponseCard;
    expect(card.kind).toBe("operation");
    const handle = [...operations.values()][0]!;
    const snapshot = await handle.done;
    expect(snapshot.type).toBe("ALLSTATUSD");
    expect(snapshot.completed).toBe(3);
    expect(sent).toHaveLength(3);
    expect(sent[0]?.text).toContain("https://example.com");
  });

  it("delay changes apply via broadcastdelay and allsd alias (spec 21)", async () => {
    const { registry, ctxBase, runtime } = makeEnv();
    const definition = registry.resolve("broadcastdelay")!;
    const card = (await definition.run({ ...ctxBase, args: ["30s"] })) as ResponseCard;
    expect(textOf(card)).toContain("30s");
    expect(runtime.delayMs).toBe(30_000);

    const aliasDef = registry.resolve("allsd")!;
    await aliasDef.run({ ...ctxBase, args: ["45s"] });
    expect(runtime.delayMs).toBe(45_000);
  });
});

describe("join family", () => {
  it("extracts invite urls", () => {
    const urls = extractInviteUrls("join https://chat.whatsapp.com/AbCdEf_123 please and https://chat.whatsapp.com/XyZ987654321");
    expect(urls).toHaveLength(2);
  });

  it("joins a single link immediately (no scheduler wait)", async () => {
    const registry = new CommandRegistry();
    const joins: string[] = [];
    registerJoinCommands(registry, {
      joinTransport: { join: async (url) => { joins.push(url); return { target: url, outcome: "joined" }; } },
      getBulkDelayMs: () => 60_000,
      setBulkDelayMs: () => undefined,
    });
    const definition = registry.resolve("join")!;
    const card = (await definition.run({
      platform: "whatsapp" as const, workspaceId: "w", sessionId: "s", command: "join", senderRole: "owner" as const,
      args: [], rawPayload: "https://chat.whatsapp.com/AbCdEf_123", prefixConfig: { prefix: ".", prefixMode: "required" as const },
      mentions: [], reply: async () => undefined,
    } as never)) as ResponseCard;
    expect(joins).toHaveLength(1);
    expect(textOf(card)).toContain("Joined");
  });

  it("configures bounded delays for joind", async () => {
    const registry = new CommandRegistry();
    let delay = 10_000;
    registerJoinCommands(registry, {
      getBulkDelayMs: () => delay,
      setBulkDelayMs: (ms) => {
        delay = ms;
      },
    });
    const definition = registry.resolve("joind")!;
    const base = { platform: "whatsapp" as const, workspaceId: "w", sessionId: "s", command: "joind", senderRole: "owner" as const, rawPayload: "", prefixConfig: { prefix: ".", prefixMode: "required" as const }, mentions: [], reply: async () => undefined };
    const tooSmall = (await definition.run({ ...base, args: ["1s"] } as never)) as ResponseCard;
    expect(tooSmall.kind).toBe("error");
    const ok = (await definition.run({ ...base, args: ["1m"] } as never)) as ResponseCard;
    expect(ok.kind).toBe("status");
    expect(delay).toBe(60_000);
  });
});
