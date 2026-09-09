/**
 * Telegram control plane (Phase 6, spec §34–§36).
 *
 * Chat-commands and callbacks map to the same core APIs the WhatsApp plane
 * uses. Live operations update ONE editable message (never one message per
 * event, §36); history is separate from live progress.
 */

import { renderCard, renderCardText, type ResponseCard } from "../ui/renderer.js";
import type { OperationHandle } from "../core/operation-engine.js";
import { onOperationEvent, type OperationEvent } from "../core/logger.js";
import { TelegramClient, TelegramPoller, type TelegramUpdate } from "./client.js";
import type { SessionRegistry } from "../sessions/registry.js";

const LIVE_VIEW_INTERVAL_MS = 4_000;

export interface ControlPlaneOptions {
  client: TelegramClient;
  registry: SessionRegistry;
  /** Owner's Telegram chat for the dashboard (from env OWNER_TELEGRAM_IDS[0]). */
  ownerChatId: string;
}

export class TelegramControlPlane {
  private readonly liveViews = new Map<string, { handle: OperationHandle; chatId: string; messageId?: number; lastRender: number }>();
  private readonly unsubscribeEvents: () => void;

  constructor(private readonly options: ControlPlaneOptions) {
    this.unsubscribeEvents = onOperationEvent((event) => this.onOperationEvent(event));
  }

  async start(): Promise<void> {
    const poller = new TelegramPoller(this.options.client, (update) => void this.onUpdate(update));
    void poller.loop();
    await this.options.client.detectCapabilities();
  }

  stop(): void {
    this.unsubscribeEvents();
  }

  private async onUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      const query = update.callback_query;
      await this.options.client.answerCallback(query.id);
      if (query.data?.startsWith("op:cancel:")) {
        const operationId = query.data.slice("op:cancel:".length);
        const view = this.liveViews.get(operationId);
        if (view) await view.handle.cancel();
      }
      return;
    }
    if (update.message?.text && update.message.from) {
      const isOwner = String(update.message.from.id) === this.options.ownerChatId;
      if (!isOwner) return;
      await this.handleCommand(update.message.text.trim(), String(update.message.chat.id));
    }
  }

  private async handleCommand(text: string, chatId: string): Promise<void> {
    const [head, ...rest] = text.split(/\s+/);
    const argument = rest.join(" ").trim();
    switch (head?.replace(/^\//u, "")) {
      case "start":
      case "sessions": {
        await this.renderSessions(chatId);
        return;
      }
      case "operations": {
        const lines = [...this.liveViews.values()].map((view) => {
          const snapshot = view.handle.snapshot();
          return `${snapshot.type} ${snapshot.operationId}: ${snapshot.completed}/${snapshot.total}`;
        });
        await this.options.client.sendMessage({ chatId, text: lines.length ? `Live operations\n\n${lines.join("\n")}` : "No live operations." });
        return;
      }
      default:
        return;
    }
  }

  private async renderSessions(chatId: string): Promise<void> {
    const workspaces = this.options.registry.listWorkspaces();
    const rows: string[] = [];
    for (const workspace of workspaces) {
      const sessions = this.options.registry.listSessions(workspace.workspaceId);
      rows.push(`Owner ${workspace.ownerTelegramUserId}`);
      for (const session of sessions) {
        const lease = session.activeLease ? ` · lease→${session.activeLease.chatJid}` : "";
        rows.push(`  • ${session.name} — ${session.transportState}${lease}`);
      }
    }
    const card: ResponseCard = {
      kind: "menu",
      title: "Sessions",
      ...(rows.length ? {} : { headline: "No sessions yet. Pair a WhatsApp session to begin." }),
      rows: rows.map((row) => ({ label: "", value: row })),
      buttons: [],
    };
    await this.options.client.sendMessage({ chatId, text: renderCardText(card) });
  }

  /** Attach a live view: one message, edited in place (§36). */
  attachLiveView(handle: OperationHandle, chatId: string): void {
    this.liveViews.set(handle.operationId, { handle, chatId, lastRender: 0 });
    void handle.done.finally(() => {
      const view = this.liveViews.get(handle.operationId);
      this.liveViews.delete(handle.operationId);
      void view;
    });
  }

  private async onOperationEvent(event: OperationEvent): Promise<void> {
    const view = this.liveViews.get(event.operationId);
    if (!view) return;
    const now = Date.now();
    if (now - view.lastRender < LIVE_VIEW_INTERVAL_MS && event.type !== "operation_completed" && event.type !== "operation_cancelled")
      return;
    view.lastRender = now;
    const snapshot = view.handle.snapshot();
    const card = renderCard.operation(`Operation · ${snapshot.type}`, snapshot, {
      operationId: snapshot.operationId,
    });
    const text = renderCardText(card);
    const result = await this.options.client
      .sendMessage({
        chatId: view.chatId,
        text,
        ...(view.messageId !== undefined ? { editMessageId: view.messageId } : {}),
        buttons: [[{ text: "Cancel", callbackData: `op:cancel:${snapshot.operationId}` }]],
      })
      .catch(() => undefined);
    if (result && view.messageId === undefined) view.messageId = result.messageId;
  }
}
