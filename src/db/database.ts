import Database from 'better-sqlite3';

export type AccessRole =
  | 'USER'
  | 'OWNER'
  | 'SUPER_ADMIN'
  | 'OPS_ADMIN'
  | 'FINANCE_ADMIN'
  | 'SUPPORT_ADMIN'
  | 'AUDITOR';

export type AccountLane = 'REAL' | 'TEST';

export type RequestLifecycleState =
  | 'RECEIVED'
  | 'VALIDATING'
  | 'REJECTED'
  | 'AUTHORIZED'
  | 'QUEUED'
  | 'WAITING'
  | 'PROCESSING'
  | 'FORWARDED'
  | 'AWAITING_DESTINATION_RESPONSE'
  | 'RESPONSE_RECEIVED'
  | 'COMPLETED'
  | 'NO_RESULTS_FOUND'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'TEMPORARILY_UNAVAILABLE'
  | 'CANCELLED';

export type QuarantineReason =
  | 'LATE_AFTER_TIMEOUT'
  | 'UNMATCHED_CORRELATION'
  | 'BLOCKED_SECTION_3'
  | 'BLOCKED_SECTION_4_ERROR'
  | 'MASKED_REAL_ACCOUNT_WARNING';

export type MtProtoConnectionStatus =
  | 'DISCONNECTED'
  | 'CONNECTED'
  | 'QUOTA_DEPLETED'
  | 'UNSUBSCRIBED_MASKED'
  | 'UNAUTHORIZED'
  | 'TRIAL_EXPIRED'
  | 'ACCESS_EXPIRED'
  | 'SUPPORT_MODE_LOCKED'
  | 'FLOOD_WAIT';

export type MtProtoAuthStatus =
  | 'UNAUTHENTICATED'
  | 'AWAITING_OTP'
  | 'AWAITING_2FA'
  | 'AUTHENTICATED';

export type CreditTxType =
  | 'PURCHASE'
  | 'DEDUCTION'
  | 'ADMIN_ADJUST'
  | 'SUBSCRIPTION_ZERO_TRIAL';

/**
 * Initializes the SQLite connection on `relay.db` enforcing ADR-01 PRAGMAs
 * and running versioned migrations for all 8 required tables.
 */
export function initializeDatabase(dbPath: string = 'relay.db'): Database.Database {
  const db = new Database(dbPath);

  // ADR-01 Mandatory SQLite PRAGMAs
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  runMigrations(db);
  seedDefaultMtProtoAccountRows(db);

  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const currentVersionRow = db
    .prepare('SELECT MAX(version) as v FROM schema_migrations')
    .get() as { v: number | null } | undefined;
  const currentVersion = currentVersionRow?.v ?? 0;

  if (currentVersion < 1) {
    const applyV1 = db.transaction(() => {
      db.exec(`
        -- 1. users table
        CREATE TABLE IF NOT EXISTS users (
          telegram_id INTEGER PRIMARY KEY,
          username TEXT,
          first_name TEXT,
          access_role TEXT NOT NULL DEFAULT 'USER' CHECK(access_role IN ('USER','OWNER','SUPER_ADMIN','OPS_ADMIN','FINANCE_ADMIN','SUPPORT_ADMIN','AUDITOR')),
          is_banned INTEGER NOT NULL DEFAULT 0 CHECK(is_banned IN (0, 1)),
          subscription_active INTEGER NOT NULL DEFAULT 0 CHECK(subscription_active IN (0, 1)),
          subscription_expires_at INTEGER,
          trial_initial INTEGER NOT NULL DEFAULT 3,
          trial_consumed INTEGER NOT NULL DEFAULT 0,
          trial_remaining INTEGER NOT NULL DEFAULT 3,
          trial_disabled INTEGER NOT NULL DEFAULT 0 CHECK(trial_disabled IN (0, 1)),
          paid_credits INTEGER NOT NULL DEFAULT 0,
          language_code TEXT NOT NULL DEFAULT 'fa' CHECK(language_code IN ('fa', 'en')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_users_role ON users(access_role);
        CREATE INDEX IF NOT EXISTS idx_users_sub ON users(subscription_active, paid_credits);

        -- 2. user_sessions table (5-minute TTL temporary UI state)
        CREATE TABLE IF NOT EXISTS user_sessions (
          telegram_id INTEGER PRIMARY KEY REFERENCES users(telegram_id) ON DELETE CASCADE,
          selected_category TEXT,
          ui_state TEXT NOT NULL DEFAULT 'MAIN_MENU',
          active_menu_message_id INTEGER,
          last_activity_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);

        -- 3. credit_transactions table (Immutable Financial & Trial Zeroing Ledger)
        CREATE TABLE IF NOT EXISTS credit_transactions (
          tx_id TEXT PRIMARY KEY,
          telegram_id INTEGER NOT NULL REFERENCES users(telegram_id) ON DELETE RESTRICT,
          idempotency_key TEXT NOT NULL UNIQUE,
          tx_type TEXT NOT NULL CHECK(tx_type IN ('PURCHASE', 'DEDUCTION', 'ADMIN_ADJUST', 'SUBSCRIPTION_ZERO_TRIAL')),
          amount_delta INTEGER NOT NULL,
          balance_before INTEGER NOT NULL,
          balance_after INTEGER NOT NULL,
          reference_request_id TEXT,
          admin_actor_id INTEGER,
          notes TEXT,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON credit_transactions(telegram_id, created_at DESC);

        -- 4. requests table (18-Step / 16-State Request Lifecycle)
        CREATE TABLE IF NOT EXISTS requests (
          request_id TEXT PRIMARY KEY,
          reference_code TEXT NOT NULL UNIQUE,
          telegram_id INTEGER NOT NULL REFERENCES users(telegram_id) ON DELETE RESTRICT,
          input_category TEXT NOT NULL,
          raw_input_masked TEXT NOT NULL,
          normalized_input_encrypted TEXT NOT NULL,
          account_lane TEXT NOT NULL CHECK(account_lane IN ('REAL', 'TEST')),
          state TEXT NOT NULL CHECK(state IN (
            'RECEIVED',
            'VALIDATING',
            'REJECTED',
            'AUTHORIZED',
            'QUEUED',
            'WAITING',
            'PROCESSING',
            'FORWARDED',
            'AWAITING_DESTINATION_RESPONSE',
            'RESPONSE_RECEIVED',
            'COMPLETED',
            'NO_RESULTS_FOUND',
            'FAILED',
            'TIMED_OUT',
            'TEMPORARILY_UNAVAILABLE',
            'CANCELLED'
          )),
          queue_position_initial INTEGER NOT NULL DEFAULT 0,
          user_message_id INTEGER,
          bot_status_message_id INTEGER,
          dest_chat_id TEXT,
          dest_outbound_msg_id INTEGER,
          dest_temp_search_msg_id INTEGER,
          first_result_at INTEGER,
          completed_at INTEGER,
          processing_duration_ms INTEGER,
          error_code TEXT,
          quota_or_credit_deducted INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_requests_lane_state_created ON requests(account_lane, state, created_at ASC);
        CREATE INDEX IF NOT EXISTS idx_requests_user_state ON requests(telegram_id, state);

        -- 5. quarantined_responses table (Late, Unmatched, Section 3/4 Blocked Payloads)
        CREATE TABLE IF NOT EXISTS quarantined_responses (
          quarantine_id TEXT PRIMARY KEY,
          account_lane TEXT NOT NULL CHECK(account_lane IN ('REAL', 'TEST')),
          dest_msg_id INTEGER,
          matched_request_id TEXT,
          quarantine_reason TEXT NOT NULL CHECK(quarantine_reason IN (
            'LATE_AFTER_TIMEOUT',
            'UNMATCHED_CORRELATION',
            'BLOCKED_SECTION_3',
            'BLOCKED_SECTION_4_ERROR',
            'MASKED_REAL_ACCOUNT_WARNING'
          )),
          raw_payload_encrypted TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_quarantine_created ON quarantined_responses(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_quarantine_req ON quarantined_responses(matched_request_id);

        -- 6. mtproto_accounts table (Strict Dual-Account Isolation: 'REAL' | 'TEST')
        CREATE TABLE IF NOT EXISTS mtproto_accounts (
          account_id TEXT PRIMARY KEY CHECK(account_id IN ('REAL', 'TEST')),
          api_id INTEGER,
          api_hash_encrypted TEXT,
          phone_masked TEXT,
          session_string_encrypted TEXT,
          connection_status TEXT NOT NULL DEFAULT 'DISCONNECTED',
          auth_status TEXT NOT NULL DEFAULT 'UNAUTHENTICATED',
          dest_quota_remaining INTEGER,
          dest_expiry_days INTEGER,
          flood_wait_until INTEGER,
          last_connected_at INTEGER,
          updated_at INTEGER NOT NULL
        );

        -- 7. config_versions table (Immutable Versioned Configuration Studio Snapshots)
        CREATE TABLE IF NOT EXISTS config_versions (
          version_id INTEGER PRIMARY KEY AUTOINCREMENT,
          version_number INTEGER NOT NULL UNIQUE,
          config_json TEXT NOT NULL,
          changed_by_admin_id INTEGER NOT NULL,
          change_reason TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0, 1)),
          created_at INTEGER NOT NULL
        );

        -- 8. audit_logs table (Tamper-Evident Administrative Audit Trail)
        CREATE TABLE IF NOT EXISTS audit_logs (
          audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_id INTEGER NOT NULL,
          actor_role TEXT NOT NULL,
          action_type TEXT NOT NULL,
          target_entity TEXT NOT NULL,
          target_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          prev_hash TEXT NOT NULL,
          entry_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
      `);

      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        1,
        Date.now()
      );
    });

    applyV1.immediate();
  }
}

function seedDefaultMtProtoAccountRows(db: Database.Database): void {
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO mtproto_accounts (
      account_id, connection_status, auth_status, updated_at
    ) VALUES (?, 'DISCONNECTED', 'UNAUTHENTICATED', ?)
  `);
  stmt.run('REAL', now);
  stmt.run('TEST', now);
}
