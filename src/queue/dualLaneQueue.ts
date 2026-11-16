import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { type CryptoService, maskPII } from '../crypto/aesGcm';
import type { ConfigStudioService } from '../db/configStudio';
import type { AccountLane, RequestLifecycleState } from '../db/database';
import type { LedgerRepository } from '../db/ledgerRepository';
import type { SessionRepository } from '../db/sessionRepository';
import { sanitizeOutboundUserText } from '../firewall/outboundSanitizer';
import type { DualAccountMtProtoManager } from '../mtproto/accountWorker';
import type { TwoLayerCorrelationEngine } from '../mtproto/correlationEngine';
import { toPersianDigits } from '../utils/normalizer';
import {
  type SearchCategory,
  validateInputByCategory,
} from '../validation/validators';

export interface RequestRecord {
  requestId: string;
  referenceCode: string;
  telegramId: number;
  inputCategory: SearchCategory;
  rawInputMasked: string;
  accountLane: AccountLane;
  state: RequestLifecycleState;
  queuePositionInitial: number;
  userMessageId: number | null;
  botStatusMessageId: number | null;
  destChatId: string | null;
  destOutboundMsgId: number | null;
  destTempSearchMsgId: number | null;
  firstResultAt: number | null;
  completedAt: number | null;
  processingDurationMs: number | null;
  errorCode: string | null;
  quotaOrCreditDeducted: number;
  createdAt: number;
}

export interface PrimaryBotDeliveryAdapter {
  sendInitialSearchingStatus(
    telegramId: number,
    textFa: string,
    replyToMessageId?: number | null
  ): Promise<number>;
  editSearchingStatusMessage(
    telegramId: number,
    statusMessageId: number,
    newTextFa: string
  ): Promise<boolean>;
  deleteSearchingStatusMessage(telegramId: number, statusMessageId: number): Promise<void>;
  sendPaginatedResultMessages(
    telegramId: number,
    pagesFa: string[],
    replyToMessageId?: number | null
  ): Promise<void>;
}

export interface SubmitSearchRequestOutcome {
  accepted: boolean;
  request?: RequestRecord;
  rejectionState?: 'REJECTED';
  rejectionMessageFa?: string;
  queuePosition?: number;
}

/**
 * ADR-02 & Section 4.2:
 * Persistent Dual-Lane FIFO Queue (`REAL_LANE` concurrency = 1, `TEST_LANE` concurrency = 1,
 * global `MAX_QUEUE_SIZE = 1000`), executing the 18-step / 16-state Request Lifecycle State Machine.
 */
export class DualLaneQueueOrchestrator {
  private readonly db: Database.Database;
  private readonly cryptoService: CryptoService;
  private readonly configStudio: ConfigStudioService;
  private readonly ledgerRepo: LedgerRepository;
  private readonly sessionRepo: SessionRepository;
  private readonly mtprotoManager: DualAccountMtProtoManager;
  private readonly correlationEngine: TwoLayerCorrelationEngine;
  private botDeliveryAdapter: PrimaryBotDeliveryAdapter | null = null;

  /**
   * Independent single-concurrency worker locks per lane (`WORKER_CONCURRENCY = 1` per account).
   */
  private readonly workerRunning: Record<AccountLane, boolean> = {
    REAL: false,
    TEST: false,
  };

  private referenceSequence = 849200;

  constructor(params: {
    db: Database.Database;
    cryptoService: CryptoService;
    configStudio: ConfigStudioService;
    ledgerRepo: LedgerRepository;
    sessionRepo: SessionRepository;
    mtprotoManager: DualAccountMtProtoManager;
    correlationEngine: TwoLayerCorrelationEngine;
  }) {
    this.db = params.db;
    this.cryptoService = params.cryptoService;
    this.configStudio = params.configStudio;
    this.ledgerRepo = params.ledgerRepo;
    this.sessionRepo = params.sessionRepo;
    this.mtprotoManager = params.mtprotoManager;
    this.correlationEngine = params.correlationEngine;
  }

  public bindPrimaryBotDeliveryAdapter(adapter: PrimaryBotDeliveryAdapter): void {
    this.botDeliveryAdapter = adapter;
  }

  /**
   * Steps 1–4 of the 18-Step Request Lifecycle State Machine:
   * 1. Receive & Identify (`RECEIVED`)
   * 2. Validate Input & Category (`VALIDATING` -> `REJECTED` on failure)
   * 3. Check Per-User Cap & Quota/Credits (`AUTHORIZED`, select `REAL` vs `TEST` lane)
   * 4. Persist & Enqueue (`QUEUED` -> `WAITING`), send `🔍 در حال جستجو... ⏳` with queue position N
   */
  public async submitSearchRequest(params: {
    telegramId: number;
    username?: string | null;
    firstName?: string | null;
    category: SearchCategory;
    rawInput: string;
    userMessageId?: number | null;
  }): Promise<SubmitSearchRequestOutcome> {
    const config = this.configStudio.getConfig();
    this.ledgerRepo.getOrCreateUser(params.telegramId, params.username, params.firstName);

    const requestId = crypto.randomUUID();
    const referenceCode = this.generateNextReferenceCode();
    const maskedInput = maskPII(params.rawInput, params.category);
    const now = Date.now();

    // Step 2: Validate Input & Category BEFORE queue insertion
    const validation = validateInputByCategory(params.category, params.rawInput, {
      enableNationalIdChecksum: config.enableNationalIdChecksum,
      telegramIdValidationPolicy: config.telegramIdValidationPolicy,
      enableBankCardLuhn: config.enableBankCardLuhn,
      strictLegacyIpv4: config.strictLegacyIpv4,
    });

    if (!validation.valid) {
      // Persist rejected audit trace (`RECEIVED` -> `VALIDATING` -> `REJECTED`) with 0 deduction
      const encryptedInput = this.cryptoService.encrypt(validation.normalizedValue || params.rawInput);
      this.db
        .prepare(
          `INSERT INTO requests (
            request_id, reference_code, telegram_id, input_category,
            raw_input_masked, normalized_input_encrypted, account_lane,
            state, queue_position_initial, user_message_id, error_code,
            quota_or_credit_deducted, completed_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'TEST', 'REJECTED', 0, ?, ?, 0, ?, ?)`
        )
        .run(
          requestId,
          referenceCode,
          params.telegramId,
          params.category,
          maskedInput,
          encryptedInput,
          params.userMessageId ?? null,
          validation.errorCode ?? 'VALIDATION_FAILED',
          now,
          now
        );

      const examplesFa = validation.validExamples.map((ex) => `• \`${ex}\``).join('\n');
      return {
        accepted: false,
        rejectionState: 'REJECTED',
        rejectionMessageFa: `${validation.errorMessageFa}\n\n✅ نمونههای معتبر:\n${examplesFa}`,
      };
    }

    // Step 3: Check Per-User Active Request Cap, Access Policy & Quota/Credits
    const eligibility = this.ledgerRepo.evaluateUserEligibility(params.telegramId);
    if (!eligibility.eligible || !eligibility.lane) {
      let msgFa = '❌ امکان ثبت درخواست جدید وجود ندارد.';
      if (eligibility.reasonCode === 'USER_BANNED') {
        msgFa = '⛔ حساب کاربری شما در سامانه مسدود شده است.';
      } else if (eligibility.reasonCode === 'ACCESS_POLICY_DENIED') {
        msgFa =
          '🔒 دسترسی به سامانه در حال حاضر محدود به مشترکین تاییدشده میباشد. جهت فعالسازی اشتراک با پشتیبانی تماس بگیرید.';
      } else if (eligibility.reasonCode === 'ACTIVE_REQUEST_CAP_REACHED') {
        msgFa =
          '⏳ شما یک درخواست فعال در صف یا در حال پردازش دارید. لطفاً تا پایان پردازش صبر کنید یا با دستور /cancel آن را لغو نمایید.';
      } else if (eligibility.reasonCode === 'NO_QUOTA_OR_CREDITS') {
        msgFa =
          '💳 سهمیه جستجوی آزمایشی (رایگان) شما به پایان رسیده است.\n✨ جهت ادامه استفاده نامحدود و دریافت گزارشهای کامل، لطفاً اشتراک تهیه فرمایید.';
      }
      return {
        accepted: false,
        rejectionState: 'REJECTED',
        rejectionMessageFa: msgFa,
      };
    }

    // Check Global Queue Capacity (`MAX_QUEUE_SIZE = 1000`)
    const globalQueueDepth = this.getGlobalQueueDepth();
    if (globalQueueDepth >= config.maxQueueSize) {
      return {
        accepted: false,
        rejectionState: 'REJECTED',
        rejectionMessageFa:
          '⚠️ ظرفیت صف پردازش سامانه در حال حاضر تکمیل است. لطفاً چند لحظه دیگر مجدداً تلاش فرمایید.',
      };
    }

    const selectedLane = eligibility.lane;
    const encryptedNormalized = this.cryptoService.encrypt(validation.normalizedValue);

    // Step 4: Persist & Enqueue inside atomic transaction (`RECEIVED` -> `VALIDATING` -> `AUTHORIZED` -> `QUEUED` -> `WAITING`)
    const queuePosition = this.getLaneQueueDepth(selectedLane) + 1;

    this.db
      .prepare(
        `INSERT INTO requests (
          request_id, reference_code, telegram_id, input_category,
          raw_input_masked, normalized_input_encrypted, account_lane,
          state, queue_position_initial, user_message_id,
          quota_or_credit_deducted, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'WAITING', ?, ?, 0, ?)`
      )
      .run(
        requestId,
        referenceCode,
        params.telegramId,
        params.category,
        maskedInput,
        encryptedNormalized,
        selectedLane,
        queuePosition,
        params.userMessageId ?? null,
        now
      );

    // Send initial status message `🔍 در حال جستجو... ⏳` with queue position N
    let botStatusMsgId: number | null = null;
    if (this.botDeliveryAdapter) {
      const searchingTextFa =
        `🔍 در حال جستجو... ⏳\n` +
        `🔹 شناسه پیگیری: ${referenceCode}\n` +
        `🔹 جایگاه در صف پردازش: ${toPersianDigits(queuePosition)}`;
      const sanitizedStatus = sanitizeOutboundUserText(searchingTextFa);
      botStatusMsgId = await this.botDeliveryAdapter.sendInitialSearchingStatus(
        params.telegramId,
        sanitizedStatus.cleanText,
        params.userMessageId
      );
      this.db
        .prepare('UPDATE requests SET bot_status_message_id = ? WHERE request_id = ?')
        .run(botStatusMsgId, requestId);
    }

    const createdRecord = this.getRequestById(requestId)!;

    // Trigger the isolated lane worker asynchronously
    queueMicrotask(() => {
      void this.triggerLaneWorker(selectedLane);
    });

    return {
      accepted: true,
      request: createdRecord,
      queuePosition,
    };
  }

  /**
   * Processes the next FIFO request in `REAL_LANE` or `TEST_LANE` with strict concurrency = 1 per lane.
   * Never shares or fails over between `REAL` and `TEST`.
   */
  public async triggerLaneWorker(lane: AccountLane): Promise<void> {
    if (this.workerRunning[lane]) {
      return;
    }
    if (this.configStudio.getConfig().queuePaused) {
      return;
    }

    this.workerRunning[lane] = true;
    try {
      while (!this.configStudio.getConfig().queuePaused) {
        const nextReq = this.claimNextWaitingRequestInLane(lane);
        if (!nextReq) {
          break;
        }
        await this.executeSingleDispatchedRequest(lane, nextReq);
      }
    } finally {
      this.workerRunning[lane] = false;
    }
  }

  private claimNextWaitingRequestInLane(lane: AccountLane): RequestRecord | null {
    const tx = this.db.transaction((): RequestRecord | null => {
      const row = this.db
        .prepare(
          `SELECT request_id FROM requests
           WHERE account_lane = ? AND state IN ('QUEUED', 'WAITING')
           ORDER BY created_at ASC, rowid ASC
           LIMIT 1`
        )
        .get(lane) as { request_id: string } | undefined;

      if (!row) return null;

      this.db
        .prepare(`UPDATE requests SET state = 'PROCESSING' WHERE request_id = ?`)
        .run(row.request_id);

      return this.getRequestById(row.request_id);
    });

    return tx.immediate();
  }

  private async executeSingleDispatchedRequest(
    lane: AccountLane,
    req: RequestRecord
  ): Promise<void> {
    // Verify intermediary MTProto account connection health on THIS lane only (Zero Fallback Rule)
    const health = this.mtprotoManager.isLaneHealthyForDispatch(lane);
    if (!health.healthy) {
      const now = Date.now();
      this.db
        .prepare(
          `UPDATE requests
           SET state = 'TEMPORARILY_UNAVAILABLE',
               error_code = ?,
               quota_or_credit_deducted = 0,
               completed_at = ?,
               processing_duration_ms = ?
           WHERE request_id = ?`
        )
        .run(health.reasonCode ?? 'LANE_UNHEALTHY', now, now - req.createdAt, req.requestId);

      this.ledgerRepo.settleRequestAccounting(
        req.requestId,
        req.telegramId,
        lane,
        'TEMPORARILY_UNAVAILABLE'
      );

      await this.deliverTerminalOutcomeToUser(
        req,
        'TEMPORARILY_UNAVAILABLE',
        undefined,
        '⚠️ سرویس استعلام در حال حاضر به دلیل بروزرسانی فنی موقتاً در دسترس نمیباشد. هیچ اعتباری از حساب شما کسر نشد. لطفاً دقایقی دیگر مجدداً تلاش فرمایید.'
      );
      return;
    }

    // Decrypt normalized query for upstream forwarding
    const encRow = this.db
      .prepare('SELECT normalized_input_encrypted FROM requests WHERE request_id = ?')
      .get(req.requestId) as { normalized_input_encrypted: string };
    const normalizedQuery = this.cryptoService.decrypt(encRow.normalized_input_encrypted);

    const destBotPeer = this.configStudio.getConfig().destinationBotUsername;
    const dispatchedAt = Date.now();

    let outboundInfo: { outboundMsgId: number; destinationChatId: string };
    try {
      outboundInfo = await this.mtprotoManager.sendMessageToDestination(
        lane,
        destBotPeer,
        normalizedQuery
      );
    } catch (err) {
      const now = Date.now();
      this.db
        .prepare(
          `UPDATE requests
           SET state = 'TEMPORARILY_UNAVAILABLE',
               error_code = 'MTPROTO_SEND_ERROR',
               quota_or_credit_deducted = 0,
               completed_at = ?,
               processing_duration_ms = ?
           WHERE request_id = ?`
        )
        .run(now, now - req.createdAt, req.requestId);

      this.ledgerRepo.settleRequestAccounting(
        req.requestId,
        req.telegramId,
        lane,
        'TEMPORARILY_UNAVAILABLE'
      );

      await this.deliverTerminalOutcomeToUser(
        req,
        'TEMPORARILY_UNAVAILABLE',
        undefined,
        '⚠️ سرویس استعلام در حال حاضر به دلیل بروزرسانی فنی موقتاً در دسترس نمیباشد. هیچ اعتباری از حساب شما کسر نشد.'
      );
      return;
    }

    // Transition `PROCESSING` -> `FORWARDED` -> `AWAITING_DESTINATION_RESPONSE`
    this.db
      .prepare(
        `UPDATE requests
         SET state = 'AWAITING_DESTINATION_RESPONSE',
             dest_chat_id = ?,
             dest_outbound_msg_id = ?
         WHERE request_id = ?`
      )
      .run(outboundInfo.destinationChatId, outboundInfo.outboundMsgId, req.requestId);

    // Register Two-Layer Correlation Slot and await resolution (via 5s Collection Window, Section 4 Error, or 30s/60s Timeout)
    const outcome = await this.correlationEngine.registerDispatchedRequest({
      requestId: req.requestId,
      referenceCode: req.referenceCode,
      userId: req.telegramId,
      userMessageId: req.userMessageId,
      statusMessageId: req.botStatusMessageId,
      accountType: lane,
      queryNormalized: normalizedQuery,
      destinationChatId: outboundInfo.destinationChatId,
      outboundGramJsMessageId: outboundInfo.outboundMsgId,
      dispatchedAt,
    });

    // Step 7: Atomic Financial & Quota Accounting inside `BEGIN IMMEDIATE ... COMMIT`
    this.db
      .prepare(
        `UPDATE requests
         SET state = ?,
             dest_temp_search_msg_id = COALESCE(?, dest_temp_search_msg_id),
             first_result_at = COALESCE(?, first_result_at),
             completed_at = ?,
             processing_duration_ms = ?,
             error_code = ?
         WHERE request_id = ?`
      )
      .run(
        outcome.finalState,
        outcome.destTempSearchMsgId ?? null,
        outcome.firstResultAt ?? null,
        outcome.completedAt,
        outcome.processingDurationMs,
        outcome.errorCode ?? null,
        req.requestId
      );

    this.ledgerRepo.settleRequestAccounting(
      req.requestId,
      req.telegramId,
      lane,
      outcome.finalState
    );

    // Step 9: Outbound Delivery, Final Sanitization Gate & UI Session Reset
    await this.deliverTerminalOutcomeToUser(
      req,
      outcome.finalState,
      outcome.renderedPages,
      outcome.safeUserNoticeFa
    );
  }

  private async deliverTerminalOutcomeToUser(
    req: RequestRecord,
    finalState: RequestLifecycleState,
    renderedPages?: string[],
    safeUserNoticeFa?: string
  ): Promise<void> {
    // Always reset user's temporary UI session to MAIN_MENU upon request completion
    this.sessionRepo.resetSessionToMainMenu(req.telegramId);

    if (!this.botDeliveryAdapter) {
      return;
    }

    const updatedReq = this.getRequestById(req.requestId) ?? req;
    const statusMsgId = updatedReq.botStatusMessageId;

    if (finalState === 'COMPLETED' && renderedPages && renderedPages.length > 0) {
      const sanitizedPages = renderedPages.map((p) => sanitizeOutboundUserText(p).cleanText);

      if (sanitizedPages.length === 1 && statusMsgId !== null) {
        const edited = await this.botDeliveryAdapter.editSearchingStatusMessage(
          req.telegramId,
          statusMsgId,
          sanitizedPages[0]!
        );
        if (!edited) {
          await this.botDeliveryAdapter.sendPaginatedResultMessages(
            req.telegramId,
            sanitizedPages,
            req.userMessageId
          );
        }
      } else {
        if (statusMsgId !== null) {
          await this.botDeliveryAdapter.deleteSearchingStatusMessage(req.telegramId, statusMsgId);
        }
        await this.botDeliveryAdapter.sendPaginatedResultMessages(
          req.telegramId,
          sanitizedPages,
          req.userMessageId
        );
      }
      return;
    }

    if (finalState === 'CANCELLED') {
      return;
    }

    const fallbackNotice =
      safeUserNoticeFa ??
      '⚠️ سرویس استعلام در حال حاضر موقتاً در دسترس نمیباشد. هیچ اعتباری از حساب شما کسر نشد.';
    const sanitizedNotice = sanitizeOutboundUserText(fallbackNotice).cleanText;

    if (statusMsgId !== null) {
      const edited = await this.botDeliveryAdapter.editSearchingStatusMessage(
        req.telegramId,
        statusMsgId,
        sanitizedNotice
      );
      if (!edited) {
        await this.botDeliveryAdapter.sendPaginatedResultMessages(
          req.telegramId,
          [sanitizedNotice],
          req.userMessageId
        );
      }
    } else {
      await this.botDeliveryAdapter.sendPaginatedResultMessages(
        req.telegramId,
        [sanitizedNotice],
        req.userMessageId
      );
    }
  }

  /**
   * Section 4.3 `/cancel` Command Handler:
   * - If the user's request is in `QUEUED` or `WAITING` state, atomically transition it to `CANCELLED`
   *   so the worker never dispatches it, and deduct 0 quota/credits.
   * - If the request has already been dispatched (`PROCESSING` / `FORWARDED` / `AWAITING_DESTINATION_RESPONSE`),
   *   inform the user clearly that the query is already in transit to the upstream provider while
   *   detaching/quarantining late delivery, without falsely claiming upstream cancellation.
   */
  public cancelUserActiveRequest(
    telegramId: number,
    detachIfAlreadyForwarded: boolean = true
  ): {
    found: boolean;
    wasQueuedAndCancelled: boolean;
    wasAlreadyInTransit: boolean;
    request?: RequestRecord;
    messageFa: string;
  } {
    this.sessionRepo.resetSessionToMainMenu(telegramId);

    const activeReq = this.getActiveRequestForUser(telegramId);
    if (!activeReq) {
      return {
        found: false,
        wasQueuedAndCancelled: false,
        wasAlreadyInTransit: false,
        messageFa:
          'ℹ️ شما در حال حاضر هیچ درخواست فعالی در صف انتظار ندارید. وضعیت منوی شما به حالت اولیه بازنشانی شد.',
      };
    }

    if (activeReq.state === 'QUEUED' || activeReq.state === 'WAITING') {
      const now = Date.now();
      this.db
        .prepare(
          `UPDATE requests
           SET state = 'CANCELLED',
               error_code = 'USER_CANCELLED_IN_QUEUE',
               quota_or_credit_deducted = 0,
               completed_at = ?,
               processing_duration_ms = ?
           WHERE request_id = ? AND state IN ('QUEUED', 'WAITING')`
        )
        .run(now, now - activeReq.createdAt, activeReq.requestId);

      this.ledgerRepo.settleRequestAccounting(
        activeReq.requestId,
        telegramId,
        activeReq.accountLane,
        'CANCELLED'
      );

      return {
        found: true,
        wasQueuedAndCancelled: true,
        wasAlreadyInTransit: false,
        request: this.getRequestById(activeReq.requestId) ?? activeReq,
        messageFa: `✅ درخواست شما با شناسه \`${activeReq.referenceCode}\` پیش از ارسال به هسته پردازش با موفقیت لغو شد.\n✨ هیچ سهمیه یا اعتباری از حساب شما کسر نگردید.`,
      };
    }

    // Request is already in transit (`PROCESSING`, `FORWARDED`, `AWAITING_DESTINATION_RESPONSE`, `RESPONSE_RECEIVED`)
    if (detachIfAlreadyForwarded) {
      this.correlationEngine.detachInFlightRequestOnUserCancel(
        activeReq.accountLane,
        activeReq.requestId
      );
      const now = Date.now();
      this.db
        .prepare(
          `UPDATE requests
           SET state = 'CANCELLED',
               error_code = 'USER_CANCELLED_IN_FLIGHT',
               quota_or_credit_deducted = 0,
               completed_at = ?
           WHERE request_id = ?`
        )
        .run(now, activeReq.requestId);
    }

    return {
      found: true,
      wasQueuedAndCancelled: false,
      wasAlreadyInTransit: true,
      request: this.getRequestById(activeReq.requestId) ?? activeReq,
      messageFa:
        `⚠️ درخواست شما با شناسه \`${activeReq.referenceCode}\` قبلاً به سمت سرور مرجع ارسال شده است (امکان لغو در سمت سرور مرجع وجود ندارد)، اما دریافت پاسخ برای حساب شما متوقف و قرنطینه گردید و هیچ اعتباری از شما کسر نخواهد شد.`,
    };
  }

  /**
   * Section 4.3 `/status` Command Support:
   * Allows a user to inspect ONLY their own active request (showing Request Reference ID,
   * current state, and authoritative FIFO queue position).
   */
  public getUserActiveRequestStatus(telegramId: number): {
    hasActiveRequest: boolean;
    request?: RequestRecord;
    currentQueuePosition?: number;
    statusMessageFa: string;
  } {
    const active = this.getActiveRequestForUser(telegramId);
    if (!active) {
      return {
        hasActiveRequest: false,
        statusMessageFa: 'ℹ️ شما در حال حاضر هیچ درخواست فعالی در صف پردازش ندارید.',
      };
    }

    const pos = this.getAuthoritativeQueuePosition(active.requestId, active.accountLane);
    return {
      hasActiveRequest: true,
      request: active,
      currentQueuePosition: pos,
      statusMessageFa:
        `📊 وضعیت درخواست فعال شما:\n` +
        `🔹 شناسه پیگیری: \`${active.referenceCode}\`\n` +
        `🔹 وضعیت فعلی: ${active.state}\n` +
        `🔹 جایگاه فعلی در صف: ${pos > 0 ? toPersianDigits(pos) : 'در حال پردازش مستقیم'}`,
    };
  }

  public getActiveRequestForUser(telegramId: number): RequestRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM requests
         WHERE telegram_id = ?
           AND state IN ('RECEIVED','VALIDATING','AUTHORIZED','QUEUED','WAITING','PROCESSING','FORWARDED','AWAITING_DESTINATION_RESPONSE','RESPONSE_RECEIVED')
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(telegramId) as Record<string, unknown> | undefined;

    if (!row) return null;
    return this.mapRequestRow(row);
  }

  public getAuthoritativeQueuePosition(requestId: string, lane: AccountLane): number {
    const waitingRows = this.db
      .prepare(
        `SELECT request_id FROM requests
         WHERE account_lane = ? AND state IN ('QUEUED', 'WAITING')
         ORDER BY created_at ASC, rowid ASC`
      )
      .all(lane) as Array<{ request_id: string }>;

    const idx = waitingRows.findIndex((r) => r.request_id === requestId);
    return idx === -1 ? 0 : idx + 1;
  }

  public getLaneQueueDepth(lane: AccountLane): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as cnt FROM requests
         WHERE account_lane = ? AND state IN ('QUEUED', 'WAITING')`
      )
      .get(lane) as { cnt: number };
    return row.cnt;
  }

  public getGlobalQueueDepth(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as cnt FROM requests
         WHERE state IN ('QUEUED', 'WAITING', 'PROCESSING', 'FORWARDED', 'AWAITING_DESTINATION_RESPONSE')`
      )
      .get() as { cnt: number };
    return row.cnt;
  }

  public getRequestById(requestId: string): RequestRecord | null {
    const row = this.db
      .prepare('SELECT * FROM requests WHERE request_id = ?')
      .get(requestId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRequestRow(row);
  }

  public listRequests(limit: number = 50, lane?: AccountLane): RequestRecord[] {
    const rows = (
      lane
        ? this.db
            .prepare('SELECT * FROM requests WHERE account_lane = ? ORDER BY created_at DESC LIMIT ?')
            .all(lane, limit)
        : this.db
            .prepare('SELECT * FROM requests ORDER BY created_at DESC LIMIT ?')
            .all(limit)
    ) as Array<Record<string, unknown>>;

    return rows.map((r) => this.mapRequestRow(r));
  }

  public getQueueTelemetrySummary(): {
    realLaneWaiting: number;
    testLaneWaiting: number;
    realWorkerBusy: boolean;
    testWorkerBusy: boolean;
    queuePaused: boolean;
    latencyP50Ms: number;
    latencyP95Ms: number;
    latencyP99Ms: number;
  } {
    const durations = this.db
      .prepare(
        `SELECT processing_duration_ms FROM requests
         WHERE processing_duration_ms IS NOT NULL
         ORDER BY completed_at DESC
         LIMIT 200`
      )
      .all() as Array<{ processing_duration_ms: number }>;

    const sorted = durations.map((d) => d.processing_duration_ms).sort((a, b) => a - b);
    const percentile = (p: number): number => {
      if (sorted.length === 0) return 0;
      const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
      return sorted[idx] ?? 0;
    };

    return {
      realLaneWaiting: this.getLaneQueueDepth('REAL'),
      testLaneWaiting: this.getLaneQueueDepth('TEST'),
      realWorkerBusy: this.workerRunning.REAL || this.correlationEngine.hasActiveSlot('REAL'),
      testWorkerBusy: this.workerRunning.TEST || this.correlationEngine.hasActiveSlot('TEST'),
      queuePaused: this.configStudio.getConfig().queuePaused,
      latencyP50Ms: percentile(50),
      latencyP95Ms: percentile(95),
      latencyP99Ms: percentile(99),
    };
  }

  private generateNextReferenceCode(): string {
    const countRow = this.db
      .prepare('SELECT COUNT(*) as cnt FROM requests')
      .get() as { cnt: number };
    const nextNum = this.referenceSequence + countRow.cnt + 1;
    return `REQ-${nextNum}`;
  }

  private mapRequestRow(row: Record<string, unknown>): RequestRecord {
    return {
      requestId: String(row.request_id),
      referenceCode: String(row.reference_code),
      telegramId: Number(row.telegram_id),
      inputCategory: row.input_category as SearchCategory,
      rawInputMasked: String(row.raw_input_masked),
      accountLane: row.account_lane as AccountLane,
      state: row.state as RequestLifecycleState,
      queuePositionInitial: Number(row.queue_position_initial),
      userMessageId:
        row.user_message_id !== null && row.user_message_id !== undefined
          ? Number(row.user_message_id)
          : null,
      botStatusMessageId:
        row.bot_status_message_id !== null && row.bot_status_message_id !== undefined
          ? Number(row.bot_status_message_id)
          : null,
      destChatId: (row.dest_chat_id as string | null) ?? null,
      destOutboundMsgId:
        row.dest_outbound_msg_id !== null && row.dest_outbound_msg_id !== undefined
          ? Number(row.dest_outbound_msg_id)
          : null,
      destTempSearchMsgId:
        row.dest_temp_search_msg_id !== null && row.dest_temp_search_msg_id !== undefined
          ? Number(row.dest_temp_search_msg_id)
          : null,
      firstResultAt:
        row.first_result_at !== null && row.first_result_at !== undefined
          ? Number(row.first_result_at)
          : null,
      completedAt:
        row.completed_at !== null && row.completed_at !== undefined
          ? Number(row.completed_at)
          : null,
      processingDurationMs:
        row.processing_duration_ms !== null && row.processing_duration_ms !== undefined
          ? Number(row.processing_duration_ms)
          : null,
      errorCode: (row.error_code as string | null) ?? null,
      quotaOrCreditDeducted: Number(row.quota_or_credit_deducted),
      createdAt: Number(row.created_at),
    };
  }
}
