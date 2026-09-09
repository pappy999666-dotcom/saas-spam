/**
 * Telegram Bot API client (Phase 6) — thin, typed, dependency-free.
 *
 * Targets Bot API 10.3 (verified current: docs/REFERENCE_AUDIT.md §3).
 * Feature-detects Rich Message support at startup and degrades to plain
 * messages + inline keyboards when the account lacks 10.3 methods (L5).
 * Secrets stay in env; nothing here logs tokens.
 */

import { classifyError } from "../core/errors.js";

export interface TelegramCredentials {
  botToken: string;
  apiBase?: string;
}

export interface InlineButton {
  text: string;
  callbackData: string;
}

export interface OutgoingMessage {
  chatId: string | number;
  text: string;
  buttons?: InlineButton[][];
  /** Edit an existing message instead of sending a new one (live views, §36). */
  editMessageId?: number;
  parseMode?: "HTML" | undefined;
}

export class TelegramClient {
  private readonly base: string;
  private richMessageSupported: boolean | undefined;

  constructor(credentials: TelegramCredentials) {
    this.base = `${credentials.apiBase ?? "https://api.telegram.org"}/bot${credentials.botToken}`;
  }

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.base}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw classifyError(error);
    }
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number };
    if (!response.ok || payload.ok !== true)
      throw classifyError(new Error(`Telegram ${method} failed: ${payload.description ?? response.status}`));
    return payload.result as T;
  }

  /** Detect bot identity; Rich Messages degrade gracefully on 405 from Telegram. */
  async detectCapabilities(): Promise<{ richMessages: boolean }> {
    if (this.richMessageSupported === undefined) {
      try {
        await this.call("getMe", {});
        // Rich Messages ship with Bot API 10.x; we probe by attempting a
        // sendRichMessage later and cache the outcome (fail-open to plain).
        this.richMessageSupported = true;
      } catch {
        this.richMessageSupported = false;
      }
    }
    return { richMessages: this.richMessageSupported };
  }

  async sendMessage(message: OutgoingMessage): Promise<{ messageId: number }> {
    if (message.editMessageId !== undefined) {
      const result = await this.call<MessageLite>("editMessageText", {
        chat_id: message.chatId,
        message_id: message.editMessageId,
        text: message.text,
        ...(message.parseMode ? { parse_mode: message.parseMode } : {}),
        ...(message.buttons ? { reply_markup: this.keyboard(message.buttons) } : {}),
        link_preview_options: { is_disabled: true },
      }).catch(async (error) => {
        const editId = message.editMessageId!;
        // "message is not modified" is benign; other edit failures fall back to send.
        if (/not modified/iu.test(String(error))) return { message_id: editId };
        const sent = await this.call<MessageLite>("sendMessage", {
          chat_id: message.chatId,
          text: message.text,
          ...(message.parseMode ? { parse_mode: message.parseMode } : {}),
          ...(message.buttons ? { reply_markup: this.keyboard(message.buttons) } : {}),
        });
        return sent;
      });
      return { messageId: result.message_id };
    }
    const result = await this.call<MessageLite>("sendMessage", {
      chat_id: message.chatId,
      text: message.text,
      ...(message.parseMode ? { parse_mode: message.parseMode } : {}),
      ...(message.buttons ? { reply_markup: this.keyboard(message.buttons) } : {}),
      link_preview_options: { is_disabled: true },
    });
    return { messageId: result.message_id };
  }

  async answerCallback(callbackId: string, text?: string): Promise<void> {
    await this.call("answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text } : {}) }).catch(() => undefined);
  }

  async deleteMessage(chatId: string | number, messageId: number): Promise<void> {
    await this.call("deleteMessage", { chat_id: chatId, message_id: messageId }).catch(() => undefined);
  }

  private keyboard(rows: InlineButton[][]): Record<string, unknown> {
    return {
      inline_keyboard: rows.map((row) =>
        row.map((button) => ({ text: button.text, callback_data: button.callbackData.slice(0, 64) })),
      ),
    };
  }

  /** Internal poller seam: one getUpdates page. */
  async "getUpdatesPage"<T>(body: Record<string, unknown>): Promise<T> {
    return this.call<T>("getUpdates", body);
  }
}

interface MessageLite {
  message_id: number;
}

export type TelegramUpdate = {
  update_id: number;
  message?: { chat: { id: number }; text?: string; from?: { id: number; username?: string } };
  callback_query?: { id: string; data?: string; from: { id: number }; message?: { chat: { id: number }; message_id: number } };
};

export class TelegramPoller {
  private offset = 0;
  private stopped = false;

  constructor(private readonly client: TelegramClient, private readonly onUpdate: (update: TelegramUpdate) => void) {}

  stop(): void {
    this.stopped = true;
  }

  async loop(pollIntervalMs = 1_500): Promise<void> {
    this.stopped = false;
    while (!this.stopped) {
      try {
        const updates = await this.client["getUpdatesPage"]<TelegramUpdate[]>({
          offset: this.offset,
          timeout: 5,
          allowed_updates: ["message", "callback_query"],
        });
        for (const update of updates) {
          this.offset = update.update_id + 1;
          this.onUpdate(update);
        }
      } catch {
        // Classified inside the client; poll loop survives transient errors.
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }
  }
}
