import crypto from 'node:crypto';

export interface SecretCheckItem {
  key:
    | 'BOT_TOKEN'
    | 'REAL_API_ID'
    | 'REAL_API_HASH'
    | 'TEST_API_ID'
    | 'TEST_API_HASH'
    | 'MASTER_ENCRYPTION_KEY'
    | 'ADMIN_JWT_SECRET';
  present: boolean;
  validFormat: boolean;
  description: string;
}

export interface AppEnvironment {
  nodeEnv: 'development' | 'production' | 'test';
  sqliteDbPath: string;
  botToken: string;
  ownerTelegramId: number;
  realApiId: number;
  realApiHash: string;
  testApiId: number;
  testApiHash: string;
  destinationBotUsername: string;
  masterEncryptionKey: string;
  adminJwtSecret: string;
  adminServerPort: number;
  adminServerHost: string;
}

/**
 * Loads environment variables with safe fallback defaults for isolated testing
 * while providing a strict Secrets Checklist validator for the Admin Dashboard.
 */
export function loadEnvironment(overrides?: Partial<Record<string, string>>): AppEnvironment {
  const env = { ...process.env, ...(overrides ?? {}) };

  const nodeEnvRaw = (env.NODE_ENV ?? 'development').toLowerCase();
  const nodeEnv: 'development' | 'production' | 'test' =
    nodeEnvRaw === 'production'
      ? 'production'
      : nodeEnvRaw === 'test'
        ? 'test'
        : 'development';

  const sqliteDbPath = env.SQLITE_DB_PATH?.trim() || 'relay.db';
  const botToken = env.BOT_TOKEN?.trim() || '';
  const ownerTelegramId = Number.parseInt(env.OWNER_TELEGRAM_ID ?? '0', 10) || 0;

  const realApiId = Number.parseInt(env.REAL_API_ID ?? '0', 10) || 0;
  const realApiHash = env.REAL_API_HASH?.trim() || '';

  const testApiId = Number.parseInt(env.TEST_API_ID ?? '0', 10) || 0;
  const testApiHash = env.TEST_API_HASH?.trim() || '';

  const destinationBotUsername =
    env.DESTINATION_BOT_USERNAME?.trim().replace(/^@/, '') || 'ReferenceTargetBot';

  const masterEncryptionKey =
    env.MASTER_ENCRYPTION_KEY?.trim() ||
    crypto.createHash('sha256').update('ephemeral-dev-only-key-do-not-use-in-prod').digest('hex');

  const adminJwtSecret =
    env.ADMIN_JWT_SECRET?.trim() ||
    crypto.createHash('sha256').update('ephemeral-dev-admin-jwt-secret').digest('hex');

  const adminServerPort = Number.parseInt(env.ADMIN_PORT ?? '3000', 10) || 3000;
  const adminServerHost = env.ADMIN_HOST?.trim() || '0.0.0.0';

  return {
    nodeEnv,
    sqliteDbPath,
    botToken,
    ownerTelegramId,
    realApiId,
    realApiHash,
    testApiId,
    testApiHash,
    destinationBotUsername,
    masterEncryptionKey,
    adminJwtSecret,
    adminServerPort,
    adminServerHost,
  };
}

/**
 * Verifies presence and structural validity of required secrets without EVER
 * exposing raw secret values in API responses, logs, or the Admin UI.
 */
export function evaluateSecretsChecklist(
  rawEnv: NodeJS.ProcessEnv = process.env
): {
  allRequiredValid: boolean;
  items: SecretCheckItem[];
} {
  const botToken = rawEnv.BOT_TOKEN?.trim() ?? '';
  const realApiId = rawEnv.REAL_API_ID?.trim() ?? '';
  const realApiHash = rawEnv.REAL_API_HASH?.trim() ?? '';
  const testApiId = rawEnv.TEST_API_ID?.trim() ?? '';
  const testApiHash = rawEnv.TEST_API_HASH?.trim() ?? '';
  const masterKey = rawEnv.MASTER_ENCRYPTION_KEY?.trim() ?? '';
  const adminSecret = rawEnv.ADMIN_JWT_SECRET?.trim() ?? '';

  const items: SecretCheckItem[] = [
    {
      key: 'BOT_TOKEN',
      present: botToken.length > 0,
      validFormat: /^\d{6,12}:[A-Za-z0-9_-]{30,50}$/.test(botToken),
      description: 'Primary Telegram Bot API Token (from @BotFather)',
    },
    {
      key: 'REAL_API_ID',
      present: realApiId.length > 0,
      validFormat: /^\d{4,12}$/.test(realApiId) && Number(realApiId) > 0,
      description: 'Telegram MTProto API_ID for Subscribed/Paid Real Account',
    },
    {
      key: 'REAL_API_HASH',
      present: realApiHash.length > 0,
      validFormat: /^[a-fA-F0-9]{32}$/.test(realApiHash),
      description: 'Telegram MTProto 32-char hex API_HASH for Real Account',
    },
    {
      key: 'TEST_API_ID',
      present: testApiId.length > 0,
      validFormat: /^\d{4,12}$/.test(testApiId) && Number(testApiId) > 0 && testApiId !== realApiId,
      description: 'Telegram MTProto API_ID for Free Trial Test Account (Isolated)',
    },
    {
      key: 'TEST_API_HASH',
      present: testApiHash.length > 0,
      validFormat: /^[a-fA-F0-9]{32}$/.test(testApiHash) && testApiHash !== realApiHash,
      description: 'Telegram MTProto 32-char hex API_HASH for Test Account (Isolated)',
    },
    {
      key: 'MASTER_ENCRYPTION_KEY',
      present: masterKey.length > 0,
      validFormat: /^[a-fA-F0-9]{64}$/.test(masterKey) || masterKey.length >= 32,
      description: 'AES-256-GCM Master Key (64-char hex or >=32 char high-entropy secret)',
    },
    {
      key: 'ADMIN_JWT_SECRET',
      present: adminSecret.length > 0,
      validFormat: adminSecret.length >= 32,
      description: 'Admin Web Dashboard Authentication & Signing Secret (>=32 chars)',
    },
  ];

  const allRequiredValid = items.every((item) => item.present && item.validFormat);
  return { allRequiredValid, items };
}
