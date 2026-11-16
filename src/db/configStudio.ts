import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { AccessRole } from './database';

export const SystemConfigSchema = z.object({
  accessPolicy: z
    .enum(['OWNER_ONLY', 'APPROVED_CUSTOMERS_ONLY', 'PUBLIC_ACCESS'])
    .default('PUBLIC_ACCESS'),
  maxQueueSize: z.number().int().min(10).max(10000).default(1000),
  maxActiveRequestsPerUser: z.number().int().min(1).max(10).default(1),
  requestTimeoutSeconds: z.number().int().min(10).max(120).default(30),
  destinationStaleSearchTimeoutSeconds: z.number().int().min(10).max(60).default(30),
  collectionWindowMs: z.number().int().min(1000).max(15000).default(5000),
  uiSessionTtlMs: z.number().int().min(60000).max(3600000).default(300000),
  enableNationalIdChecksum: z.boolean().default(true),
  telegramIdValidationPolicy: z
    .enum(['MODERN_10_DIGIT_MAX', 'LEGACY_9_DIGIT_MAX'])
    .default('MODERN_10_DIGIT_MAX'),
  enableBankCardLuhn: z.boolean().default(true),
  strictLegacyIpv4: z.boolean().default(false),
  destinationBotUsername: z.string().min(3).max(64).default('ReferenceTargetBot'),
  queuePaused: z.boolean().default(false),
  whiteLabelHeaderTitle: z.string().min(3).max(200).default('💠 گزارش جامع استعلام سامانه'),
  whiteLabelFooterText: z
    .string()
    .min(3)
    .max(200)
    .default('پردازش شده توسط هسته تحلیلی اختصاصی'),
  trialWatermarkText: z
    .string()
    .min(3)
    .max(300)
    .default(
      '⚠️ نسخه آزمایشی (رایگان) — جهت دریافت گزارشهای کامل و نامحدود اشتراک تهیه فرمایید'
    ),
  customDatabaseTitles: z.record(z.string(), z.string()).default({}),
});

export type SystemConfig = z.infer<typeof SystemConfigSchema>;

export interface ConfigVersionRecord {
  versionId: number;
  versionNumber: number;
  config: SystemConfig;
  changedByAdminId: number;
  changeReason: string;
  isActive: boolean;
  createdAt: number;
}

export interface AuditLogRecord {
  auditId: number;
  actorId: number;
  actorRole: string;
  actionType: string;
  targetEntity: string;
  targetId: string;
  payloadJson: string;
  prevHash: string;
  entryHash: string;
  createdAt: number;
}

export class ConfigStudioService {
  private readonly db: Database.Database;
  private cachedConfig: SystemConfig | null = null;

  constructor(db: Database.Database, initialDestBotUsername?: string) {
    this.db = db;
    this.ensureInitialVersion(initialDestBotUsername);
  }

  private ensureInitialVersion(initialDestBotUsername?: string): void {
    const existing = this.db
      .prepare('SELECT version_id, config_json FROM config_versions WHERE is_active = 1 LIMIT 1')
      .get() as { version_id: number; config_json: string } | undefined;

    if (!existing) {
      const defaultConfig = SystemConfigSchema.parse({
        ...(initialDestBotUsername ? { destinationBotUsername: initialDestBotUsername } : {}),
      });
      const tx = this.db.transaction(() => {
        this.db.prepare('UPDATE config_versions SET is_active = 0').run();
        this.db
          .prepare(
            `INSERT INTO config_versions (
              version_number, config_json, changed_by_admin_id, change_reason, is_active, created_at
            ) VALUES (1, ?, 0, 'Initial bootstrap configuration', 1, ?)`
          )
          .run(JSON.stringify(defaultConfig), Date.now());
      });
      tx.immediate();
      this.cachedConfig = defaultConfig;
    } else {
      this.cachedConfig = SystemConfigSchema.parse(JSON.parse(existing.config_json));
    }
  }

  public getConfig(): SystemConfig {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }
    const row = this.db
      .prepare('SELECT config_json FROM config_versions WHERE is_active = 1 LIMIT 1')
      .get() as { config_json: string } | undefined;

    if (!row) {
      const fallback = SystemConfigSchema.parse({});
      this.cachedConfig = fallback;
      return fallback;
    }
    const parsed = SystemConfigSchema.parse(JSON.parse(row.config_json));
    this.cachedConfig = parsed;
    return parsed;
  }

  public updateConfig(
    partialUpdate: Partial<SystemConfig>,
    adminActorId: number,
    adminRole: AccessRole,
    reason: string
  ): ConfigVersionRecord {
    if (!reason || reason.trim().length < 3) {
      throw new Error('Mandatory change reason (min 3 chars) is required for config updates.');
    }

    const current = this.getConfig();
    const merged = SystemConfigSchema.parse({
      ...current,
      ...partialUpdate,
    });

    const tx = this.db.transaction((): ConfigVersionRecord => {
      const maxRow = this.db
        .prepare('SELECT MAX(version_number) as maxVer FROM config_versions')
        .get() as { maxVer: number | null };
      const nextVersion = (maxRow?.maxVer ?? 0) + 1;
      const now = Date.now();

      this.db.prepare('UPDATE config_versions SET is_active = 0').run();
      const info = this.db
        .prepare(
          `INSERT INTO config_versions (
            version_number, config_json, changed_by_admin_id, change_reason, is_active, created_at
          ) VALUES (?, ?, ?, ?, 1, ?)`
        )
        .run(nextVersion, JSON.stringify(merged), adminActorId, reason.trim(), now);

      this.appendAuditLogInternal(
        adminActorId,
        adminRole,
        'CONFIG_UPDATE',
        'config_versions',
        String(nextVersion),
        { reason: reason.trim(), updatedKeys: Object.keys(partialUpdate) },
        now
      );

      this.cachedConfig = merged;

      return {
        versionId: Number(info.lastInsertRowid),
        versionNumber: nextVersion,
        config: merged,
        changedByAdminId: adminActorId,
        changeReason: reason.trim(),
        isActive: true,
        createdAt: now,
      };
    });

    return tx.immediate();
  }

  public rollbackToVersion(
    targetVersionNumber: number,
    adminActorId: number,
    adminRole: AccessRole,
    reason: string
  ): ConfigVersionRecord {
    const targetRow = this.db
      .prepare('SELECT config_json FROM config_versions WHERE version_number = ?')
      .get(targetVersionNumber) as { config_json: string } | undefined;

    if (!targetRow) {
      throw new Error(`Configuration version #${targetVersionNumber} does not exist.`);
    }

    const restoredConfig = SystemConfigSchema.parse(JSON.parse(targetRow.config_json));
    return this.updateConfig(
      restoredConfig,
      adminActorId,
      adminRole,
      `Rollback to v${targetVersionNumber}: ${reason.trim() || 'Admin rollback'}`
    );
  }

  public listVersionHistory(limit: number = 25): ConfigVersionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT version_id, version_number, config_json, changed_by_admin_id, change_reason, is_active, created_at
         FROM config_versions
         ORDER BY version_number DESC
         LIMIT ?`
      )
      .all(limit) as Array<{
      version_id: number;
      version_number: number;
      config_json: string;
      changed_by_admin_id: number;
      change_reason: string;
      is_active: number;
      created_at: number;
    }>;

    return rows.map((r) => ({
      versionId: r.version_id,
      versionNumber: r.version_number,
      config: SystemConfigSchema.parse(JSON.parse(r.config_json)),
      changedByAdminId: r.changed_by_admin_id,
      changeReason: r.change_reason,
      isActive: r.is_active === 1,
      createdAt: r.created_at,
    }));
  }

  public recordAuditLog(
    actorId: number,
    actorRole: string,
    actionType: string,
    targetEntity: string,
    targetId: string,
    payload: Record<string, unknown>
  ): void {
    const tx = this.db.transaction(() => {
      this.appendAuditLogInternal(
        actorId,
        actorRole,
        actionType,
        targetEntity,
        targetId,
        payload,
        Date.now()
      );
    });
    tx.immediate();
  }

  private appendAuditLogInternal(
    actorId: number,
    actorRole: string,
    actionType: string,
    targetEntity: string,
    targetId: string,
    payload: Record<string, unknown>,
    now: number
  ): void {
    const lastRow = this.db
      .prepare('SELECT entry_hash FROM audit_logs ORDER BY audit_id DESC LIMIT 1')
      .get() as { entry_hash: string } | undefined;

    const prevHash = lastRow?.entry_hash ?? 'GENESIS_00000000000000000000000000000000';
    const payloadJson = JSON.stringify(payload);
    const entryHash = crypto
      .createHash('sha256')
      .update(`${prevHash}|${actorId}|${actorRole}|${actionType}|${targetEntity}|${targetId}|${payloadJson}|${now}`)
      .digest('hex');

    this.db
      .prepare(
        `INSERT INTO audit_logs (
          actor_id, actor_role, action_type, target_entity, target_id, payload_json, prev_hash, entry_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        actorId,
        actorRole,
        actionType,
        targetEntity,
        targetId,
        payloadJson,
        prevHash,
        entryHash,
        now
      );
  }

  public listAuditLogs(limit: number = 50): AuditLogRecord[] {
    const rows = this.db
      .prepare(
        `SELECT audit_id, actor_id, actor_role, action_type, target_entity, target_id, payload_json, prev_hash, entry_hash, created_at
         FROM audit_logs
         ORDER BY audit_id DESC
         LIMIT ?`
      )
      .all(limit) as Array<{
      audit_id: number;
      actor_id: number;
      actor_role: string;
      action_type: string;
      target_entity: string;
      target_id: string;
      payload_json: string;
      prev_hash: string;
      entry_hash: string;
      created_at: number;
    }>;

    return rows.map((r) => ({
      auditId: r.audit_id,
      actorId: r.actor_id,
      actorRole: r.actor_role,
      actionType: r.action_type,
      targetEntity: r.target_entity,
      targetId: r.target_id,
      payloadJson: r.payload_json,
      prevHash: r.prev_hash,
      entryHash: r.entry_hash,
      createdAt: r.created_at,
    }));
  }
}
