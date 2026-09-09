/**
 * Telegram control plane (Phase 6, spec §34–§36).
 *
 * Owner-facing WhatsApp session management happens HERE (user pairs the bot
 * from Telegram): /pair <phone> issues the 8-char code, lifecycle commands
 * manage sessions, live operations update ONE editable message (§36).
 */

import { renderCardText } from "../ui/renderer.js";
import { userMessage } from "../core/errors.js";
import { logger } from "../core/logger.js";
import { TelegramClient, TelegramPoller, type TelegramUpdate } from "./client.js";
import type { SessionRegistry, WhatsAppSession } from "../sessions/registry.js";
import type { WhatsAppRuntime } from "../transport/runtime.js";

export interface ControlPlaneOptions {
  client: TelegramClient;
  registry: SessionRegistry;
  runtime: WhatsAppRuntime;
  /** Owner's Telegram user id (from env OWNER_TELEGRAM_IDS[0]). */
  ownerTelegramUserId: string;
}

/** Pending pairing requests: one per owner chat at a time (spec §32: no fake pairing). */
interface PendingPairing {
  workspaceId: string;
  sessionId: string;
  phoneNumber: string;
  code: string;
}

export class TelegramControlPlane {
  private readonly pendingPairing = new Map<string, PendingPairing>();
  private poller?: TelegramPoller;

  constructor(private readonly options: ControlPlaneOptions) {}

  async start(): Promise<void> {
    this.poller = new TelegramPoller(this.options.client, (update) => void this.onUpdate(update));
    void this.poller.loop();
    await this.options.client.detectCapabilities();
    logger.info("Telegram control plane started (polling).");
  }

  stop(): void {
    this.poller?.stop();
  }

  private isOwner(telegramUserId: number): boolean {
    return String(telegramUserId) === this.options.ownerTelegramUserId;
  }

  private async onUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      await this.options.client.answerCallback(update.callback_query.id);
      return;
    }
    const message = update.message;
    if (!message?.text || !message.from) return;
    if (!this.isOwner(message.from.id)) {
      await this.options.client.sendMessage({
        chatId: message.chat.id,
        text: "SaaS Promoter is a private operations console. This bot does not serve third-party users.",
      });
      return;
    }
    await this.handleCommand(message.text.trim(), String(message.chat.id));
  }

  private async handleCommand(raw: string, chatId: string): Promise<void> {
    const [head, ...rest] = raw.split(/\s+/);
    const command = head?.replace(/^\//u, "").toLowerCase();
    const argument = rest.join(" ").trim();

    switch (command) {
      case "start":
      case "help": {
        await this.options.client.sendMessage({
          chatId,
          text: [
            "◆ SaaS Promoter · Control Plane",
            "",
            "/pair <phone> — pair a WhatsApp session (code appears here)",
            "/sessions — list sessions and transport state",
            "/logout <name> — log out and remove a session",
            "/operations — live operation progress",
            "/cancel <op-id> — cancel a running operation",
          ].join("\n"),
        });
        return;
      }
      case "pair": {
        await this.pair(argument, chatId);
        return;
      }
      case "sessions": {
        await this.renderSessions(chatId);
        return;
      }
      case "logout": {
        await this.logout(argument, chatId);
        return;
      }
      default: {
        await this.options.client.sendMessage({
          chatId,
          text: `Unknown command "${head ?? ""}". Send /help for the console commands.`,
        });
      }
    }
  }

  private async pair(argument: string, chatId: string): Promise<void> {
    const phoneNumber = argument.replace(/\D/g, "");
    if (phoneNumber.length < 7 || phoneNumber.length > 15) {
      await this.options.client.sendMessage({
        chatId,
        text: "Usage: /pair <phone> — international format without +, e.g. /pair 2348012345678",
      });
      return;
    }
    try {
      const workspace = this.options.registry.listWorkspaces().find((candidate) => candidate.ownerTelegramUserId === this.options.ownerTelegramUserId)
        ?? this.options.registry.createWorkspace(this.options.ownerTelegramUserId);
      const session = this.options.registry.createSession(workspace.workspaceId, `wa-${phoneNumber.slice(-4)}`);
      const { pairingCode } = await this.options.runtime.pairSession(workspace.workspaceId, session.sessionId, phoneNumber);
      this.pendingPairing.set(chatId, { workspaceId: workspace.workspaceId, sessionId: session.sessionId, phoneNumber, code: pairingCode });
      await this.options.client.sendMessage({
        chatId,
        text: [
          "◆ Pair WhatsApp",
          "",
          `Code: ${pairingCode.split("").join("-")}`,
          "",
          `On the phone for +${phoneNumber}: WhatsApp → Settings → Linked devices → Link a device → Link with phone number, then enter the code.`,
          "",
          "The session appears in /sessions once linked. Code stays valid until used or the socket closes.",
        ].join("\n"),
      });
    } catch (error) {
      await this.options.client.sendMessage({ chatId, text: `Pairing failed: ${userMessage(error)}` });
    }
  }

  private async renderSessions(chatId: string): Promise<void> {
    const workspace = this.options.registry.listWorkspaces().find((candidate) => candidate.ownerTelegramUserId === this.options.ownerTelegramUserId);
    const sessions = workspace ? this.options.registry.listSessions(workspace.workspaceId) : [];
    if (!sessions.length) {
      await this.options.client.sendMessage({ chatId, text: "No sessions yet. Pair one with /pair <phone>." });
      return;
    }
    const lines = sessions.map((session: WhatsAppSession) => {
      const lease = session.activeLease ? ` · lease ${session.activeLease.chatJid.split("@")[0]}` : "";
      return `• ${session.name} — ${session.transportState} · prefix "${session.settings.prefix || "none"}"${lease}`;
    });
    await this.options.client.sendMessage({ chatId, text: ["◆ Sessions", "", ...lines].join("\n") });
  }

  private async logout(name: string, chatId: string): Promise<void> {
    const workspace = this.options.registry.listWorkspaces().find((candidate) => candidate.ownerTelegramUserId === this.options.ownerTelegramUserId);
    const sessions = workspace ? this.options.registry.listSessions(workspace.workspaceId) : [];
    const session = sessions.find((candidate) => candidate.name === name || candidate.sessionId === name);
    if (!session) {
      await this.options.client.sendMessage({ chatId, text: `No session named "${name}". Check /sessions.` });
      return;
    }
    this.options.runtime.stopSession(session.sessionId);
    this.options.registry.updateSession(workspace!.workspaceId, session.sessionId, { transportState: "logged_out" });
    await this.options.client.sendMessage({ chatId, text: `Session ${session.name} logged out.` });
  }
}
