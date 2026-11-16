import type Database from 'better-sqlite3';
import type { ConfigStudioService } from './configStudio';

export type UiStateType = 'MAIN_MENU' | 'AWAITING_CATEGORY_INPUT' | 'HELP_VIEW' | 'ADMIN_WIZARD';

export interface UserUiSession {
  telegramId: number;
  selectedCategory: string | null;
  uiState: UiStateType;
  activeMenuMessageId: number | null;
  lastActivityAt: number;
  expiresAt: number;
}

/**
 * Manages temporary user menu/category selection state in `user_sessions` (ADR-05).
 */
export class SessionRepository {
  private readonly db: Database.Database;
  private readonly configStudio: ConfigStudioService;

  constructor(db: Database.Database, configStudio: ConfigStudioService) {
    this.db = db;
    this.configStudio = configStudio;
  }

  public getActiveSession(telegramId: number, now: number = Date.now()): UserUiSession {
    const ttlMs = this.configStudio.getConfig().uiSessionTtlMs;
    const row = this.db
      .prepare('SELECT * FROM user_sessions WHERE telegram_id = ?')
      .get(telegramId) as Record<string, unknown> | undefined;

    if (!row) {
      return this.upsertSession(telegramId, null, 'MAIN_MENU', null, now, ttlMs);
    }

    const expiresAt = Number(row.expires_at);
    if (now > expiresAt) {
      return this.upsertSession(
        telegramId,
        null,
        'MAIN_MENU',
        row.active_menu_message_id ? Number(row.active_menu_message_id) : null,
        now,
        ttlMs
      );
    }

    return {
      telegramId: Number(row.telegram_id),
      selectedCategory: (row.selected_category as string | null) ?? null,
      uiState: (row.ui_state as UiStateType) ?? 'MAIN_MENU',
      activeMenuMessageId:
        row.active_menu_message_id !== null && row.active_menu_message_id !== undefined
          ? Number(row.active_menu_message_id)
          : null,
      lastActivityAt: Number(row.last_activity_at),
      expiresAt,
    };
  }

  public selectCategory(
    telegramId: number,
    category: string,
    activeMenuMessageId?: number | null,
    now: number = Date.now()
  ): UserUiSession {
    const ttlMs = this.configStudio.getConfig().uiSessionTtlMs;
    return this.upsertSession(
      telegramId,
      category,
      'AWAITING_CATEGORY_INPUT',
      activeMenuMessageId ?? null,
      now,
      ttlMs
    );
  }

  public setActiveMenuMessageId(
    telegramId: number,
    messageId: number | null,
    now: number = Date.now()
  ): void {
    const current = this.getActiveSession(telegramId, now);
    const ttlMs = this.configStudio.getConfig().uiSessionTtlMs;
    this.upsertSession(
      telegramId,
      current.selectedCategory,
      current.uiState,
      messageId,
      now,
      ttlMs
    );
  }

  public resetSessionToMainMenu(telegramId: number, now: number = Date.now()): UserUiSession {
    const ttlMs = this.configStudio.getConfig().uiSessionTtlMs;
    return this.upsertSession(telegramId, null, 'MAIN_MENU', null, now, ttlMs);
  }

  public sweepExpiredSessions(now: number = Date.now()): number {
    const info = this.db
      .prepare(
        `UPDATE user_sessions
         SET selected_category = NULL,
             ui_state = 'MAIN_MENU'
         WHERE expires_at < ? AND (selected_category IS NOT NULL OR ui_state != 'MAIN_MENU')`
      )
      .run(now);
    return info.changes;
  }

  private upsertSession(
    telegramId: number,
    selectedCategory: string | null,
    uiState: UiStateType,
    activeMenuMessageId: number | null,
    now: number,
    ttlMs: number
  ): UserUiSession {
    const expiresAt = now + ttlMs;
    this.db
      .prepare(
        `INSERT INTO user_sessions (
          telegram_id, selected_category, ui_state, active_menu_message_id, last_activity_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET
          selected_category = excluded.selected_category,
          ui_state = excluded.ui_state,
          active_menu_message_id = COALESCE(excluded.active_menu_message_id, user_sessions.active_menu_message_id),
          last_activity_at = excluded.last_activity_at,
          expires_at = excluded.expires_at`
      )
      .run(telegramId, selectedCategory, uiState, activeMenuMessageId, now, expiresAt);

    return {
      telegramId,
      selectedCategory,
      uiState,
      activeMenuMessageId,
      lastActivityAt: now,
      expiresAt,
    };
  }
}
