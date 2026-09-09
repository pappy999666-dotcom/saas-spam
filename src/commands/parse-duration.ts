/** Duration parsing for user inputs like `30s`, `5m`, `1h` (bounded). */

const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000 };

export function parseDurationMs(raw: string): number | undefined {
  const match = /^(\d{1,4})([smh])$/iu.exec(raw.trim());
  if (!match?.[1]) return undefined;
  const amount = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  const ms = amount * (UNIT_MS[unit] ?? 0);
  return ms > 0 && ms <= 24 * 3_600_000 ? ms : undefined;
}
