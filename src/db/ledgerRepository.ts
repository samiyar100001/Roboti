import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  AccessRole,
  AccountLane,
  CreditTxType,
  RequestLifecycleState,
} from './database';
import type { ConfigStudioService } from './configStudio';

export interface UserRecord {
  telegramId: number;
  username: string | null;
  firstName: string | null;
  accessRole: AccessRole;
  isBanned: boolean;
  subscriptionActive: boolean;
  subscriptionExpiresAt: number | null;
  trialInitial: number;
  trialConsumed: number;
  trialRemaining: number;
  trialDisabled: boolean;
  paidCredits: number;
  languageCode: 'fa' | 'en';
  createdAt: number;
  updatedAt: number;
}

export interface EligibilityDecision {
  eligible: boolean;
  lane?: AccountLane;
  reasonCode?:
    | 'USER_BANNED'
    | 'ACCESS_POLICY_DENIED'
    | 'ACTIVE_REQUEST_CAP_REACHED'
    | 'NO_QUOTA_OR_CREDITS';
  user: UserRecord;
}

export interface CreditTransactionRecord {
  txId: string;
  telegramId: number;
  idempotencyKey: string;
  txType: CreditTxType;
  amountDelta: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceRequestId: string | null;
  adminActorId: number | null;
  notes: string | null;
  createdAt: number;
}

export class LedgerRepository {
  private readonly db: Database.Database;
  private readonly configStudio: ConfigStudioService;
  private readonly ownerTelegramId: number;

  constructor(
    db: Database.Database,
    configStudio: ConfigStudioService,
    ownerTelegramId: number = 0
  ) {
    this.db = db;
    this.configStudio = configStudio;
    this.ownerTelegramId = ownerTelegramId;
  }

  public getOrCreateUser(
    telegramId: number,
    username?: string | null,
    firstName?: string | null
  ): UserRecord {
    const tx = this.db.transaction((): UserRecord => {
      const existing = this.getUserByIdInternal(telegramId);
      const now = Date.now();
      const defaultRole: AccessRole =
        this.ownerTelegramId > 0 && telegramId === this.ownerTelegramId ? 'OWNER' : 'USER';

      if (existing) {
        const nextRole =
          existing.accessRole === 'USER' && defaultRole === 'OWNER'
            ? 'OWNER'
            : existing.accessRole;
        this.db
          .prepare(
            `UPDATE users
             SET username = COALESCE(?, username),
                 first_name = COALESCE(?, first_name),
                 access_role = ?,
                 updated_at = ?
             WHERE telegram_id = ?`
          )
          .run(username ?? null, firstName ?? null, nextRole, now, telegramId);
        return this.getUserByIdInternal(telegramId)!;
      }

      this.db
        .prepare(
          `INSERT INTO users (
            telegram_id, username, first_name, access_role, is_banned,
            subscription_active, subscription_expires_at,
            trial_initial, trial_consumed, trial_remaining, trial_disabled,
            paid_credits, language_code, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 0, 0, NULL, 3, 0, 3, 0, 0, 'fa', ?, ?)`
        )
        .run(telegramId, username ?? null, firstName ?? null, defaultRole, now, now);

      return this.getUserByIdInternal(telegramId)!;
    });

    return tx.immediate();
  }

  public getUserById(telegramId: number): UserRecord | null {
    return this.getUserByIdInternal(telegramId);
  }

  private getUserByIdInternal(telegramId: number): UserRecord | null {
    const row = this.db
      .prepare('SELECT * FROM users WHERE telegram_id = ?')
      .get(telegramId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapUserRow(row);
  }

  private mapUserRow(row: Record<string, unknown>): UserRecord {
    return {
      telegramId: Number(row.telegram_id),
      username: (row.username as string | null) ?? null,
      firstName: (row.first_name as string | null) ?? null,
      accessRole: row.access_role as AccessRole,
      isBanned: Number(row.is_banned) === 1,
      subscriptionActive: Number(row.subscription_active) === 1,
      subscriptionExpiresAt:
        row.subscription_expires_at !== null && row.subscription_expires_at !== undefined
          ? Number(row.subscription_expires_at)
          : null,
      trialInitial: Number(row.trial_initial),
      trialConsumed: Number(row.trial_consumed),
      trialRemaining: Number(row.trial_remaining),
      trialDisabled: Number(row.trial_disabled) === 1,
      paidCredits: Number(row.paid_credits),
      languageCode: (row.language_code as 'fa' | 'en') ?? 'fa',
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  public evaluateUserEligibility(telegramId: number): EligibilityDecision {
    const user = this.getOrCreateUser(telegramId);
    const config = this.configStudio.getConfig();

    if (user.isBanned) {
      return { eligible: false, reasonCode: 'USER_BANNED', user };
    }

    const isAdminOrOwner = user.accessRole !== 'USER';

    if (config.accessPolicy === 'OWNER_ONLY' && !isAdminOrOwner) {
      return { eligible: false, reasonCode: 'ACCESS_POLICY_DENIED', user };
    }

    const now = Date.now();
    const hasActiveSub =
      user.subscriptionActive &&
      (user.subscriptionExpiresAt === null || user.subscriptionExpiresAt > now);

    if (
      config.accessPolicy === 'APPROVED_CUSTOMERS_ONLY' &&
      !isAdminOrOwner &&
      !hasActiveSub &&
      user.paidCredits <= 0
    ) {
      return { eligible: false, reasonCode: 'ACCESS_POLICY_DENIED', user };
    }

    const activeCountRow = this.db
      .prepare(
        `SELECT COUNT(*) as cnt FROM requests
         WHERE telegram_id = ?
           AND state IN ('RECEIVED','VALIDATING','AUTHORIZED','QUEUED','WAITING','PROCESSING','FORWARDED','AWAITING_DESTINATION_RESPONSE','RESPONSE_RECEIVED')`
      )
      .get(telegramId) as { cnt: number };

    if (activeCountRow.cnt >= config.maxActiveRequestsPerUser) {
      return { eligible: false, reasonCode: 'ACTIVE_REQUEST_CAP_REACHED', user };
    }

    if (hasActiveSub || user.paidCredits > 0) {
      return { eligible: true, lane: 'REAL', user };
    }

    if (!user.trialDisabled && user.trialRemaining > 0) {
      return { eligible: true, lane: 'TEST', user };
    }

    return { eligible: false, reasonCode: 'NO_QUOTA_OR_CREDITS', user };
  }

  public settleRequestAccounting(
    requestId: string,
    telegramId: number,
    accountLane: AccountLane,
    finalState: RequestLifecycleState
  ): { deducted: number; alreadySettled: boolean } {
    const tx = this.db.transaction((): { deducted: number; alreadySettled: boolean } => {
      const existingTx = this.db
        .prepare('SELECT tx_id FROM credit_transactions WHERE idempotency_key = ?')
        .get(requestId) as { tx_id: string } | undefined;

      if (existingTx) {
        return { deducted: 0, alreadySettled: true };
      }

      if (finalState !== 'COMPLETED') {
        this.db
          .prepare('UPDATE requests SET quota_or_credit_deducted = 0 WHERE request_id = ?')
          .run(requestId);
        return { deducted: 0, alreadySettled: false };
      }

      const user = this.getUserByIdInternal(telegramId);
      if (!user) {
        throw new Error(`User ${telegramId} not found during accounting settlement.`);
      }

      const now = Date.now();

      if (accountLane === 'TEST') {
        const before = user.trialRemaining;
        const deducted = before > 0 ? 1 : 0;
        const after = Math.max(0, before - deducted);

        this.db
          .prepare(
            `UPDATE users
             SET trial_consumed = trial_consumed + ?,
                 trial_remaining = ?,
                 updated_at = ?
             WHERE telegram_id = ?`
          )
          .run(deducted, after, now, telegramId);

        this.db
          .prepare(
            `INSERT INTO credit_transactions (
              tx_id, telegram_id, idempotency_key, tx_type, amount_delta,
              balance_before, balance_after, reference_request_id, admin_actor_id, notes, created_at
            ) VALUES (?, ?, ?, 'DEDUCTION', ?, ?, ?, ?, NULL, 'Trial quota deduction on COMPLETED search', ?)`
          )
          .run(
            crypto.randomUUID(),
            telegramId,
            requestId,
            -deducted,
            before,
            after,
            requestId,
            now
          );

        this.db
          .prepare('UPDATE requests SET quota_or_credit_deducted = ? WHERE request_id = ?')
          .run(deducted, requestId);

        return { deducted, alreadySettled: false };
      } else {
        const before = user.paidCredits;
        const deducted = before > 0 ? 1 : 0;
        const after = Math.max(0, before - deducted);

        if (deducted > 0) {
          this.db
            .prepare('UPDATE users SET paid_credits = ?, updated_at = ? WHERE telegram_id = ?')
            .run(after, now, telegramId);
        }

        this.db
          .prepare(
            `INSERT INTO credit_transactions (
              tx_id, telegram_id, idempotency_key, tx_type, amount_delta,
              balance_before, balance_after, reference_request_id, admin_actor_id, notes, created_at
            ) VALUES (?, ?, ?, 'DEDUCTION', ?, ?, ?, ?, NULL, 'Paid credit deduction on COMPLETED Real search', ?)`
          )
          .run(
            crypto.randomUUID(),
            telegramId,
            requestId,
            -deducted,
            before,
            after,
            requestId,
            now
          );

        this.db
          .prepare('UPDATE requests SET quota_or_credit_deducted = ? WHERE request_id = ?')
          .run(deducted, requestId);

        return { deducted, alreadySettled: false };
      }
    });

    return tx.immediate();
  }

  public activateSubscriptionAndAddCredits(params: {
    telegramId: number;
    creditsToAdd: number;
    subscriptionDays?: number;
    idempotencyKey: string;
    adminActorId?: number;
    adminRole?: AccessRole;
    reason: string;
  }): UserRecord {
    const tx = this.db.transaction((): UserRecord => {
      const user = this.getOrCreateUser(params.telegramId);
      const now = Date.now();

      if (user.trialRemaining > 0 || !user.trialDisabled) {
        const trialBefore = user.trialRemaining;
        this.db
          .prepare(
            `UPDATE users
             SET trial_remaining = 0,
                 trial_disabled = 1,
                 updated_at = ?
             WHERE telegram_id = ?`
          )
          .run(now, params.telegramId);

        this.db
          .prepare(
            `INSERT OR IGNORE INTO credit_transactions (
              tx_id, telegram_id, idempotency_key, tx_type, amount_delta,
              balance_before, balance_after, reference_request_id, admin_actor_id, notes, created_at
            ) VALUES (?, ?, ?, 'SUBSCRIPTION_ZERO_TRIAL', ?, ?, 0, NULL, ?, ?, ?)`
          )
          .run(
            crypto.randomUUID(),
            params.telegramId,
            `${params.idempotencyKey}:zero_trial`,
            -trialBefore,
            trialBefore,
            params.adminActorId ?? null,
            `Trial zeroed on subscription activation: ${params.reason}`,
            now
          );
      }

      const creditsBefore = user.paidCredits;
      const creditsAfter = creditsBefore + params.creditsToAdd;
      const expiresAt =
        params.subscriptionDays && params.subscriptionDays > 0
          ? now + params.subscriptionDays * 86_400_000
          : user.subscriptionExpiresAt;

      this.db
        .prepare(
          `UPDATE users
           SET subscription_active = 1,
               subscription_expires_at = ?,
               paid_credits = ?,
               trial_remaining = 0,
               trial_disabled = 1,
               updated_at = ?
           WHERE telegram_id = ?`
        )
        .run(expiresAt, creditsAfter, now, params.telegramId);

      if (params.creditsToAdd !== 0) {
        this.db
          .prepare(
            `INSERT INTO credit_transactions (
              tx_id, telegram_id, idempotency_key, tx_type, amount_delta,
              balance_before, balance_after, reference_request_id, admin_actor_id, notes, created_at
            ) VALUES (?, ?, ?, 'PURCHASE', ?, ?, ?, NULL, ?, ?, ?)`
          )
          .run(
            crypto.randomUUID(),
            params.telegramId,
            params.idempotencyKey,
            params.creditsToAdd,
            creditsBefore,
            creditsAfter,
            params.adminActorId ?? null,
            params.reason,
            now
          );
      }

      if (params.adminActorId !== undefined) {
        this.configStudio.recordAuditLog(
          params.adminActorId,
          params.adminRole ?? 'FINANCE_ADMIN',
          'SUBSCRIPTION_ACTIVATE',
          'users',
          String(params.telegramId),
          {
            creditsAdded: params.creditsToAdd,
            subscriptionDays: params.subscriptionDays ?? null,
            trialZeroedFrom: user.trialRemaining,
            reason: params.reason,
          }
        );
      }

      return this.getUserByIdInternal(params.telegramId)!;
    });

    return tx.immediate();
  }

  public adminAdjustUserBalance(params: {
    telegramId: number;
    paidCreditsDelta?: number;
    trialRemainingSet?: number;
    revokeSubscription?: boolean;
    banUser?: boolean;
    roleSet?: AccessRole;
    adminActorId: number;
    adminRole: AccessRole;
    reason: string;
  }): UserRecord {
    if (!params.reason || params.reason.trim().length < 3) {
      throw new Error('Mandatory reason (min 3 characters) required for user adjustment.');
    }

    const tx = this.db.transaction((): UserRecord => {
      const user = this.getOrCreateUser(params.telegramId);
      const now = Date.now();

      let nextPaidCredits = user.paidCredits;
      if (typeof params.paidCreditsDelta === 'number' && params.paidCreditsDelta !== 0) {
        nextPaidCredits = Math.max(0, user.paidCredits + params.paidCreditsDelta);
        this.db
          .prepare(
            `INSERT INTO credit_transactions (
              tx_id, telegram_id, idempotency_key, tx_type, amount_delta,
              balance_before, balance_after, reference_request_id, admin_actor_id, notes, created_at
            ) VALUES (?, ?, ?, 'ADMIN_ADJUST', ?, ?, ?, NULL, ?, ?, ?)`
          )
          .run(
            crypto.randomUUID(),
            params.telegramId,
            `admin_adj_${params.telegramId}_${now}_${crypto.randomBytes(4).toString('hex')}`,
            nextPaidCredits - user.paidCredits,
            user.paidCredits,
            nextPaidCredits,
            params.adminActorId,
            params.reason.trim(),
            now
          );
      }

      const nextTrialRemaining =
        typeof params.trialRemainingSet === 'number'
          ? Math.max(0, params.trialRemainingSet)
          : user.trialRemaining;

      const nextSubActive = params.revokeSubscription ? 0 : user.subscriptionActive ? 1 : 0;
      const nextIsBanned =
        typeof params.banUser === 'boolean' ? (params.banUser ? 1 : 0) : user.isBanned ? 1 : 0;
      const nextRole = params.roleSet ?? user.accessRole;

      this.db
        .prepare(
          `UPDATE users
           SET paid_credits = ?,
               trial_remaining = ?,
               subscription_active = ?,
               is_banned = ?,
               access_role = ?,
               updated_at = ?
           WHERE telegram_id = ?`
        )
        .run(
          nextPaidCredits,
          nextTrialRemaining,
          nextSubActive,
          nextIsBanned,
          nextRole,
          now,
          params.telegramId
        );

      this.configStudio.recordAuditLog(
        params.adminActorId,
        params.adminRole,
        'USER_BALANCE_OR_STATUS_ADJUST',
        'users',
        String(params.telegramId),
        {
          paidCreditsBefore: user.paidCredits,
          paidCreditsAfter: nextPaidCredits,
          trialBefore: user.trialRemaining,
          trialAfter: nextTrialRemaining,
          subscriptionActiveAfter: nextSubActive === 1,
          isBannedAfter: nextIsBanned === 1,
          roleAfter: nextRole,
          reason: params.reason.trim(),
        }
      );

      return this.getUserByIdInternal(params.telegramId)!;
    });

    return tx.immediate();
  }

  public setUserLanguage(telegramId: number, languageCode: 'fa' | 'en'): void {
    this.db
      .prepare('UPDATE users SET language_code = ?, updated_at = ? WHERE telegram_id = ?')
      .run(languageCode, Date.now(), telegramId);
  }

  public listUsers(searchQuery?: string, limit: number = 50): UserRecord[] {
    if (searchQuery && searchQuery.trim().length > 0) {
      const q = `%${searchQuery.trim()}%`;
      const rows = this.db
        .prepare(
          `SELECT * FROM users
           WHERE CAST(telegram_id AS TEXT) LIKE ?
              OR username LIKE ?
              OR first_name LIKE ?
           ORDER BY updated_at DESC
           LIMIT ?`
        )
        .all(q, q, q, limit) as Array<Record<string, unknown>>;
      return rows.map((r) => this.mapUserRow(r));
    }
    const rows = this.db
      .prepare('SELECT * FROM users ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapUserRow(r));
  }

  public listCreditTransactions(telegramId?: number, limit: number = 50): CreditTransactionRecord[] {
    const rows = (
      telegramId
        ? this.db
            .prepare(
              'SELECT * FROM credit_transactions WHERE telegram_id = ? ORDER BY created_at DESC LIMIT ?'
            )
            .all(telegramId, limit)
        : this.db
            .prepare('SELECT * FROM credit_transactions ORDER BY created_at DESC LIMIT ?')
            .all(limit)
    ) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      txId: String(r.tx_id),
      telegramId: Number(r.telegram_id),
      idempotencyKey: String(r.idempotency_key),
      txType: r.tx_type as CreditTxType,
      amountDelta: Number(r.amount_delta),
      balanceBefore: Number(r.balance_before),
      balanceAfter: Number(r.balance_after),
      referenceRequestId: (r.reference_request_id as string | null) ?? null,
      adminActorId:
        r.admin_actor_id !== null && r.admin_actor_id !== undefined
          ? Number(r.admin_actor_id)
          : null,
      notes: (r.notes as string | null) ?? null,
      createdAt: Number(r.created_at),
    }));
  }
}
