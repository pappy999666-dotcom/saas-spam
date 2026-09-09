/**
 * Centralized response renderer (spec §49, §50).
 *
 * One card language for both planes. Every response answers: what happened,
 * what is the state, what can I do next. No ASCII art, no emoji spam, no
 * "SUCCESS!!!" — compact, sharp, readable. Command handlers never invent
 * their own formatting; they return data and the renderer draws.
 */

export interface CardButton {
  id: string;
  text: string;
  style: "confirm" | "cancel" | "neutral";
}

export interface CardRow {
  label: string;
  value: string;
}

export interface ResponseCard {
  kind: "status" | "menu" | "table" | "operation" | "error";
  title: string;
  headline?: string;
  rows: CardRow[];
  footer?: string;
  buttons: CardButton[];
  /** Raw text fallback for planes without native buttons (rendered as hints). */
  followUps?: string[];
}

export const renderCard = {
  status(title: string, headline: string, rows: CardRow[], options?: Partial<Pick<ResponseCard, "footer" | "buttons" | "followUps">>): ResponseCard {
    return { kind: "status", title, headline, rows, buttons: [], ...options };
  },

  error(title: string, message: string, options?: { next?: string[]; buttons?: CardButton[] }): ResponseCard {
    return {
      kind: "error",
      title,
      headline: message,
      rows: [],
      buttons: options?.buttons ?? [],
      ...(options?.next ? { followUps: options.next } : {}),
    };
  },

  operation(
    title: string,
    progress: { completed: number; total: number; skipped: number; failed: number; cancelled: number; remaining: number; elapsedMs: number; estimatedRemainingMs: number },
    options?: { current?: string; operationId?: string },
  ): ResponseCard {
    const percent = progress.total > 0 ? Math.round(((progress.completed + progress.skipped) / progress.total) * 100) : 0;
    const done = Math.round(percent / 10);
    const bar = `${"█".repeat(done)}${"░".repeat(Math.max(0, 10 - done))}`;
    const fmt = (ms: number) => {
      const totalSec = Math.round(ms / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      return m > 0 ? `${m}m ${s}s` : `${s}s`;
    };
    return {
      kind: "operation",
      title,
      headline: `${progress.completed}/${progress.total} completed · ${percent}%`,
      rows: [
        { label: "Progress", value: `${bar} ${percent}%` },
        { label: "Delivered", value: String(progress.completed) },
        { label: "Skipped", value: String(progress.skipped) },
        { label: "Failed", value: String(progress.failed) },
        ...(progress.cancelled > 0 ? [{ label: "Cancelled", value: String(progress.cancelled) }] : []),
        { label: "Remaining", value: String(progress.remaining) },
        { label: "Elapsed", value: fmt(progress.elapsedMs) },
        { label: "Est. remaining", value: fmt(progress.estimatedRemainingMs) },
        ...(options?.current ? [{ label: "Current", value: options.current }] : []),
        ...(options?.operationId ? [{ label: "Operation", value: options.operationId }] : []),
      ],
      buttons: [],
    };
  },
};

const MAX_CARD_WIDTH = 46;

function rule(): string {
  return "─".repeat(MAX_CARD_WIDTH);
}

function pad(label: string): string {
  return label.padEnd(14, " ");
}

/** Render a card as plain text (WhatsApp fallback / previews / logs). */
export function renderCardText(card: ResponseCard): string {
  const lines: string[] = [];
  lines.push(`◆ ${card.title}`);
  if (card.headline) lines.push("", card.headline);
  if (card.rows.length) {
    lines.push(rule());
    for (const row of card.rows) lines.push(`${pad(row.label)}· ${row.value}`);
  }
  if (card.footer) lines.push(rule(), card.footer);
  if (card.buttons.length) {
    lines.push(rule());
    lines.push(card.buttons.map((button) => `[${button.text}]`).join("  "));
  }
  if (card.followUps?.length) {
    lines.push("", `Next: ${card.followUps.join(" · ")}`);
  }
  return lines.join("\n");
}
