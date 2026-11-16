import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { evaluateSecretsChecklist, loadEnvironment } from './src/config/env';
import { CryptoService } from './src/crypto/aesGcm';
import { initializeDatabase, type AccountLane } from './src/db/database';
import { ConfigStudioService } from './src/db/configStudio';
import { LedgerRepository } from './src/db/ledgerRepository';
import { SessionRepository } from './src/db/sessionRepository';
import { DualAccountMtProtoManager } from './src/mtproto/accountWorker';
import { TwoLayerCorrelationEngine } from './src/mtproto/correlationEngine';
import { DualLaneQueueOrchestrator } from './src/queue/dualLaneQueue';
import {
  type SearchCategory,
  validateInputByCategory,
} from './src/validation/validators';
import { inspectSection3Firewall } from './src/firewall/section3Firewall';
import { evaluateSection4ErrorSignature } from './src/firewall/section4ErrorMachine';
import { parseDestinationPayloadToAst } from './src/parser/astParser';
import { renderWhiteLabelReportPages } from './src/parser/whiteLabelRenderer';
import { sanitizeOutboundUserText } from './src/firewall/outboundSanitizer';
import {
  CANONICAL_FIELD_DEFINITIONS,
  DATA_SOURCE_CATALOG,
} from './src/parser/lexicalInventory';
import { PrimaryTelegramBotService } from './src/bot/primaryBot';
import { runFullVerificationSuite } from './src/verification/verificationSuite';

const env = loadEnvironment();
const db = initializeDatabase(env.sqliteDbPath);
const cryptoService = new CryptoService(env.masterEncryptionKey);
const configStudio = new ConfigStudioService(db, env.destinationBotUsername);
const ledgerRepo = new LedgerRepository(db, configStudio, env.ownerTelegramId || 100001);
const sessionRepo = new SessionRepository(db, configStudio);
const mtprotoManager = new DualAccountMtProtoManager(db, cryptoService, configStudio);

const adminAlerts: Array<{ id: string; text: string; createdAt: number }> = [];

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
  onCriticalAdminAlert: (alertText) => {
    adminAlerts.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: alertText,
      createdAt: Date.now(),
    });
    if (adminAlerts.length > 50) adminAlerts.pop();
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

// Seed initial accounts & sample operational records if database is freshly created
function seedInitialOperationalState(): void {
  const existingUsers = ledgerRepo.listUsers(undefined, 5);
  if (existingUsers.length === 0) {
    ledgerRepo.getOrCreateUser(100001, 'platform_owner', 'سروش (مدیر ارشد)');
    ledgerRepo.activateSubscriptionAndAddCredits({
      telegramId: 100001,
      creditsToAdd: 250,
      subscriptionDays: 365,
      idempotencyKey: 'seed_owner_sub',
      adminActorId: 100001,
      adminRole: 'OWNER',
      reason: 'Initial owner enterprise subscription provisioning',
    });

    ledgerRepo.getOrCreateUser(2049102, 'reza_parsa', 'رضا پارسا');
    ledgerRepo.activateSubscriptionAndAddCredits({
      telegramId: 2049102,
      creditsToAdd: 50,
      subscriptionDays: 30,
      idempotencyKey: 'seed_customer_sub_50',
      adminActorId: 100001,
      adminRole: 'OWNER',
      reason: 'Activated 50-credit subscriber package',
    });

    ledgerRepo.getOrCreateUser(3088415, 'mina_trial', 'مینا محمدی');
  }

  const realState = mtprotoManager.getAccountState('REAL');
  if (realState.destQuotaRemaining === null) {
    mtprotoManager.updateAccountConnectionStatus('REAL', 'CONNECTED', {
      remainingQueries: 842,
      remainingDays: 27,
    });
  }
  const testState = mtprotoManager.getAccountState('TEST');
  if (testState.destQuotaRemaining === null) {
    mtprotoManager.updateAccountConnectionStatus('TEST', 'CONNECTED', {
      remainingQueries: 145,
      remainingDays: 14,
    });
  }
}

seedInitialOperationalState();

function buildTelemetrySnapshot() {
  const queueSummary = queueOrchestrator.getQueueTelemetrySummary();
  const accounts = mtprotoManager.getAllAccountsState();
  const mem = process.memoryUsage();
  const walRow = db.pragma('journal_mode') as Array<{ journal_mode: string }>;

  return {
    timestamp: Date.now(),
    sqliteWalMode: walRow?.[0]?.journal_mode ?? 'wal',
    queue: queueSummary,
    accounts,
    system: {
      rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
      heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      uptimeSeconds: Math.round(process.uptime()),
    },
    inventoryStats: {
      validatorsCount: 9,
      dataSourcesCount: DATA_SOURCE_CATALOG.filter((d) => !d.isSubSection).length,
      subSectionsCount: DATA_SOURCE_CATALOG.filter((d) => d.isSubSection).length,
      canonicalFieldsCount: CANONICAL_FIELD_DEFINITIONS.length,
    },
    recentAlerts: adminAlerts.slice(0, 10),
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // 1. Live Telemetry Snapshot & SSE Stream
  app.get('/api/telemetry', (_req, res) => {
    res.json(buildTelemetrySnapshot());
  });

  app.get('/api/telemetry/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = () => {
      res.write(`data: ${JSON.stringify(buildTelemetrySnapshot())}\n\n`);
    };
    sendEvent();
    const interval = setInterval(sendEvent, 2500);
    req.on('close', () => clearInterval(interval));
  });

  // 2. Users, Subscriptions & Immutable Financial Ledger
  app.get('/api/users', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const users = ledgerRepo.listUsers(q, 50);
    const transactions = ledgerRepo.listCreditTransactions(undefined, 50);
    res.json({ users, transactions });
  });

  app.post('/api/users/subscribe', (req, res) => {
    try {
      const { telegramId, creditsToAdd, subscriptionDays, reason } = req.body as {
        telegramId: number;
        creditsToAdd: number;
        subscriptionDays?: number;
        reason: string;
      };
      const updated = ledgerRepo.activateSubscriptionAndAddCredits({
        telegramId: Number(telegramId),
        creditsToAdd: Number(creditsToAdd),
        subscriptionDays: subscriptionDays ? Number(subscriptionDays) : 30,
        idempotencyKey: `admin_sub_${telegramId}_${Date.now()}`,
        adminActorId: 100001,
        adminRole: 'OWNER',
        reason: reason || 'Admin subscription activation',
      });
      res.json({ ok: true, user: updated });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  app.post('/api/users/adjust', (req, res) => {
    try {
      const { telegramId, paidCreditsDelta, trialRemainingSet, revokeSubscription, banUser, reason } =
        req.body as {
          telegramId: number;
          paidCreditsDelta?: number;
          trialRemainingSet?: number;
          revokeSubscription?: boolean;
          banUser?: boolean;
          reason: string;
        };
      const updated = ledgerRepo.adminAdjustUserBalance({
        telegramId: Number(telegramId),
        paidCreditsDelta:
          paidCreditsDelta !== undefined ? Number(paidCreditsDelta) : undefined,
        trialRemainingSet:
          trialRemainingSet !== undefined ? Number(trialRemainingSet) : undefined,
        revokeSubscription,
        banUser,
        adminActorId: 100001,
        adminRole: 'OWNER',
        reason,
      });
      res.json({ ok: true, user: updated });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  // 3. Requests & Quarantine Inspector
  app.get('/api/requests', (req, res) => {
    const lane =
      req.query.lane === 'REAL' || req.query.lane === 'TEST'
        ? (req.query.lane as AccountLane)
        : undefined;
    const requests = queueOrchestrator.listRequests(50, lane);
    const quarantined = correlationEngine.listQuarantinedResponses(50, true);
    res.json({ requests, quarantined });
  });

  // 4. Secrets Checklist & Guided MTProto Session Wizard
  app.get('/api/secrets-checklist', (_req, res) => {
    res.json({
      checklist: evaluateSecretsChecklist(),
      accounts: mtprotoManager.getAllAccountsState(),
    });
  });

  app.post('/api/mtproto/wizard/phone', async (req, res) => {
    try {
      const { lane, apiId, apiHash, phoneNumber } = req.body as {
        lane: AccountLane;
        apiId: number;
        apiHash: string;
        phoneNumber: string;
      };
      const result = await mtprotoManager.startSessionWizardPhoneStep({
        lane,
        apiId: Number(apiId),
        apiHash,
        phoneNumber,
        adminActorId: 100001,
      });
      res.json({ ok: true, result, accounts: mtprotoManager.getAllAccountsState() });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  app.post('/api/mtproto/wizard/otp', async (req, res) => {
    try {
      const { lane, otpCode, requires2Fa } = req.body as {
        lane: AccountLane;
        otpCode: string;
        requires2Fa?: boolean;
      };
      const result = await mtprotoManager.submitSessionWizardOtpStep({
        lane,
        otpCode,
        requires2Fa,
        adminActorId: 100001,
      });
      res.json({ ok: true, result, accounts: mtprotoManager.getAllAccountsState() });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  app.post('/api/mtproto/wizard/2fa', async (req, res) => {
    try {
      const { lane, password2Fa } = req.body as {
        lane: AccountLane;
        password2Fa: string;
      };
      const result = await mtprotoManager.submitSessionWizard2FaStep({
        lane,
        password2Fa,
        adminActorId: 100001,
      });
      res.json({ ok: true, result, accounts: mtprotoManager.getAllAccountsState() });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  // 5. Configuration Studio & Audit Trail
  app.get('/api/config', (_req, res) => {
    res.json({
      activeConfig: configStudio.getConfig(),
      history: configStudio.listVersionHistory(20),
      auditLogs: configStudio.listAuditLogs(40),
    });
  });

  app.post('/api/config', (req, res) => {
    try {
      const { partialUpdate, reason } = req.body as {
        partialUpdate: Record<string, unknown>;
        reason: string;
      };
      const updated = configStudio.updateConfig(
        partialUpdate,
        100001,
        'OWNER',
        reason
      );
      res.json({
        ok: true,
        activeConfig: updated.config,
        history: configStudio.listVersionHistory(20),
        auditLogs: configStudio.listAuditLogs(40),
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  app.post('/api/config/rollback', (req, res) => {
    try {
      const { targetVersionNumber, reason } = req.body as {
        targetVersionNumber: number;
        reason: string;
      };
      const rolledBack = configStudio.rollbackToVersion(
        Number(targetVersionNumber),
        100001,
        'OWNER',
        reason
      );
      res.json({
        ok: true,
        activeConfig: rolledBack.config,
        history: configStudio.listVersionHistory(20),
        auditLogs: configStudio.listAuditLogs(40),
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  // 6. Isolated Operational Simulator & Automated Verification Suite (Tests A-L)
  app.get('/api/verification/run', async (_req, res) => {
    const suiteReport = await runFullVerificationSuite();
    res.json(suiteReport);
  });

  app.post('/api/bot/simulate', (req, res) => {
    const { telegramId, actionType, category, preferEditInPlace } = req.body as {
      telegramId?: number;
      actionType: 'start' | 'select_category' | 'help' | 'status' | 'cancel' | 'admin';
      category?: SearchCategory;
      preferEditInPlace?: boolean;
    };
    const uid = Number(telegramId) || 100001;
    switch (actionType) {
      case 'start':
        res.json(
          primaryBotService.handleStartOrMainMenu({
            telegramId: uid,
            preferEditInPlace: Boolean(preferEditInPlace),
          })
        );
        return;
      case 'select_category':
        res.json(
          primaryBotService.handleSelectCategory({
            telegramId: uid,
            category: category ?? 'PHONE',
          })
        );
        return;
      case 'help':
        res.json(
          primaryBotService.handleHelpCommand({
            telegramId: uid,
            preferEditInPlace: Boolean(preferEditInPlace),
          })
        );
        return;
      case 'status':
        res.json(primaryBotService.handleStatusCommand(uid));
        return;
      case 'cancel':
        res.json(primaryBotService.handleCancelCommand(uid));
        return;
      case 'admin':
        res.json(primaryBotService.handleAdminControlCenter(uid, 'health'));
        return;
    }
  });

  app.post('/api/simulator/validate', (req, res) => {
    const { category, rawInput } = req.body as {
      category: SearchCategory;
      rawInput: string;
    };
    const cfg = configStudio.getConfig();
    const validation = validateInputByCategory(category, rawInput ?? '', {
      enableNationalIdChecksum: cfg.enableNationalIdChecksum,
      telegramIdValidationPolicy: cfg.telegramIdValidationPolicy,
      enableBankCardLuhn: cfg.enableBankCardLuhn,
      strictLegacyIpv4: cfg.strictLegacyIpv4,
    });
    res.json({ validation });
  });

  app.post('/api/simulator/pipeline', async (req, res) => {
    const {
      lane,
      behaviorMode,
      rawDestinationChunks,
      telegramId,
      category,
      rawQueryInput,
    } = req.body as {
      lane: AccountLane;
      behaviorMode: 'BEHAVIOR_A_DELETE_AND_SEND' | 'BEHAVIOR_B_IN_PLACE_EDIT' | 'DIRECT_FIREWALL_TEST';
      rawDestinationChunks: string[];
      telegramId?: number;
      category?: SearchCategory;
      rawQueryInput?: string;
    };

    const selectedLane: AccountLane = lane === 'TEST' ? 'TEST' : 'REAL';
    const chunks = Array.isArray(rawDestinationChunks) ? rawDestinationChunks : [];
    const firstChunk = chunks[0] ?? '';

    // Check Section 3 Firewall
    const sec3 = inspectSection3Firewall(firstChunk);
    if (sec3.blocked) {
      correlationEngine.quarantinePayload(
        selectedLane,
        9001,
        null,
        'BLOCKED_SECTION_3',
        firstChunk
      );
      if (sec3.requiresSupportModeCancelDispatch) {
        mtprotoManager.setSupportModeLock(selectedLane, true);
      } else if (sec3.isSupportModeDeactivated) {
        mtprotoManager.setSupportModeLock(selectedLane, false);
      }
      res.json({
        stage: 'SECTION_3_FIREWALL_BLOCKED',
        sec3,
        quarantined: true,
        deducted: 0,
      });
      return;
    }

    // Check Section 4 Error Machine
    const sec4 = evaluateSection4ErrorSignature(firstChunk, selectedLane);
    if (sec4.matched && sec4.blockEntireMessage) {
      correlationEngine.quarantinePayload(
        selectedLane,
        9002,
        null,
        sec4.signatureId === '4.3_FREE_VERSION_MASKED_OUTPUT' && selectedLane === 'REAL'
          ? 'MASKED_REAL_ACCOUNT_WARNING'
          : 'BLOCKED_SECTION_4_ERROR',
        firstChunk
      );
      if (sec4.newAccountConnectionStatus) {
        mtprotoManager.updateAccountConnectionStatus(selectedLane, sec4.newAccountConnectionStatus);
      }
      res.json({
        stage: 'SECTION_4_ERROR_INTERCEPTED',
        sec4,
        quarantined: true,
        deducted: 0,
      });
      return;
    }

    // Otherwise run full End-to-End Queue + Behavior A/B Correlation + AST White-Label Rendering
    const simUserId = telegramId ? Number(telegramId) : selectedLane === 'REAL' ? 2049102 : 3088415;
    const simCategory: SearchCategory = category ?? 'PHONE';
    const simInput = rawQueryInput || '09123456789';

    // Ensure lane is marked CONNECTED for simulator execution
    mtprotoManager.updateAccountConnectionStatus(selectedLane, 'CONNECTED');

    const submitRes = await queueOrchestrator.submitSearchRequest({
      telegramId: simUserId,
      category: simCategory,
      rawInput: simInput,
      userMessageId: 501,
    });

    if (!submitRes.accepted || !submitRes.request) {
      res.json({
        stage: 'VALIDATION_OR_ELIGIBILITY_REJECTED',
        submitRes,
      });
      return;
    }

    // Wait a brief moment for the single-concurrency worker to dispatch the request
    await new Promise((r) => setTimeout(r, 30));
    const reqLane = submitRes.request.accountLane;
    const slot = correlationEngine.getActiveSlot(reqLane);

    if (slot) {
      const tempMsgId = slot.outboundGramJsMessageId + 1;
      await correlationEngine.handleInboundNewMessage(reqLane, tempMsgId, '🔍 در حال جستجو... ⏳');

      if (behaviorMode === 'BEHAVIOR_A_DELETE_AND_SEND') {
        correlationEngine.handleInboundMessageDeleted(reqLane, [tempMsgId]);
        for (let i = 0; i < chunks.length; i++) {
          await correlationEngine.handleInboundNewMessage(
            reqLane,
            tempMsgId + 1 + i,
            chunks[i]!
          );
        }
      } else {
        // Behavior B: In-place edit of temporary searching message into chunk 0, followed by remaining chunks
        await correlationEngine.handleInboundMessageEdited(reqLane, tempMsgId, chunks[0] ?? '');
        for (let i = 1; i < chunks.length; i++) {
          await correlationEngine.handleInboundNewMessage(
            reqLane,
            tempMsgId + i,
            chunks[i]!
          );
        }
      }

      correlationEngine.finalizeCollectionWindow(reqLane, slot.requestId);
      await new Promise((r) => setTimeout(r, 30));
    }

    const finalRequest = queueOrchestrator.getRequestById(submitRes.request.requestId);
    const cfg = configStudio.getConfig();
    const cleanedChunks =
      sec4.stripMaskedWarningHeaderOnly && sec4.cleanedTextAfterStrip
        ? [sec4.cleanedTextAfterStrip, ...chunks.slice(1)]
        : chunks;

    const ast = parseDestinationPayloadToAst(cleanedChunks, {
      fallbackQueryTarget: simInput,
      isTrialWatermarked: reqLane === 'TEST' || sec4.attachTrialWatermark,
      customDatabaseTitles: cfg.customDatabaseTitles,
    });

    const renderedPages = ast.isValidPositivePayload
      ? renderWhiteLabelReportPages(ast, {
          referenceCode: submitRes.request.referenceCode,
          headerTitle: cfg.whiteLabelHeaderTitle,
          footerText: cfg.whiteLabelFooterText,
          trialWatermarkText: cfg.trialWatermarkText,
        }).map((p) => sanitizeOutboundUserText(p).cleanText)
      : [];

    res.json({
      stage: 'COMPLETED_WHITE_LABEL_RENDER',
      behaviorMode,
      request: finalRequest,
      ast,
      renderedPages,
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(env.adminServerPort, env.adminServerHost, () => {
    console.log(
      `[Sovereign Relay Platform] Server listening on http://${env.adminServerHost}:${env.adminServerPort}`
    );
  });
}

void startServer();
