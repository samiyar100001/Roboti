import { Bot, type Context } from 'grammy';
import type Database from 'better-sqlite3';
import type { ConfigStudioService } from '../db/configStudio';
import type { AccountLane } from '../db/database';
import type { LedgerRepository } from '../db/ledgerRepository';
import type { SessionRepository } from '../db/sessionRepository';
import { sanitizeOutboundUserText } from '../firewall/outboundSanitizer';
import type { DualAccountMtProtoManager } from '../mtproto/accountWorker';
import type {
  DualLaneQueueOrchestrator,
  PrimaryBotDeliveryAdapter,
} from '../queue/dualLaneQueue';
import { toPersianDigits } from '../utils/normalizer';
import {
  detectAndValidateInput,
  type SearchCategory,
} from '../validation/validators';
import { hasAdminPermission, isAdministrativeRole } from '../web/rbac';
import {
  NINE_CATEGORY_METADATA,
  ORDERED_NINE_CATEGORIES,
  renderCategorySelectionPrompt,
  renderOriginalHelpGuideFa,
  renderWelcomeDashboardText,
} from './i18n';
import {
  buildAdminControlCenterKeyboard,
  buildCategoryBackKeyboard,
  buildNineRowMainMenuKeyboard,
  getNineRowKeyboardMatrix,
  type InlineButtonDescriptor,
} from './keyboards';

interface AdminWizardSessionState {
  lane: AccountLane;
  step: 'AWAITING_API_ID_HASH_PHONE' | 'AWAITING_OTP' | 'AWAITING_2FA';
  apiId?: number;
  apiHash?: string;
  phone?: string;
}

export interface SimulatedBotInteractionOutcome {
  action: 'EDITED_IN_PLACE' | 'SENT_NEW_MESSAGE';
  messageId: number;
  textFa: string;
  inlineKeyboardRows: InlineButtonDescriptor[][];
  selectedCategory: string | null;
  uiState: string;
}

/**
 * Section 4.3 & Section 4.4:
 * Primary GrammY Bot Service implementing `/start`, `/help`, `/status`, `/cancel`,
 * Strict 9-Row Persian Inline Keyboard, In-Place Menu Editing (`editMessageText` with
 * `sendMessage` fallback), 5-Minute UI Session Reset, and `/admin` In-Telegram Control Center.
 */
export class PrimaryTelegramBotService implements PrimaryBotDeliveryAdapter {
  private readonly db: Database.Database;
  private readonly configStudio: ConfigStudioService;
  private readonly ledgerRepo: LedgerRepository;
  private readonly sessionRepo: SessionRepository;
  private readonly mtprotoManager: DualAccountMtProtoManager;
  private readonly queueOrchestrator: DualLaneQueueOrchestrator;
  private bot: Bot | null = null;

  private readonly adminWizardStates = new Map<number, AdminWizardSessionState>();
  private simulatedMsgCounter = 5000;

  constructor(params: {
    db: Database.Database;
    configStudio: ConfigStudioService;
    ledgerRepo: LedgerRepository;
    sessionRepo: SessionRepository;
    mtprotoManager: DualAccountMtProtoManager;
    queueOrchestrator: DualLaneQueueOrchestrator;
    botToken?: string;
  }) {
    this.db = params.db;
    this.configStudio = params.configStudio;
    this.ledgerRepo = params.ledgerRepo;
    this.sessionRepo = params.sessionRepo;
    this.mtprotoManager = params.mtprotoManager;
    this.queueOrchestrator = params.queueOrchestrator;

    this.queueOrchestrator.bindPrimaryBotDeliveryAdapter(this);

    if (params.botToken && /^\d{6,12}:[A-Za-z0-9_-]{30,50}$/.test(params.botToken.trim())) {
      this.bot = new Bot(params.botToken.trim());
      this.registerGrammyHandlers(this.bot);
    }
  }

  public getGrammyBotInstance(): Bot | null {
    return this.bot;
  }

  // ============================================================================
  // PrimaryBotDeliveryAdapter Implementation (with Mandatory Outbound Sanitizer)
  // ============================================================================

  public async sendInitialSearchingStatus(
    telegramId: number,
    textFa: string,
    replyToMessageId?: number | null
  ): Promise<number> {
    const clean = sanitizeOutboundUserText(textFa).cleanText;
    if (!this.bot) {
      this.simulatedMsgCounter += 1;
      return this.simulatedMsgCounter;
    }
    const sent = await this.bot.api.sendMessage(telegramId, clean, {
      ...(replyToMessageId ? { reply_parameters: { message_id: replyToMessageId } } : {}),
    });
    return sent.message_id;
  }

  public async editSearchingStatusMessage(
    telegramId: number,
    statusMessageId: number,
    newTextFa: string
  ): Promise<boolean> {
    const clean = sanitizeOutboundUserText(newTextFa).cleanText;
    if (!this.bot) {
      return true;
    }
    try {
      await this.bot.api.editMessageText(telegramId, statusMessageId, clean);
      return true;
    } catch {
      return false;
    }
  }

  public async deleteSearchingStatusMessage(
    telegramId: number,
    statusMessageId: number
  ): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.api.deleteMessage(telegramId, statusMessageId);
    } catch {
      // ignore if already deleted by user
    }
  }

  public async sendPaginatedResultMessages(
    telegramId: number,
    pagesFa: string[],
    replyToMessageId?: number | null
  ): Promise<void> {
    if (!this.bot) return;
    for (let i = 0; i < pagesFa.length; i++) {
      const cleanPage = sanitizeOutboundUserText(pagesFa[i]!).cleanText;
      await this.bot.api.sendMessage(telegramId, cleanPage, {
        ...(i === 0 && replyToMessageId
          ? { reply_parameters: { message_id: replyToMessageId } }
          : {}),
      });
    }
  }

  // ============================================================================
  // Deterministic Handler Logic (Shared by Live GrammY Bot & Interactive Simulator)
  // ============================================================================

  /**
   * Handles `/start` or returning to the main 9-Row menu.
   * Idempotently registers or fetches user without resetting credits/trial.
   */
  public handleStartOrMainMenu(params: {
    telegramId: number;
    username?: string | null;
    firstName?: string | null;
    preferEditInPlace?: boolean;
  }): SimulatedBotInteractionOutcome {
    const user = this.ledgerRepo.getOrCreateUser(
      params.telegramId,
      params.username,
      params.firstName
    );
    const currentSession = this.sessionRepo.getActiveSession(params.telegramId);
    const canEditInPlace =
      Boolean(params.preferEditInPlace) && currentSession.activeMenuMessageId !== null;

    const messageId = canEditInPlace
      ? currentSession.activeMenuMessageId!
      : ++this.simulatedMsgCounter;

    this.sessionRepo.resetSessionToMainMenu(params.telegramId);
    this.sessionRepo.setActiveMenuMessageId(params.telegramId, messageId);

    const rawText = renderWelcomeDashboardText(user, user.languageCode);
    const cleanText = sanitizeOutboundUserText(rawText).cleanText;

    return {
      action: canEditInPlace ? 'EDITED_IN_PLACE' : 'SENT_NEW_MESSAGE',
      messageId,
      textFa: cleanText,
      inlineKeyboardRows: getNineRowKeyboardMatrix(),
      selectedCategory: null,
      uiState: 'MAIN_MENU',
    };
  }

  /**
   * Handles selecting one of the 9 search categories from the inline keyboard.
   * Always edits the existing menu message in place where possible.
   */
  public handleSelectCategory(params: {
    telegramId: number;
    category: SearchCategory;
  }): SimulatedBotInteractionOutcome {
    const currentSession = this.sessionRepo.getActiveSession(params.telegramId);
    const canEditInPlace = currentSession.activeMenuMessageId !== null;
    const messageId = canEditInPlace
      ? currentSession.activeMenuMessageId!
      : ++this.simulatedMsgCounter;

    const updatedSession = this.sessionRepo.selectCategory(
      params.telegramId,
      params.category,
      messageId
    );

    const rawText = renderCategorySelectionPrompt(params.category);
    const cleanText = sanitizeOutboundUserText(rawText).cleanText;

    return {
      action: canEditInPlace ? 'EDITED_IN_PLACE' : 'SENT_NEW_MESSAGE',
      messageId,
      textFa: cleanText,
      inlineKeyboardRows: [
        [{ text: '🔄 لغو و بازگشت به منوی اصلی', callbackData: 'nav:main' }],
      ],
      selectedCategory: updatedSession.selectedCategory,
      uiState: updatedSession.uiState,
    };
  }

  /**
   * Handles `/help` (via command or inline button).
   */
  public handleHelpCommand(params: {
    telegramId: number;
    preferEditInPlace?: boolean;
  }): SimulatedBotInteractionOutcome {
    const currentSession = this.sessionRepo.getActiveSession(params.telegramId);
    const canEditInPlace =
      Boolean(params.preferEditInPlace) && currentSession.activeMenuMessageId !== null;
    const messageId = canEditInPlace
      ? currentSession.activeMenuMessageId!
      : ++this.simulatedMsgCounter;

    this.sessionRepo.setActiveMenuMessageId(params.telegramId, messageId);
    const cleanText = sanitizeOutboundUserText(renderOriginalHelpGuideFa()).cleanText;

    return {
      action: canEditInPlace ? 'EDITED_IN_PLACE' : 'SENT_NEW_MESSAGE',
      messageId,
      textFa: cleanText,
      inlineKeyboardRows: [
        [{ text: '🔙 بازگشت به منوی ۹گانه اصلی', callbackData: 'nav:main' }],
      ],
      selectedCategory: currentSession.selectedCategory,
      uiState: 'HELP_VIEW',
    };
  }

  /**
   * Handles `/status` (inspects ONLY the user's own active request).
   */
  public handleStatusCommand(telegramId: number): SimulatedBotInteractionOutcome {
    const status = this.queueOrchestrator.getUserActiveRequestStatus(telegramId);
    const cleanText = sanitizeOutboundUserText(status.statusMessageFa).cleanText;
    const session = this.sessionRepo.getActiveSession(telegramId);

    return {
      action: 'SENT_NEW_MESSAGE',
      messageId: ++this.simulatedMsgCounter,
      textFa: cleanText,
      inlineKeyboardRows: [
        [{ text: '🔙 بازگشت به منوی ۹گانه اصلی', callbackData: 'nav:main' }],
      ],
      selectedCategory: session.selectedCategory,
      uiState: session.uiState,
    };
  }

  /**
   * Handles `/cancel` (cancels queued/waiting request with 0 deduction or detaches in-flight delivery).
   */
  public handleCancelCommand(telegramId: number): SimulatedBotInteractionOutcome {
    const outcome = this.queueOrchestrator.cancelUserActiveRequest(telegramId, true);
    const cleanText = sanitizeOutboundUserText(outcome.messageFa).cleanText;

    return {
      action: 'SENT_NEW_MESSAGE',
      messageId: ++this.simulatedMsgCounter,
      textFa: cleanText,
      inlineKeyboardRows: getNineRowKeyboardMatrix(),
      selectedCategory: null,
      uiState: 'MAIN_MENU',
    };
  }

  /**
   * Renders the `/admin` In-Telegram Control Center for authorized administrative roles.
   */
  public handleAdminControlCenter(
    telegramId: number,
    subAction?:
      | 'health'
      | 'queue_pause'
      | 'queue_resume'
      | 'telemetry_refresh'
      | 'wizard_REAL'
      | 'wizard_TEST'
  ): SimulatedBotInteractionOutcome {
    const user = this.ledgerRepo.getOrCreateUser(telegramId);
    if (!isAdministrativeRole(user.accessRole)) {
      return {
        action: 'SENT_NEW_MESSAGE',
        messageId: ++this.simulatedMsgCounter,
        textFa: '⛔ شما مجوز دسترسی به پنل مدیریت (/admin) را ندارید.',
        inlineKeyboardRows: [],
        selectedCategory: null,
        uiState: 'MAIN_MENU',
      };
    }

    if (
      (subAction === 'queue_pause' || subAction === 'queue_resume') &&
      hasAdminPermission(user.accessRole, 'MANAGE_QUEUE_STATE')
    ) {
      const nextPaused = subAction === 'queue_pause';
      this.configStudio.updateConfig(
        { queuePaused: nextPaused },
        telegramId,
        user.accessRole,
        `In-Telegram /admin ${nextPaused ? 'paused' : 'resumed'} queue`
      );
      if (!nextPaused) {
        void this.queueOrchestrator.triggerLaneWorker('REAL');
        void this.queueOrchestrator.triggerLaneWorker('TEST');
      }
    }

    if (
      (subAction === 'wizard_REAL' || subAction === 'wizard_TEST') &&
      hasAdminPermission(user.accessRole, 'MANAGE_MTPROTO_SESSIONS')
    ) {
      const lane: AccountLane = subAction === 'wizard_REAL' ? 'REAL' : 'TEST';
      this.adminWizardStates.set(telegramId, {
        lane,
        step: 'AWAITING_API_ID_HASH_PHONE',
      });
      return {
        action: 'EDITED_IN_PLACE',
        messageId: ++this.simulatedMsgCounter,
        textFa:
          `🔐 جادوگر نشست MTProto (${lane}_ACCOUNT)\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `لطفاً اطلاعات اتصال اکانت ${lane} را در یک خط با فرمت زیر ارسال فرمایید:\n` +
          `\`API_ID API_HASH +989123456789\`\n\n` +
          `🔒 تمامی اطلاعات بلافاصله با الگوریتم AES-256-GCM رمزنگاری و در SQLite ذخیره میشوند.`,
        inlineKeyboardRows: [
          [{ text: '🔙 انصراف و بازگشت به پنل مدیریت', callbackData: 'admin:health' }],
        ],
        selectedCategory: null,
        uiState: 'ADMIN_WIZARD',
      };
    }

    const q = this.queueOrchestrator.getQueueTelemetrySummary();
    const accounts = this.mtprotoManager.getAllAccountsState();
    const walMode = (this.db.pragma('journal_mode') as Array<{ journal_mode: string }>)?.[0]
      ?.journal_mode ?? 'wal';

    const summaryFa =
      `🛡 مرکز کنترل و مدیریت تلگرام (/admin)\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 مدیر: \`${user.telegramId}\` (${user.accessRole})\n` +
      `🗄 وضعیت دیتابیس SQLite: \`${walMode.toUpperCase()}\`\n` +
      `⏸ وضعیت صف: ${q.queuePaused ? 'متوقف شده (PAUSED)' : 'فعال (ACTIVE)'}\n` +
      `🔹 صف مسیر اصلی (REAL_LANE): ${toPersianDigits(q.realLaneWaiting)} در انتظار\n` +
      `🔹 صف مسیر آزمایشی (TEST_LANE): ${toPersianDigits(q.testLaneWaiting)} در انتظار\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📡 اکانت اصلی (REAL): \`${accounts.REAL.connectionStatus}\`\n` +
      `   • سهمیه بات مرجع: ${accounts.REAL.destQuotaRemaining !== null ? toPersianDigits(accounts.REAL.destQuotaRemaining) : 'نامشخص'} | انقضا: ${accounts.REAL.destExpiryDays !== null ? `${toPersianDigits(accounts.REAL.destExpiryDays)} روز` : 'نامشخص'}\n` +
      `🧪 اکانت تست (TEST): \`${accounts.TEST.connectionStatus}\`\n` +
      `   • سهمیه بات مرجع: ${accounts.TEST.destQuotaRemaining !== null ? toPersianDigits(accounts.TEST.destQuotaRemaining) : 'نامشخص'} | انقضا: ${accounts.TEST.destExpiryDays !== null ? `${toPersianDigits(accounts.TEST.destExpiryDays)} روز` : 'نامشخص'}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 جهت تنظیم موجودی کاربر در تلگرام از دستور زیر استفاده کنید:\n` +
      `\`/adjust <UserID> <CreditsDelta> <Reason>\``;

    return {
      action: 'EDITED_IN_PLACE',
      messageId: ++this.simulatedMsgCounter,
      textFa: sanitizeOutboundUserText(summaryFa).cleanText,
      inlineKeyboardRows: [
        [{ text: '🔄 بروزرسانی وضعیت سلامت سامانه', callbackData: 'admin:health' }],
        [
          {
            text: q.queuePaused
              ? '▶️ ادامه پردازش صف (Resume Queue)'
              : '⏸ توقف موقت صف (Pause Queue)',
            callbackData: q.queuePaused ? 'admin:queue_resume' : 'admin:queue_pause',
          },
        ],
        [
          {
            text: '🔐 جادوگر نشست MTProto (اکانت اصلی REAL)',
            callbackData: 'admin:wizard_REAL',
          },
        ],
        [
          {
            text: '🧪 جادوگر نشست MTProto (اکانت تست TEST)',
            callbackData: 'admin:wizard_TEST',
          },
        ],
        [{ text: '🔙 بازگشت به منوی کاربری', callbackData: 'nav:main' }],
      ],
      selectedCategory: null,
      uiState: 'ADMIN_WIZARD',
    };
  }

  // ============================================================================
  // Live GrammY Bot Wiring
  // ============================================================================

  private registerGrammyHandlers(bot: Bot): void {
    bot.command('start', async (ctx: Context) => {
      const uid = ctx.from?.id;
      if (!uid) return;
      const res = this.handleStartOrMainMenu({
        telegramId: uid,
        username: ctx.from?.username ?? null,
        firstName: ctx.from?.first_name ?? null,
        preferEditInPlace: false,
      });
      const sent = await ctx.reply(res.textFa, {
        reply_markup: buildNineRowMainMenuKeyboard(),
      });
      this.sessionRepo.setActiveMenuMessageId(uid, sent.message_id);
    });

    bot.command('help', async (ctx: Context) => {
      const uid = ctx.from?.id;
      if (!uid) return;
      const res = this.handleHelpCommand({ telegramId: uid, preferEditInPlace: false });
      await ctx.reply(res.textFa, {
        reply_markup: buildCategoryBackKeyboard(),
      });
    });

    bot.command('status', async (ctx: Context) => {
      const uid = ctx.from?.id;
      if (!uid) return;
      const res = this.handleStatusCommand(uid);
      await ctx.reply(res.textFa, {
        reply_markup: buildCategoryBackKeyboard(),
      });
    });

    bot.command('cancel', async (ctx: Context) => {
      const uid = ctx.from?.id;
      if (!uid) return;
      const res = this.handleCancelCommand(uid);
      await ctx.reply(res.textFa, {
        reply_markup: buildNineRowMainMenuKeyboard(),
      });
    });

    bot.command('admin', async (ctx: Context) => {
      const uid = ctx.from?.id;
      if (!uid) return;
      const res = this.handleAdminControlCenter(uid, 'health');
      const qPaused = this.configStudio.getConfig().queuePaused;
      await ctx.reply(res.textFa, {
        reply_markup: buildAdminControlCenterKeyboard(qPaused),
      });
    });

    bot.on('callback_query:data', async (ctx: Context) => {
      const uid = ctx.from?.id;
      const data = ctx.callbackQuery?.data;
      if (!uid || !data) return;

      await ctx.answerCallbackQuery().catch(() => {});

      if (data === 'nav:main') {
        const res = this.handleStartOrMainMenu({
          telegramId: uid,
          username: ctx.from?.username ?? null,
          firstName: ctx.from?.first_name ?? null,
          preferEditInPlace: true,
        });
        await this.editOrSendWithKeyboard(
          ctx,
          res.textFa,
          buildNineRowMainMenuKeyboard()
        );
        return;
      }

      if (data === 'nav:help') {
        const res = this.handleHelpCommand({ telegramId: uid, preferEditInPlace: true });
        await this.editOrSendWithKeyboard(ctx, res.textFa, buildCategoryBackKeyboard());
        return;
      }

      if (data === 'nav:status') {
        const res = this.handleStatusCommand(uid);
        await this.editOrSendWithKeyboard(ctx, res.textFa, buildCategoryBackKeyboard());
        return;
      }

      if (data.startsWith('cat:')) {
        const cat = data.slice(4) as SearchCategory;
        if (ORDERED_NINE_CATEGORIES.includes(cat)) {
          const res = this.handleSelectCategory({ telegramId: uid, category: cat });
          await this.editOrSendWithKeyboard(
            ctx,
            res.textFa,
            buildCategoryBackKeyboard(cat)
          );
        }
        return;
      }

      if (data.startsWith('admin:')) {
        const action = data.slice(6) as
          | 'health'
          | 'queue_pause'
          | 'queue_resume'
          | 'telemetry_refresh'
          | 'wizard_REAL'
          | 'wizard_TEST';
        const res = this.handleAdminControlCenter(uid, action);
        const qPaused = this.configStudio.getConfig().queuePaused;
        await this.editOrSendWithKeyboard(
          ctx,
          res.textFa,
          buildAdminControlCenterKeyboard(qPaused)
        );
      }
    });

    bot.on('message:text', async (ctx: Context) => {
      const uid = ctx.from?.id;
      const text = ctx.message?.text?.trim();
      if (!uid || !text || text.startsWith('/')) return;

      // Check active session (5-minute inactivity TTL enforced automatically by getActiveSession)
      const session = this.sessionRepo.getActiveSession(uid);
      const selectedCat = (session.selectedCategory as SearchCategory | null) ?? null;

      const categoryToUse: SearchCategory =
        selectedCat && NINE_CATEGORY_METADATA[selectedCat]
          ? selectedCat
          : detectAndValidateInput(text).category;

      const outcome = await this.queueOrchestrator.submitSearchRequest({
        telegramId: uid,
        username: ctx.from?.username ?? null,
        firstName: ctx.from?.first_name ?? null,
        category: categoryToUse,
        rawInput: text,
        userMessageId: ctx.message?.message_id ?? null,
      });

      if (!outcome.accepted && outcome.rejectionMessageFa) {
        const cleanErr = sanitizeOutboundUserText(outcome.rejectionMessageFa).cleanText;
        await ctx.reply(cleanErr, {
          reply_markup: buildCategoryBackKeyboard(categoryToUse),
        });
      }
    });
  }

  private async editOrSendWithKeyboard(
    ctx: Context,
    textFa: string,
    keyboard: ReturnType<typeof buildNineRowMainMenuKeyboard>
  ): Promise<void> {
    const clean = sanitizeOutboundUserText(textFa).cleanText;
    try {
      await ctx.editMessageText(clean, { reply_markup: keyboard });
    } catch {
      const sent = await ctx.reply(clean, { reply_markup: keyboard });
      if (ctx.from?.id) {
        this.sessionRepo.setActiveMenuMessageId(ctx.from.id, sent.message_id);
      }
    }
  }
}
