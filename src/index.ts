import { loadEnvironment, evaluateSecretsChecklist } from './config/env';
import { CryptoService } from './crypto/aesGcm';
import { initializeDatabase } from './db/database';
import { ConfigStudioService } from './db/configStudio';
import { LedgerRepository } from './db/ledgerRepository';
import { SessionRepository } from './db/sessionRepository';
import { DualAccountMtProtoManager } from './mtproto/accountWorker';
import { TwoLayerCorrelationEngine } from './mtproto/correlationEngine';
import { DualLaneQueueOrchestrator } from './queue/dualLaneQueue';
import { PrimaryTelegramBotService } from './bot/primaryBot';
import { runFullVerificationSuite } from './verification/verificationSuite';

export interface SovereignRelayRuntime {
  env: ReturnType<typeof loadEnvironment>;
  secretsChecklist: ReturnType<typeof evaluateSecretsChecklist>;
  db: ReturnType<typeof initializeDatabase>;
  cryptoService: CryptoService;
  configStudio: ConfigStudioService;
  ledgerRepo: LedgerRepository;
  sessionRepo: SessionRepository;
  mtprotoManager: DualAccountMtProtoManager;
  correlationEngine: TwoLayerCorrelationEngine;
  queueOrchestrator: DualLaneQueueOrchestrator;
  primaryBotService: PrimaryTelegramBotService;
  runVerificationSuite: typeof runFullVerificationSuite;
  shutdown: () => Promise<void>;
}

/**
 * Stage 6 Application Orchestrator Entrypoint (`src/index.ts`).
 * Bootstraps the SQLite WAL database, AES-256-GCM CryptoService, Configuration Studio,
 * Dual-Lane MTProto Account Workers (`REAL_ACCOUNT` and `TEST_ACCOUNT`), Two-Layer
 * Correlation Engine, Dual-Lane Single-Concurrency FIFO Queues, and Primary GrammY Bot.
 */
export function bootstrapSovereignRelayRuntime(
  envOverrides?: Partial<Record<string, string>>
): SovereignRelayRuntime {
  const env = loadEnvironment(envOverrides);
  const secretsChecklist = evaluateSecretsChecklist();
  const db = initializeDatabase(env.sqliteDbPath);
  const cryptoService = new CryptoService(env.masterEncryptionKey);
  const configStudio = new ConfigStudioService(db, env.destinationBotUsername);
  const ledgerRepo = new LedgerRepository(db, configStudio, env.ownerTelegramId || 100001);
  const sessionRepo = new SessionRepository(db, configStudio);
  const mtprotoManager = new DualAccountMtProtoManager(db, cryptoService, configStudio);

  const correlationEngine = new TwoLayerCorrelationEngine(db, cryptoService, configStudio, {
    onSendCancelSupportMode: async (lane) => {
      await mtprotoManager.dispatchSupportModeExitCommands(lane);
    },
    onSupportModeStateChange: (lane, active) => {
      mtprotoManager.setSupportModeLock(lane, active);
    },
    onUpdateAccountStatus: (lane, status, telemetry) => {
      mtprotoManager.updateAccountConnectionStatus(lane, status, telemetry);
    },
    onCriticalAdminAlert: () => {
      // Handled by structured telemetry & audit logs
    },
  });

  mtprotoManager.bindCorrelationEngine(correlationEngine);

  const queueOrchestrator = new DualLaneQueueOrchestrator({
    db,
    cryptoService,
    configStudio,
    ledgerRepo,
    sessionRepo,
    mtprotoManager,
    correlationEngine,
  });

  const primaryBotService = new PrimaryTelegramBotService({
    db,
    configStudio,
    ledgerRepo,
    sessionRepo,
    mtprotoManager,
    queueOrchestrator,
    botToken: env.botToken,
  });

  const shutdown = async (): Promise<void> => {
    const bot = primaryBotService.getGrammyBotInstance();
    if (bot) {
      await bot.stop().catch(() => {});
    }
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    } catch {
      // already closed
    }
  };

  return {
    env,
    secretsChecklist,
    db,
    cryptoService,
    configStudio,
    ledgerRepo,
    sessionRepo,
    mtprotoManager,
    correlationEngine,
    queueOrchestrator,
    primaryBotService,
    runVerificationSuite: runFullVerificationSuite,
    shutdown,
  };
}
