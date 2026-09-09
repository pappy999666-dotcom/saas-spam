/**
 * Capability-gated access to plogme socket methods.
 *
 * plogme ships loose typings (`[key: string]: unknown` on WASocket), so every
 * socket call in SaaS Promoter goes through this gate: a missing method is a
 * classified "unsupported" failure, never a runtime TypeError deep in a
 * command. This is the single sanctioned path from product code to the engine.
 */

import { ClassifiedError } from "../core/errors.js";

/** Minimal structural type of the parts of WASocket we rely on. */
export interface PlogmeSocketLike {
  ev?: { on(event: string, listener: (payload: unknown) => void): void; off?(event: string, listener: (payload: unknown) => void): void };
  [key: string]: unknown;
}

/** Return a socket method by name, or throw a classified unsupported error. */
export function socketMethod<TResult>(
  socket: PlogmeSocketLike,
  name: string,
): (...args: unknown[]) => Promise<TResult> {
  const candidate = (socket as Record<string, unknown>)[name];
  if (typeof candidate !== "function")
    throw new ClassifiedError("unsupported", `This transport does not support "${name}".`, { detail: name });
  return candidate.bind(socket) as unknown as (...args: unknown[]) => Promise<TResult>;
}

/** Non-throwing probe used by UI to grey out unsupported actions. */
export function hasCapability(socket: PlogmeSocketLike | undefined, name: string): boolean {
  if (!socket) return false;
  return typeof (socket as Record<string, unknown>)[name] === "function";
}

/**
 * Invoke a socket method with a timeout; plogme queries can hang on a dead
 * socket, and an operation must never block forever (spec §31).
 */
export async function callWithTimeout<TResult>(
  fn: () => Promise<TResult>,
  timeoutMs: number,
  label: string,
): Promise<TResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ClassifiedError("timeout", `${label} timed out.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
