/**
 * SaaS Promoter entrypoint.
 *
 * Boots core + command families + WhatsApp runtime + Telegram control plane.
 * Without a Telegram token it runs a safe smoke check and exits — no
 * half-started states.
 */

import { env, assertProductionSecrets, ownerTelegramIds } from "./config/env.js";
import { logger } from "./core/logger.js";
import { CommandRegistry } from "./core/command-registry.js";
import { SessionRegistry } from "./sessions/registry.js";
import { registerGroupCommands } from "./commands/groups.js";
import { registerJoinCommands } from "./commands/join.js";
import { registerBulkCommands, type BulkRuntime } from "./commands/bulk.js";
import { TelegramClient } from "./telegram/client.js";
import { TelegramControlPlane } from "./telegram/control-plane.js";
import { WhatsAppRuntime, buildDispatcherFactory } from "./transport/runtime.js";

async function main(): Promise<void> {
  assertProductionSecrets();
  const registry = new CommandRegistry();
  const sessions = new SessionRegistry();
  await sessions.hydrate();

  registerGroupCommands(registry);
  registerJoinCommands(registry, {
    getBulkDelayMs: () => 10_000,
    setBulkDelayMs: () => undefined,
  });
  const bulkRuntime: BulkRuntime = {
    transport: undefined,
    delayMs: 10_000,
    idempotencyKeys: new Set<string>(),
  };
  registerBulkCommands(registry, { runtime: bulkRuntime, operations: new Map() });

  const waRuntime = new WhatsAppRuntime(sessions, registry);
  waRuntime.setDispatcher(
    buildDispatcherFactory(sessions, registry, waRuntime, (workspaceId) => {
      const workspace = sessions.getWorkspace(workspaceId);
      return {
        ownerTelegramUserId: workspace.ownerTelegramUserId,
        sessionSudoPhones: [],
        workspaceSudoPhones: [],
      };
    }),
  );

  logger.info(`Registered ${registry.list().length} commands.`);

  const firstOwner = [...ownerTelegramIds][0];

  if (!env.TELEGRAM_BOT_TOKEN) {
    logger.info("Scaffold ready. Set TELEGRAM_BOT_TOKEN to start the control plane.");
    logger.info(`Commands registered: ${registry.list().length}. Workspaces: ${sessions.listWorkspaces().length}.`);
    return;
  }
  if (!firstOwner) {
    throw new Error("OWNER_TELEGRAM_IDS must contain the owner's Telegram user id.");
  }

  const client = new TelegramClient({ botToken: env.TELEGRAM_BOT_TOKEN });
  const controlPlane = new TelegramControlPlane({
    client,
    registry: sessions,
    runtime: waRuntime,
    ownerTelegramUserId: firstOwner,
  });
  await controlPlane.start();

  const shutdown = async (): Promise<void> => {
    controlPlane.stop();
    for (const sessionId of waRuntime.listLive()) waRuntime.stopSession(sessionId);
    logger.info("Shutdown complete.");
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  logger.error("Fatal startup error", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
