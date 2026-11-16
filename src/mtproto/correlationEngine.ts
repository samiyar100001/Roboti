import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CryptoService } from '../crypto/aesGcm';
import type { ConfigStudioService } from '../db/configStudio';
import type {
  AccountLane,
  MtProtoConnectionStatus,
  QuarantineReason,
  RequestLifecycleState,
} from '../db/database';
import { inspectSection3Firewall } from '../firewall/section3Firewall';
import { evaluateSection4ErrorSignature } from '../firewall/section4ErrorMachine';
import {
  isPositiveValidDataPayload,
  parseDestinationPayloadToAst,
} from '../parser/astParser';
import { renderWhiteLabelReportPages } from '../parser/whiteLabelRenderer';
import {
  normalizePersianOrthography,
  stripEmojiVariationSelectors,
} from '../utils/normalizer';

export interface ActiveCorrelationSlot {
  // Layer 1 (Internal Correlation)
  requestId: string;
  referenceCode: string;
  userId: number;
  userMessageId: number | null;
  statusMessageId: number | null;
  accountType: AccountLane;
  queryNormalized: string;
  dispatchedAt: number;

  // Layer 2 (Destination MTProto Correlation)
  destinationChatId: string;
  outboundGramJsMessageId: number;
  tempSearchingMessageId: number | null;
  tempSearchingDetectedAt: number | null;
  tempSearchingDeleted: boolean;

  // Multi-Part 5-Second Collection Window State
  firstResultAt: number | null;
  collectedChunks: Map<number, string>;
  attachTrialWatermark: boolean;

  // Active Watchdog Timers
  masterTimeoutTimer: NodeJS.Timeout | null;
  staleSearchWatchdogTimer: NodeJS.Timeout | null;
  collectionWindowTimer: NodeJS.Timeout | null;

  // Resolution Callback for the Single-Concurrency Lane Worker
  resolveCompletion: (outcome: CorrelationResolutionOutcome) => void;
}

export interface CorrelationResolutionOutcome {
  requestId: string;
  finalState: RequestLifecycleState;
  renderedPages?: string[];
  safeUserNoticeFa?: string;
  errorCode?: string;
  destTempSearchMsgId?: number | null;
  firstResultAt?: number | null;
  completedAt: number;
  processingDurationMs: number;
}

export interface QuarantinedResponseRecord {
  quarantineId: string;
  accountLane: AccountLane;
  destMsgId: number | null;
  matchedRequestId: string | null;
  quarantineReason: QuarantineReason;
  rawPayloadDecrypted?: string;
  createdAt: number;
}

export interface CorrelationEngineCallbacks {
  onSendCancelSupportMode: (lane: AccountLane) => Promise<void>;
  onSupportModeStateChange: (lane: AccountLane, active: boolean) => void;
  onUpdateAccountStatus: (
    lane: AccountLane,
    status: MtProtoConnectionStatus,
    telemetry?: { remainingQueries?: number; remainingDays?: number }
  ) => void;
  onCriticalAdminAlert: (alertText: string, metadata?: Record<string, unknown>) => void;
}

/**
 * Detects whether a destination bot message is its temporary "searching..." indicator
 * (`🔍 در حال جستجو... ⏳` or variants).
 */
export function isDestinationTemporarySearchingMessage(rawText: string): boolean {
  const norm = normalizePersianOrthography(stripEmojiVariationSelectors(rawText)).trim();
  if (!norm) return false;
  if (norm.includes('دیتابیس') || norm.includes('نتایج برای') || norm.includes('نتایج کد ملی')) {
    return false;
  }
  return (
    norm.includes('در حال جستجو') ||
    norm.includes('درحال جستجو') ||
    norm.includes('لطفا صبر کنید') ||
    norm.includes('لطفاً صبر کنید')
  );
}

export class TwoLayerCorrelationEngine {
  private readonly db: Database.Database;
  private readonly cryptoService: CryptoService;
  private readonly configStudio: ConfigStudioService;
  private readonly callbacks: CorrelationEngineCallbacks;

  private readonly activeSlots: Record<AccountLane, ActiveCorrelationSlot | null> = {
    REAL: null,
    TEST: null,
  };

  private readonly lastTimedOutOrDetachedRequest: Record<
    AccountLane,
    { requestId: string; outboundMsgId: number; expiredAt: number } | null
  > = {
    REAL: null,
    TEST: null,
  };

  constructor(
    db: Database.Database,
    cryptoService: CryptoService,
    configStudio: ConfigStudioService,
    callbacks: CorrelationEngineCallbacks
  ) {
    this.db = db;
    this.cryptoService = cryptoService;
    this.configStudio = configStudio;
    this.callbacks = callbacks;
  }

  public hasActiveSlot(lane: AccountLane): boolean {
    return this.activeSlots[lane] !== null;
  }

  public getActiveSlot(lane: AccountLane): ActiveCorrelationSlot | null {
    return this.activeSlots[lane];
  }

  /**
   * Registers a newly dispatched request into the lane's Two-Layer Correlation Slot
   * and starts the 30-second Master Request Timeout (`REQUEST_TIMEOUT_SECONDS = 30`).
   */
  public registerDispatchedRequest(params: {
    requestId: string;
    referenceCode: string;
    userId: number;
    userMessageId: number | null;
    statusMessageId: number | null;
    accountType: AccountLane;
    queryNormalized: string;
    destinationChatId: string;
    outboundGramJsMessageId: number;
    dispatchedAt?: number;
  }): Promise<CorrelationResolutionOutcome> {
    const lane = params.accountType;
    if (this.activeSlots[lane] !== null) {
      throw new Error(
        `INVARIANT VIOLATION: Lane ${lane} already has an active correlation slot (${this.activeSlots[lane]!.requestId}).`
      );
    }

    const now = params.dispatchedAt ?? Date.now();
    const config = this.configStudio.getConfig();
    const masterTimeoutMs = config.requestTimeoutSeconds * 1000;

    return new Promise<CorrelationResolutionOutcome>((resolve) => {
      const slot: ActiveCorrelationSlot = {
        requestId: params.requestId,
        referenceCode: params.referenceCode,
        userId: params.userId,
        userMessageId: params.userMessageId,
        statusMessageId: params.statusMessageId,
        accountType: lane,
        queryNormalized: params.queryNormalized,
        dispatchedAt: now,
        destinationChatId: params.destinationChatId,
        outboundGramJsMessageId: params.outboundGramJsMessageId,
        tempSearchingMessageId: null,
        tempSearchingDetectedAt: null,
        tempSearchingDeleted: false,
        firstResultAt: null,
        collectedChunks: new Map<number, string>(),
        attachTrialWatermark: lane === 'TEST',
        masterTimeoutTimer: null,
        staleSearchWatchdogTimer: null,
        collectionWindowTimer: null,
        resolveCompletion: resolve,
      };

      slot.masterTimeoutTimer = setTimeout(() => {
        this.handleRequestTimeout(lane, slot.requestId, 'MASTER_REQUEST_TIMEOUT');
      }, masterTimeoutMs);

      this.activeSlots[lane] = slot;
    });
  }

  /**
   * Detaches an in-flight request if a user invokes `/cancel` while the request is already
   * `FORWARDED` / `AWAITING_DESTINATION_RESPONSE`, quarantining any subsequent late delivery.
   */
  public detachInFlightRequestOnUserCancel(lane: AccountLane, requestId: string): boolean {
    const slot = this.activeSlots[lane];
    if (!slot || slot.requestId !== requestId) {
      return false;
    }

    this.clearSlotTimers(slot);
    this.lastTimedOutOrDetachedRequest[lane] = {
      requestId: slot.requestId,
      outboundMsgId: slot.outboundGramJsMessageId,
      expiredAt: Date.now(),
    };
    this.activeSlots[lane] = null;

    const now = Date.now();
    slot.resolveCompletion({
      requestId: slot.requestId,
      finalState: 'CANCELLED',
      errorCode: 'USER_CANCELLED_IN_FLIGHT',
      destTempSearchMsgId: slot.tempSearchingMessageId,
      firstResultAt: slot.firstResultAt,
      completedAt: now,
      processingDurationMs: now - slot.dispatchedAt,
    });
    return true;
  }

  public async handleInboundNewMessage(
    lane: AccountLane,
    destMsgId: number,
    rawText: string
  ): Promise<void> {
    await this.processInboundOrEditedMessage(lane, destMsgId, rawText, false);
  }

  public async handleInboundMessageEdited(
    lane: AccountLane,
    destMsgId: number,
    rawText: string
  ): Promise<void> {
    await this.processInboundOrEditedMessage(lane, destMsgId, rawText, true);
  }

  public handleInboundMessageDeleted(lane: AccountLane, deletedMsgIds: number[]): void {
    const slot = this.activeSlots[lane];
    if (!slot || slot.tempSearchingMessageId === null) {
      return;
    }
    if (deletedMsgIds.includes(slot.tempSearchingMessageId)) {
      slot.tempSearchingDeleted = true;
      if (slot.staleSearchWatchdogTimer) {
        clearTimeout(slot.staleSearchWatchdogTimer);
        slot.staleSearchWatchdogTimer = null;
      }
    }
  }

  private async processInboundOrEditedMessage(
    lane: AccountLane,
    destMsgId: number,
    rawText: string,
    isEdited: boolean
  ): Promise<void> {
    // 1. Run Section 3 Anti-Leakage Firewall FIRST
    const sec3 = inspectSection3Firewall(rawText);
    if (sec3.blocked) {
      this.quarantinePayload(
        lane,
        destMsgId,
        this.activeSlots[lane]?.requestId ?? null,
        'BLOCKED_SECTION_3',
        rawText
      );

      if (sec3.requiresSupportModeCancelDispatch) {
        this.callbacks.onSupportModeStateChange(lane, true);
        this.callbacks.onUpdateAccountStatus(lane, 'SUPPORT_MODE_LOCKED');
        await this.callbacks.onSendCancelSupportMode(lane);
      } else if (sec3.isSupportModeDeactivated) {
        this.callbacks.onSupportModeStateChange(lane, false);
        this.callbacks.onUpdateAccountStatus(lane, 'CONNECTED');
      }

      if (sec3.telemetry) {
        if (sec3.telemetry.profileExpiredAlert) {
          this.callbacks.onUpdateAccountStatus(lane, 'ACCESS_EXPIRED', {
            remainingQueries: 0,
            remainingDays: 0,
          });
          this.callbacks.onCriticalAdminAlert(
            `🚨 CRITICAL: ${lane} MTProto Account /start telemetry reports profile access expired (❌ دسترسی شما منقضی شده است).`
          );
        } else {
          this.callbacks.onUpdateAccountStatus(lane, 'CONNECTED', {
            remainingQueries: sec3.telemetry.remainingQueries,
            remainingDays: sec3.telemetry.remainingDays,
          });
        }
      }
      return;
    }

    const slot = this.activeSlots[lane];

    // 2. If no active correlation slot on this lane, quarantine as LATE_AFTER_TIMEOUT or UNMATCHED_CORRELATION
    if (!slot) {
      const recentExpired = this.lastTimedOutOrDetachedRequest[lane];
      const isLateAfterTimeout =
        recentExpired !== null &&
        destMsgId > recentExpired.outboundMsgId &&
        Date.now() - recentExpired.expiredAt < 120_000;

      this.quarantinePayload(
        lane,
        destMsgId,
        isLateAfterTimeout ? recentExpired!.requestId : null,
        isLateAfterTimeout ? 'LATE_AFTER_TIMEOUT' : 'UNMATCHED_CORRELATION',
        rawText
      );
      return;
    }

    // 3. Enforce monotonic message ID invariant (`inboundMsg.id > outboundGramJsMessageId`)
    // or match the recorded `tempSearchingMessageId` on Behavior B edits
    const isMonotonicValid =
      destMsgId > slot.outboundGramJsMessageId ||
      (isEdited && slot.tempSearchingMessageId !== null && destMsgId === slot.tempSearchingMessageId);

    if (!isMonotonicValid) {
      this.quarantinePayload(
        lane,
        destMsgId,
        slot.requestId,
        'UNMATCHED_CORRELATION',
        rawText
      );
      return;
    }

    // 4. Detect Destination Temporary Searching Message (`🔍 در حال جستجو... ⏳`)
    if (isDestinationTemporarySearchingMessage(rawText)) {
      slot.tempSearchingMessageId = destMsgId;
      slot.tempSearchingDetectedAt = Date.now();
      this.db
        .prepare('UPDATE requests SET dest_temp_search_msg_id = ? WHERE request_id = ?')
        .run(destMsgId, slot.requestId);

      // Start Stale Search Watchdog (`DESTINATION_STALE_SEARCH_TIMEOUT_SECONDS`, default 30s, up to 60s)
      if (slot.staleSearchWatchdogTimer) {
        clearTimeout(slot.staleSearchWatchdogTimer);
      }
      const staleWatchdogMs =
        this.configStudio.getConfig().destinationStaleSearchTimeoutSeconds * 1000;
      slot.staleSearchWatchdogTimer = setTimeout(() => {
        this.handleRequestTimeout(lane, slot.requestId, 'STALE_TEMP_SEARCH_MESSAGE_TIMEOUT');
      }, staleWatchdogMs);
      return;
    }

    // 5. Run Section 4 Destination Bot Error & Warning State Machine (Signatures 4.1 - 4.8)
    let textToParse = rawText;
    const sec4 = evaluateSection4ErrorSignature(rawText, lane);
    if (sec4.matched) {
      if (sec4.newAccountConnectionStatus) {
        this.callbacks.onUpdateAccountStatus(lane, sec4.newAccountConnectionStatus);
      }
      if (sec4.fireCriticalAdminAlert && sec4.adminAlertMessage) {
        this.callbacks.onCriticalAdminAlert(sec4.adminAlertMessage, {
          requestId: slot.requestId,
          lane,
          signatureId: sec4.signatureId,
        });
      }

      if (sec4.blockEntireMessage) {
        const quarantineReason: QuarantineReason =
          sec4.signatureId === '4.3_FREE_VERSION_MASKED_OUTPUT' && lane === 'REAL'
            ? 'MASKED_REAL_ACCOUNT_WARNING'
            : 'BLOCKED_SECTION_4_ERROR';

        this.quarantinePayload(lane, destMsgId, slot.requestId, quarantineReason, rawText);

        // Signature 4.4 (Invalid Tx Hash) is pure internal noise: ignore without failing user search
        if (sec4.signatureId === '4.4_INVALID_TX_HASH') {
          return;
        }

        // Complete the active request immediately with the target state (0 deduction)
        this.clearSlotTimers(slot);
        this.activeSlots[lane] = null;
        const now = Date.now();
        slot.resolveCompletion({
          requestId: slot.requestId,
          finalState: sec4.targetRequestState ?? 'TEMPORARILY_UNAVAILABLE',
          safeUserNoticeFa: sec4.safeUserNoticeFa,
          errorCode: sec4.signatureId,
          destTempSearchMsgId: slot.tempSearchingMessageId,
          firstResultAt: null,
          completedAt: now,
          processingDurationMs: now - slot.dispatchedAt,
        });
        return;
      }

      if (sec4.stripMaskedWarningHeaderOnly && sec4.cleanedTextAfterStrip) {
        textToParse = sec4.cleanedTextAfterStrip;
        slot.attachTrialWatermark = true;
      }
    }

    // 6. Verify Positive Valid Data Payload (Document 2.2)
    if (!isPositiveValidDataPayload(textToParse)) {
      this.quarantinePayload(
        lane,
        destMsgId,
        slot.requestId,
        'UNMATCHED_CORRELATION',
        rawText
      );
      return;
    }

    // 7. First Valid Data Result Detected!
    // Cancel Master Timeout and Stale Search Watchdog, and start the 5-Second Collection Window
    // (`COLLECTION_WINDOW_MS = 5000`) to capture all multi-message paginated chunks in strict sequence.
    const now = Date.now();
    const isFirstChunk = slot.firstResultAt === null;

    if (isFirstChunk) {
      slot.firstResultAt = now;
      if (slot.masterTimeoutTimer) {
        clearTimeout(slot.masterTimeoutTimer);
        slot.masterTimeoutTimer = null;
      }
      if (slot.staleSearchWatchdogTimer) {
        clearTimeout(slot.staleSearchWatchdogTimer);
        slot.staleSearchWatchdogTimer = null;
      }

      this.db
        .prepare(
          `UPDATE requests
           SET state = 'RESPONSE_RECEIVED',
               first_result_at = ?
           WHERE request_id = ?`
        )
        .run(now, slot.requestId);

      const collectionWindowMs = this.configStudio.getConfig().collectionWindowMs;
      slot.collectionWindowTimer = setTimeout(() => {
        this.finalizeCollectionWindow(lane, slot.requestId);
      }, collectionWindowMs);
    }

    slot.collectedChunks.set(destMsgId, textToParse);
  }

  /**
   * Executes when the 5-Second Multi-Part Result Collection Window (`COLLECTION_WINDOW_MS = 5000`)
   * completes: sorts all collected chunks by message ID in strict ascending order, parses into the
   * Canonical AST, and renders the White-Label Tree output pages.
   */
  public finalizeCollectionWindow(lane: AccountLane, requestId: string): void {
    const slot = this.activeSlots[lane];
    if (!slot || slot.requestId !== requestId) {
      return;
    }

    this.clearSlotTimers(slot);
    this.activeSlots[lane] = null;

    const orderedMsgIds = Array.from(slot.collectedChunks.keys()).sort((a, b) => a - b);
    const orderedChunks = orderedMsgIds.map((id) => slot.collectedChunks.get(id)!);

    const config = this.configStudio.getConfig();
    const astReport = parseDestinationPayloadToAst(orderedChunks, {
      fallbackQueryTarget: slot.queryNormalized,
      isTrialWatermarked: slot.attachTrialWatermark || lane === 'TEST',
      customDatabaseTitles: config.customDatabaseTitles,
    });

    const now = Date.now();

    if (!astReport.isValidPositivePayload || astReport.records.length === 0) {
      slot.resolveCompletion({
        requestId: slot.requestId,
        finalState: 'NO_RESULTS_FOUND',
        safeUserNoticeFa:
          'ℹ️ هیچ رکوردی مطابق با عبارت جستجو شده در سامانههای مرجع یافت نشد.\n✨ هیچ سهمیه یا اعتباری از حساب شما کسر نگردید.',
        errorCode: 'EMPTY_AST_RECORDS',
        destTempSearchMsgId: slot.tempSearchingMessageId,
        firstResultAt: slot.firstResultAt,
        completedAt: now,
        processingDurationMs: now - slot.dispatchedAt,
      });
      return;
    }

    const renderedPages = renderWhiteLabelReportPages(astReport, {
      referenceCode: slot.referenceCode,
      headerTitle: config.whiteLabelHeaderTitle,
      footerText: config.whiteLabelFooterText,
      trialWatermarkText: config.trialWatermarkText,
      maxMessageLength: 4096,
    });

    slot.resolveCompletion({
      requestId: slot.requestId,
      finalState: 'COMPLETED',
      renderedPages,
      destTempSearchMsgId: slot.tempSearchingMessageId,
      firstResultAt: slot.firstResultAt,
      completedAt: now,
      processingDurationMs: now - slot.dispatchedAt,
    });
  }

  /**
   * Handles Master Request Timeout (30s) or Stale Temporary Searching Watchdog Timeout (30s/60s).
   * Aborts waiting, marks request as `TIMED_OUT`, logs full admin diagnostics, deducts 0 quota/credits,
   * and records the request ID so any late response is quarantined as `LATE_AFTER_TIMEOUT`.
   */
  private handleRequestTimeout(
    lane: AccountLane,
    requestId: string,
    timeoutReasonCode: 'MASTER_REQUEST_TIMEOUT' | 'STALE_TEMP_SEARCH_MESSAGE_TIMEOUT'
  ): void {
    const slot = this.activeSlots[lane];
    if (!slot || slot.requestId !== requestId) {
      return;
    }

    this.clearSlotTimers(slot);
    const now = Date.now();

    this.lastTimedOutOrDetachedRequest[lane] = {
      requestId: slot.requestId,
      outboundMsgId: slot.outboundGramJsMessageId,
      expiredAt: now,
    };
    this.activeSlots[lane] = null;

    this.configStudio.recordAuditLog(
      0,
      'SYSTEM_WATCHDOG',
      timeoutReasonCode,
      'requests',
      slot.requestId,
      {
        referenceCode: slot.referenceCode,
        intermediaryAccountLane: lane,
        destinationChatId: slot.destinationChatId,
        outboundGramJsMessageId: slot.outboundGramJsMessageId,
        tempSearchingMessageId: slot.tempSearchingMessageId,
        dispatchedAt: slot.dispatchedAt,
        timedOutAt: now,
        durationMs: now - slot.dispatchedAt,
      }
    );

    slot.resolveCompletion({
      requestId: slot.requestId,
      finalState: 'TIMED_OUT',
      errorCode: timeoutReasonCode,
      safeUserNoticeFa:
        '⏱ زمان انتظار برای دریافت پاسخ از سامانه مرجع به پایان رسید.\n✨ هیچ سهمیه یا اعتباری از حساب شما کسر نگردید. لطفاً مجدداً تلاش فرمایید.',
      destTempSearchMsgId: slot.tempSearchingMessageId,
      firstResultAt: slot.firstResultAt,
      completedAt: now,
      processingDurationMs: now - slot.dispatchedAt,
    });
  }

  private clearSlotTimers(slot: ActiveCorrelationSlot): void {
    if (slot.masterTimeoutTimer) {
      clearTimeout(slot.masterTimeoutTimer);
      slot.masterTimeoutTimer = null;
    }
    if (slot.staleSearchWatchdogTimer) {
      clearTimeout(slot.staleSearchWatchdogTimer);
      slot.staleSearchWatchdogTimer = null;
    }
    if (slot.collectionWindowTimer) {
      clearTimeout(slot.collectionWindowTimer);
      slot.collectionWindowTimer = null;
    }
  }

  public quarantinePayload(
    accountLane: AccountLane,
    destMsgId: number | null,
    matchedRequestId: string | null,
    quarantineReason: QuarantineReason,
    rawPayload: string
  ): QuarantinedResponseRecord {
    const quarantineId = crypto.randomUUID();
    const now = Date.now();
    const encrypted = this.cryptoService.encrypt(rawPayload);

    this.db
      .prepare(
        `INSERT INTO quarantined_responses (
          quarantine_id, account_lane, dest_msg_id, matched_request_id, quarantine_reason, raw_payload_encrypted, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        quarantineId,
        accountLane,
        destMsgId,
        matchedRequestId,
        quarantineReason,
        encrypted,
        now
      );

    return {
      quarantineId,
      accountLane,
      destMsgId,
      matchedRequestId,
      quarantineReason,
      createdAt: now,
    };
  }

  public listQuarantinedResponses(
    limit: number = 50,
    decryptPayload: boolean = false
  ): QuarantinedResponseRecord[] {
    const rows = this.db
      .prepare(
        `SELECT quarantine_id, account_lane, dest_msg_id, matched_request_id, quarantine_reason, raw_payload_encrypted, created_at
         FROM quarantined_responses
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(limit) as Array<{
      quarantine_id: string;
      account_lane: AccountLane;
      dest_msg_id: number | null;
      matched_request_id: string | null;
      quarantine_reason: QuarantineReason;
      raw_payload_encrypted: string;
      created_at: number;
    }>;

    return rows.map((r) => {
      let decrypted: string | undefined;
      if (decryptPayload) {
        try {
          decrypted = this.cryptoService.decrypt(r.raw_payload_encrypted);
        } catch {
          decrypted = '[DECRYPTION_FAILED]';
        }
      }
      return {
        quarantineId: r.quarantine_id,
        accountLane: r.account_lane,
        destMsgId: r.dest_msg_id,
        matchedRequestId: r.matched_request_id,
        quarantineReason: r.quarantine_reason,
        rawPayloadDecrypted: decrypted,
        createdAt: r.created_at,
      };
    });
  }
}
