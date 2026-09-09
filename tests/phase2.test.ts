import { describe, expect, it } from "vitest";
import { normalizeIncomingMessage, unwrapMessage, detectMessageType } from "../src/transport/normalizer.js";
import { dispatchWhatsAppMessage, type DispatchDeps } from "../src/transport/dispatcher.js";
import { CommandRegistry } from "../src/core/command-registry.js";
import { SessionRegistry } from "../src/sessions/registry.js";
import { renderCard, renderCardText } from "../src/ui/renderer.js";
import { advanceFlow, startFlow, isExpired, type FlowDefinition } from "../src/ui/flows.js";
import { hasCapability } from "../src/transport/capabilities.js";

describe("message normalizer", () => {
  it("unwraps ephemeral/view-once envelopes with bounded depth", () => {
    const unwrapped = unwrapMessage({ ephemeralMessage: { message: { conversation: "hello" } } });
    expect(unwrapped.conversation).toBe("hello");
    // deep nesting still bounded
    let deep: Record<string, unknown> = { conversation: "x" };
    for (let i = 0; i < 12; i++) deep = { ephemeralMessage: { message: deep } };
    expect(() => unwrapMessage(deep)).not.toThrow();
  });

  it("detects media types and text", () => {
    expect(detectMessageType({ imageMessage: { mimetype: "image/jpeg", caption: "hi" } }).media?.kind).toBe("image");
    expect(detectMessageType({ conversation: "text" }).type).toBe("conversation");
  });

  it("normalizes a group message with mentions and quoted context", () => {
    const message = normalizeIncomingMessage({
      key: { remoteJid: "1202@g.us", participant: "23480@s.whatsapp.net", id: "ABC", fromMe: false },
      message: {
        extendedTextMessage: {
          text: "hello @2348012345678",
          mentionedJid: ["2348012345678@s.whatsapp.net"],
          contextInfo: { participant: "4412345678901@s.whatsapp.net", quotedMessage: { conversation: "quoted text" } },
        },
      },
    });
    expect(message.isGroup).toBe(true);
    expect(message.mentions).toEqual(["2348012345678@s.whatsapp.net"]);
    expect(message.quoted?.senderJid).toBe("4412345678901@s.whatsapp.net");
    expect(message.quoted?.hasMedia).toBe(false);
    expect(message.quoted?.messageType).toBe("conversation");
    expect(message.media).toBeUndefined();
  });
});

function makeDeps(overrides?: Partial<DispatchDeps>) {
  const registry = new CommandRegistry();
  registry.register({ name: "menu", category: "utilities", description: "menu", run: async () => "MENU" });
  registry.register({ name: "kick", aliases: ["remove"], category: "members", description: "kick", groupOnly: true, run: async () => "KICK" });
  registry.register({ name: "secret", category: "sessions", description: "owner only", ownerOnly: true, run: async () => "SECRET" });
  const replies: string[] = [];
  const deps: DispatchDeps = {
    registry,
    workspaceId: "w1",
    sessionId: "s1",
    prefixConfig: { prefix: ".", prefixMode: "required" },
    permissionScope: { sessionSudoPhones: [], workspaceSudoPhones: [] },
    leaseAdmits: () => true,
    reply: async (payload) => {
      replies.push(payload.text ?? "");
    },
    ...overrides,
  };
  return { deps, replies, registry };
}

describe("dispatch pipeline", () => {
  const baseMessage = {
    chatJid: "2348012345678@s.whatsapp.net",
    senderJid: "2348012345678@s.whatsapp.net",
    fromMe: true,
    text: ".menu",
    mentions: [],
    isGroup: false,
    isGroupStatus: false,
    rawType: "conversation",
  };

  it("dispatches prefixed commands and replies", async () => {
    const { deps, replies } = makeDeps();
    const result = await dispatchWhatsAppMessage(baseMessage, deps);
    expect(result).toEqual({ handled: true });
    expect(replies[0]).toBe("MENU");
  });

  it("ignores unrelated conversation in required mode", async () => {
    const { deps } = makeDeps();
    const result = await dispatchWhatsAppMessage({ ...baseMessage, text: "just chatting" }, deps);
    expect(result).toEqual({ handled: false, reason: "no_command" });
  });

  it("enforces group-only commands", async () => {
    const { deps } = makeDeps();
    const result = await dispatchWhatsAppMessage({ ...baseMessage, text: ".kick @x" }, deps);
    expect(result).toEqual({ handled: false, reason: "group_only" });
  });

  it("silently ignores unauthorized senders (private command surface, spec 5)", async () => {
    const { deps } = makeDeps();
    const result = await dispatchWhatsAppMessage(
      { ...baseMessage, fromMe: false, senderJid: "1999@s.whatsapp.net", text: ".menu" },
      deps,
    );
    expect(result).toEqual({ handled: false, reason: "unauthorized" });
  });

  it("enforces ownerOnly for sudo-level senders", async () => {
    const { deps } = makeDeps();
    const result = await dispatchWhatsAppMessage({ ...baseMessage, text: ".secret" }, deps);
    // fromMe → owner → allowed
    expect(result).toEqual({ handled: true });
  });

  it("gates group traffic behind leases (spec 30)", async () => {
    // Sudo-authorized sender so the lease gate (not permissions) is what fires.
    const { deps } = makeDeps({
      leaseAdmits: () => false,
      permissionScope: { sessionSudoPhones: ["2348000000001"], workspaceSudoPhones: [] },
    });
    const result = await dispatchWhatsAppMessage(
      { ...baseMessage, isGroup: true, chatJid: "1202@g.us", senderJid: "2348000000001@s.whatsapp.net", text: ".menu", fromMe: false },
      deps,
    );
    expect(result).toEqual({ handled: false, reason: "lease_closed" });
  });

  it("allows self-originated commands in groups without a lease", async () => {
    const { deps } = makeDeps({ leaseAdmits: () => false });
    const result = await dispatchWhatsAppMessage({ ...baseMessage, isGroup: true, chatJid: "1202@g.us", text: ".menu" }, deps);
    expect(result).toEqual({ handled: true });
  });
});

describe("sessions + leases", () => {
  it("creates workspaces/sessions and gates on lease state", async () => {
    const registry = new SessionRegistry();
    await registry.hydrate();
    const workspace = registry.createWorkspace("111");
    const session = registry.createSession(workspace.workspaceId, "Main");
    expect(session.settings.prefix).toBe(".");
    expect(registry.leaseAdmits(workspace.workspaceId, session.sessionId, "1202@g.us")).toBe(false);

    registry.grantLease(workspace.workspaceId, session.sessionId, "1202@g.us", "command", 60_000);
    expect(registry.leaseAdmits(workspace.workspaceId, session.sessionId, "1202@g.us")).toBe(true);
    expect(registry.leaseAdmits(workspace.workspaceId, session.sessionId, "9999@g.us")).toBe(false);

    registry.revokeLease(workspace.workspaceId, session.sessionId);
    expect(registry.leaseAdmits(workspace.workspaceId, session.sessionId, "1202@g.us")).toBe(false);
  });

  it("restores hydrated sessions as reconnecting, never connected", async () => {
    const store = new (await import("../src/sessions/registry.js")).InMemoryPersistence();
    const registry = new SessionRegistry(store);
    await registry.hydrate();
    const workspace = registry.createWorkspace("111");
    const session = registry.createSession(workspace.workspaceId, "Main");
    registry.updateSession(workspace.workspaceId, session.sessionId, { transportState: "connected" });
    const fresh = new SessionRegistry(store);
    await fresh.hydrate();
    const restored = fresh.listSessions(workspace.workspaceId)[0]!;
    expect(restored.transportState).toBe("reconnecting");
    expect(restored.activeLease).toBeUndefined();
  });
});

describe("renderer", () => {
  it("renders operation cards with honest counts", () => {
    const card = renderCard.operation("Operation · ALLSTATUS", { completed: 1704, total: 2840, skipped: 24, failed: 14, cancelled: 0, remaining: 1098, elapsedMs: 600_000, estimatedRemainingMs: 400_000 }, { operationId: "OP-8F31C2" });
    const text = renderCardText(card);
    expect(text).toContain("1704/2840");
    expect(text).toContain("Skipped");
    expect(text).not.toContain("SUCCESS!!!");
  });

  it("renders error cards with next steps", () => {
    const text = renderCardText(renderCard.error("Join", "Invalid link.", { next: ["join <link>"] }));
    expect(text).toContain("Invalid link.");
    expect(text).toContain("Next:");
  });
});

describe("interactive flows", () => {
  const definition: FlowDefinition = {
    id: "creategc",
    title: "Create group",
    steps: [
      { id: "name", prompt: "Group name?", input: "text", maxLength: 40 },
      { id: "image", prompt: "Group image?", input: "media", optional: true },
      { id: "size", prompt: "Member limit?", input: "choice", choices: [{ id: "c1", label: "256", value: "256" }, { id: "c2", label: "1024", value: "1024" }] },
    ],
  };

  it("advances, skips optional steps, and completes", () => {
    let state = startFlow(definition, "s1", "chat1");
    let result = advanceFlow(definition, state, "My Group");
    expect(result.kind).toBe("step");
    if (result.kind === "step") state = result.state;
    result = advanceFlow(definition, state, { choiceId: "__skip__" });
    expect(result.kind).toBe("step");
    if (result.kind === "step") state = result.state;
    result = advanceFlow(definition, state, { choiceId: "c1" });
    expect(result.kind).toBe("complete");
    if (result.kind === "complete") expect(result.state.answers).toEqual({ name: "My Group", image: "", size: "256" });
  });

  it("bounds invalid input attempts", () => {
    let state = startFlow(definition, "s1", "chat1");
    advanceFlow(definition, state, "ok name");
    state = { ...state, currentStepIndex: 0 };
    const first = advanceFlow(definition, state, "x".repeat(41));
    expect(first.kind).toBe("invalid");
    const second = advanceFlow(definition, (first as { state: typeof state }).state, "x".repeat(41));
    expect(second.kind).toBe("invalid");
    const third = advanceFlow(definition, (second as { state: typeof state }).state, "x".repeat(41));
    expect(third.kind).toBe("expired");
  });

  it("expires stale flows", () => {
    const state = startFlow(definition, "s1", "chat1", Date.now() - 120_000);
    expect(isExpired(state)).toBe(true);
    const result = advanceFlow(definition, state, "hello", Date.now());
    expect(result.kind).toBe("expired");
  });
});

describe("capability gate", () => {
  it("reports missing methods without throwing", () => {
    expect(hasCapability({}, "groupCreate")).toBe(false);
    expect(hasCapability({ groupCreate: () => undefined }, "groupCreate")).toBe(true);
    expect(hasCapability(undefined, "groupCreate")).toBe(false);
  });
});
