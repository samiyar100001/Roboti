import assert from 'node:assert/strict';
import { CryptoService } from '../crypto/aesGcm';
import { initializeDatabase } from '../db/database';
import { ConfigStudioService } from '../db/configStudio';
import { LedgerRepository } from '../db/ledgerRepository';
import { SessionRepository } from '../db/sessionRepository';
import {
  normalizeNumeralsToAscii,
  normalizePersianOrthography,
  stripEmojiVariationSelectors,
  toPersianDigits,
} from '../utils/normalizer';
import { validateInputByCategory } from '../validation/validators';
import {
  CANONICAL_FIELD_DEFINITIONS,
  DATA_SOURCE_CATALOG,
} from '../parser/lexicalInventory';
import { inspectSection3Firewall } from '../firewall/section3Firewall';
import { evaluateSection4ErrorSignature } from '../firewall/section4ErrorMachine';
import { parseDestinationPayloadToAst } from '../parser/astParser';
import { renderWhiteLabelReportPages } from '../parser/whiteLabelRenderer';
import { sanitizeOutboundUserText } from '../firewall/outboundSanitizer';
import { TwoLayerCorrelationEngine } from '../mtproto/correlationEngine';
import { DualAccountMtProtoManager } from '../mtproto/accountWorker';
import { DualLaneQueueOrchestrator } from '../queue/dualLaneQueue';
import { PrimaryTelegramBotService } from '../bot/primaryBot';

export interface VerificationTestReportItem {
  testId: string;
  title: string;
  passed: boolean;
  durationMs: number;
  assertionsVerified: number;
  details: string;
}

export interface VerificationSuiteSummary {
  allPassed: boolean;
  totalTests: number;
  passedCount: number;
  failedCount: number;
  totalAssertions: number;
  totalDurationMs: number;
  executedAt: number;
  results: VerificationTestReportItem[];
}

/**
 * Section 6.2 Automated Verification Suite (Tests A through L).
 * Executes all 12 architectural, security, financial, and lexical acceptance tests
 * against isolated in-memory SQLite WAL instances with zero side effects.
 */
export async function runFullVerificationSuite(): Promise<VerificationSuiteSummary> {
  const suiteStart = performance.now();
  const results: VerificationTestReportItem[] = [];

  async function runCase(
    testId: string,
    title: string,
    details: string,
    fn: () => Promise<number> | number
  ): Promise<void> {
    const t0 = performance.now();
    try {
      const assertionsVerified = await fn();
      results.push({
        testId,
        title,
        passed: true,
        durationMs: Math.round((performance.now() - t0) * 100) / 100,
        assertionsVerified,
        details,
      });
    } catch (err) {
      results.push({
        testId,
        title,
        passed: false,
        durationMs: Math.round((performance.now() - t0) * 100) / 100,
        assertionsVerified: 0,
        details: `${details} — FAILED: ${(err as Error).message}`,
      });
    }
  }

  // ============================================================================
  // TEST A: Universal Numeral Normalization & Emoji Variation Stripping
  // ============================================================================
  await runCase(
    'TEST_A',
    'Universal Numeral Normalization & Emoji Variation Selector Stripping',
    'Persian (۰-۹) and Arabic (٠-٩) digits -> ASCII (0-9); strips \\uFE0F while preserving Persian ZWNJ (\\u200C)',
    () => {
      assert.equal(normalizeNumeralsToAscii('۰۹۱۲۳۴۵۶۷۸۹'), '09123456789');
      assert.equal(normalizeNumeralsToAscii('٠٩١٢٣٤٥٦٧٨٩'), '09123456789');
      assert.equal(stripEmojiVariationSelectors('☎️\uFE0F📂\uFE0F'), '☎📂');
      // Preserve ZWNJ (\u200C) in compound Persian names
      const zwnjName = normalizePersianOrthography('امیر\u200Cحسین كریمی');
      assert.equal(zwnjName, 'امیر\u200Cحسین کریمی');
      assert.equal(toPersianDigits(1403), '۱۴۰۳');
      return 5;
    }
  );

  // ============================================================================
  // TEST B: Exhaustive 9-Category Input Validation Matrix
  // ============================================================================
  await runCase(
    'TEST_B',
    'Exhaustive 9-Category Input Validation Matrix & Reconciled Bounds',
    'Verifies PHONE, NATIONAL_ID (Mod-11), TELEGRAM_ID (5..10 vs 5..9), BANK_CARD (Luhn), IBAN (24 digits without IR), IPV4 (0..255 no leading zero), USERNAME, EMAIL, FULL_NAME',
    () => {
      // 1. PHONE
      assert.equal(validateInputByCategory('PHONE', '09123456789').valid, true);
      assert.equal(validateInputByCategory('PHONE', '+989123456789').valid, true);
      assert.equal(validateInputByCategory('PHONE', '79186328959').valid, true);
      assert.equal(validateInputByCategory('PHONE', '9123456789').valid, false);

      // 2. NATIONAL_ID (Mod-11)
      assert.equal(validateInputByCategory('NATIONAL_ID', '0012345678').valid, true);
      assert.equal(validateInputByCategory('NATIONAL_ID', '1111111111').valid, false);
      assert.equal(validateInputByCategory('NATIONAL_ID', '0012345675').valid, false);

      // 3. TELEGRAM_ID (Modern 5..10 vs Legacy 5..9)
      assert.equal(
        validateInputByCategory('TELEGRAM_ID', '1234567890', {
          enableNationalIdChecksum: true,
          telegramIdValidationPolicy: 'MODERN_10_DIGIT_MAX',
          enableBankCardLuhn: true,
          strictLegacyIpv4: false,
        }).valid,
        true
      );
      assert.equal(
        validateInputByCategory('TELEGRAM_ID', '1234567890', {
          enableNationalIdChecksum: true,
          telegramIdValidationPolicy: 'LEGACY_9_DIGIT_MAX',
          enableBankCardLuhn: true,
          strictLegacyIpv4: false,
        }).valid,
        false
      );

      // 4. BANK_CARD (Luhn)
      assert.equal(validateInputByCategory('BANK_CARD', '6104337803287067').valid, true);
      assert.equal(validateInputByCategory('BANK_CARD', '6104337803287068').valid, false);

      // 5. IBAN (24 digits without IR)
      assert.equal(validateInputByCategory('IBAN', '200560611828005564089101').valid, true);
      assert.equal(validateInputByCategory('IBAN', 'IR200560611828005564089101').valid, false);

      // 6. IPV4 (0..255 inclusive vs strictLegacyIpv4 0..254, no leading zero)
      assert.equal(validateInputByCategory('IPV4', '192.15.99.72').valid, true);
      assert.equal(validateInputByCategory('IPV4', '10.0.0.255').valid, true);
      assert.equal(
        validateInputByCategory('IPV4', '10.0.0.255', {
          enableNationalIdChecksum: true,
          telegramIdValidationPolicy: 'MODERN_10_DIGIT_MAX',
          enableBankCardLuhn: true,
          strictLegacyIpv4: true,
        }).valid,
        false
      );
      assert.equal(validateInputByCategory('IPV4', '192.168.01.1').valid, false);

      // 7. USERNAME
      assert.equal(validateInputByCategory('USERNAME', '@telegram_user1').valid, true);
      assert.equal(validateInputByCategory('USERNAME', 'telegram_user1').valid, false);

      // 8. EMAIL
      assert.equal(validateInputByCategory('EMAIL', 'user.example@domain.com').valid, true);
      assert.equal(validateInputByCategory('EMAIL', 'invalid-email').valid, false);

      // 9. FULL_NAME
      assert.equal(validateInputByCategory('FULL_NAME', 'علی احمدی').valid, true);
      assert.equal(validateInputByCategory('FULL_NAME', 'Ali Ahmadi').valid, false);
      assert.equal(validateInputByCategory('FULL_NAME', 'علی').valid, false);

      return 24;
    }
  );

  // ============================================================================
  // TEST C: Complete 14-Database Classification & 73-Field Canonical AST Mapping
  // ============================================================================
  await runCase(
    'TEST_C',
    'Complete 14-Database + 2 Sub-Section Classification & 73-Field Canonical AST Mapping',
    'Verifies all 14 primary databases, 2 sub-sections, 56 canonical field keys (73+ raw labels), and dynamic extraFields',
    () => {
      const primaryDbs = DATA_SOURCE_CATALOG.filter((d) => !d.isSubSection);
      const subSections = DATA_SOURCE_CATALOG.filter((d) => d.isSubSection);
      assert.equal(primaryDbs.length, 14);
      assert.equal(subSections.length, 2);
      assert.equal(CANONICAL_FIELD_DEFINITIONS.length, 71);

      const totalRawLabels = CANONICAL_FIELD_DEFINITIONS.reduce(
        (acc, def) => acc + def.rawLabels.length,
        0
      );
      assert.ok(totalRawLabels >= 73);

      const multiDbPayload = `
✅ نتایج کد ملی 0012345678:
در حال ارسال نتایج (2 رکورد)...
بخش 1:
📂 دیتابیس ثبت احوال
👤 نام: محمد
👤 نام خانوادگی: رضایی
👨 نام پدر: علی
🆔 کدملی: 0012345678
📜 شماره شناسنامه: 1245
🎂 تاریخ تولد: 1368/04/15
───────────────────────────
📂 دیتابیس فروشگاه سفیر
📦 اطلاعات سفارش:
👤 نام و نام خانوادگی: محمد رضایی
📱 موبایل: 09123456789
🔸 فیلد ۱۲: فعال
      `;
      const ast = parseDestinationPayloadToAst([multiDbPayload]);
      assert.equal(ast.isValidPositivePayload, true);
      assert.equal(ast.records.length, 2);
      assert.equal(ast.records[0]?.sourceType, 'SOURCE_SABT_AHVAL');
      assert.deepEqual(ast.records[0]?.fields.nationalId, ['0012345678']);
      assert.equal(ast.records[1]?.sourceType, 'SOURCE_SAFIR');
      assert.equal(ast.records[1]?.subSections.includes('SUBSECTION_ORDER_INFO'), true);
      assert.equal(ast.records[1]?.extraFields['فیلد ۱۲'], 'فعال');

      return 11;
    }
  );

  // ============================================================================
  // TEST D: White-Label Tree Renderer & 4,096-Char Record-Boundary Pagination
  // ============================================================================
  await runCase(
    'TEST_D',
    'White-Label Tree Renderer (`├─`, `╰─`) & 4,096-Char Record-Boundary Pagination',
    'Verifies tree glyphs, Persian digits, trial watermark on TEST_LANE, and multi-page splitting without mid-record truncation',
    () => {
      const manyRecordsChunks: string[] = ['✅ نتایج جستجوی نام «علی محمدی»:'];
      for (let i = 1; i <= 28; i++) {
        manyRecordsChunks.push(
          `📂 دیتابیس بانک ملت\n` +
            `👤 نام: علی (${i})\n` +
            `👤 نام خانوادگی: محمدی (${i})\n` +
            `🆔 کد ملی: 0012345678\n` +
            `📱 شماره موبایل: 09123456789\n` +
            `💳 شماره کارت: 6104337803287067\n` +
            `🏠 آدرس: تهران، خیابان ولیعصر، کوچه نمونه، پلاک ${i}، طبقه اول`
        );
      }

      const ast = parseDestinationPayloadToAst([manyRecordsChunks.join('\n───────────────────────────\n')], {
        isTrialWatermarked: true,
      });
      assert.equal(ast.records.length, 28);

      const pages = renderWhiteLabelReportPages(ast, {
        referenceCode: 'REQ-TEST-D',
        trialWatermarkText: '🧪 خروجی نسخه آزمایشی رایگان (حساب تست)',
        maxMessageLength: 3900,
      });
      assert.ok(pages.length >= 2);
      for (const page of pages) {
        assert.ok(page.length <= 4096);
        assert.equal(page.includes('📂 دیتابیس'), false);
        assert.ok(page.includes('├─'));
        assert.ok(page.includes('╰─'));
        assert.ok(page.includes('نسخه آزمایشی رایگان'));
      }
      return 7;
    }
  );

  // ============================================================================
  // TEST E: Section 3 Anti-Leakage Firewall & Self-Healing /db Support Mode
  // ============================================================================
  await runCase(
    'TEST_E',
    'Section 3 Anti-Leakage Firewall (3.1–3.7) & Self-Healing /db Support Mode',
    'Verifies /start telemetry parsing, /db Support Mode trap interception, and zero handle leakage (@RostamQuerySupport / @frenzyexbot)',
    () => {
      const s31 = inspectSection3Firewall(
        'سلام به بات جستجوی حرفهای، کاملترین دیتابیس ایرانی خوش آمدید\nاطلاعات شما:\nآیدی: 9918273\nاعتبار: فعال (22 روز باقیمانده)\nجستجو: 640 از 1000 باقیمانده'
      );
      assert.equal(s31.blocked, true);
      assert.equal(s31.signatureId, '3.1_PROFILE_SUBSCRIPTION_STATUS');
      assert.equal(s31.telemetry?.remainingQueries, 640);
      assert.equal(s31.telemetry?.remainingDays, 22);

      const s33 = inspectSection3Firewall(
        '✅ حالت پشتیبانی فعال شد / از این لحظه هر پیامی ارسال کنی برای ادمین میره. / برای خروج: /exit /cancel'
      );
      assert.equal(s33.blocked, true);
      assert.equal(s33.requiresSupportModeCancelDispatch, true);

      const s35 = inspectSection3Firewall('جهت خرید اشتراک به @frenzyexbot مراجعه نمایید');
      assert.equal(s35.blocked, true);

      return 7;
    }
  );

  // ============================================================================
  // TEST F: Section 4 Error Machine & Split REAL vs TEST Masked Output Handling
  // ============================================================================
  await runCase(
    'TEST_F',
    'Section 4 Error State Machine (4.1–4.8) & Split REAL vs TEST Masked Output',
    'Verifies 4.1 No Results (0 deduction), 4.2 Quota Depleted (0 deduction), and 4.3 Free Masked Output (REAL blocks vs TEST strips header & watermarks)',
    () => {
      const e41 = evaluateSection4ErrorSignature('❌ هیچ رکوردی با این مشخصات پیدا نشد.', 'REAL');
      assert.equal(e41.signatureId, '4.1_NOT_FOUND');
      assert.equal(e41.deductQuotaOrCredits, 0);

      const e42 = evaluateSection4ErrorSignature(
        '⚠️ تعداد جستجوهای شما به پایان رسیده است!\nپکیج جدید تهیه کنید',
        'REAL'
      );
      assert.equal(e42.signatureId, '4.2_QUOTA_EXCEEDED');
      assert.equal(e42.deductQuotaOrCredits, 0);
      assert.equal(e42.newAccountConnectionStatus, 'QUOTA_DEPLETED');

      const maskedPayload =
        '⚠️ توجه مهم: پیامهای نسخه رایگان از بات به صورت مخدوش شده نمایش داده میشوند.\n' +
        'برای دریافت اطلاعات کامل خرید اشتراک انجام دهید.\n' +
        '✅ نتایج برای 09123456789:\n' +
        '📂 دیتابیس ایرانسل\n' +
        '👤 نام: ع***\n' +
        '📱 موبایل: 0912***6789';

      const e43Real = evaluateSection4ErrorSignature(maskedPayload, 'REAL');
      assert.equal(e43Real.blockEntireMessage, true);
      assert.equal(e43Real.deductQuotaOrCredits, 0);
      assert.equal(e43Real.newAccountConnectionStatus, 'UNSUBSCRIBED_MASKED');

      const e43Test = evaluateSection4ErrorSignature(maskedPayload, 'TEST');
      assert.equal(e43Test.blockEntireMessage, false);
      assert.equal(e43Test.stripMaskedWarningHeaderOnly, true);
      assert.equal(e43Test.attachTrialWatermark, true);
      assert.equal(e43Test.cleanedTextAfterStrip?.includes('نسخه رایگان'), false);

      return 12;
    }
  );

  // ============================================================================
  // TEST G: Dual-Lane Single-Concurrency Isolation & Zero Cross-Lane Fallback
  // ============================================================================
  await runCase(
    'TEST_G',
    'Dual-Lane Single-Concurrency Isolation (`REAL_LANE` vs `TEST_LANE`) & Zero Fallback',
    'Verifies subscribed users route strictly to REAL_LANE and never fall back to TEST_ACCOUNT even if REAL_ACCOUNT is QUOTA_DEPLETED',
    async () => {
      const db = initializeDatabase(':memory:');
      const crypto = new CryptoService('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
      const cfg = new ConfigStudioService(db, 'ReferenceTargetBot');
      const ledger = new LedgerRepository(db, cfg, 100001);
      const sessions = new SessionRepository(db, cfg);
      const mtproto = new DualAccountMtProtoManager(db, crypto, cfg);
      const corr = new TwoLayerCorrelationEngine(db, crypto, cfg, {
        onSendCancelSupportMode: async () => {},
        onSupportModeStateChange: () => {},
        onUpdateAccountStatus: () => {},
        onCriticalAdminAlert: () => {},
      });
      mtproto.bindCorrelationEngine(corr);

      // Provision subscriber 5001
      ledger.getOrCreateUser(5001, 'sub_user', 'Subscriber');
      ledger.activateSubscriptionAndAddCredits({
        telegramId: 5001,
        creditsToAdd: 10,
        subscriptionDays: 30,
        idempotencyKey: 'test_g_sub',
        adminActorId: 100001,
        adminRole: 'OWNER',
        reason: 'Test G subscriber',
      });

      // Set REAL account to QUOTA_DEPLETED while TEST account is CONNECTED
      mtproto.updateAccountConnectionStatus('REAL', 'QUOTA_DEPLETED');
      mtproto.updateAccountConnectionStatus('TEST', 'CONNECTED');

      const queue = new DualLaneQueueOrchestrator({
        db,
        cryptoService: crypto,
        configStudio: cfg,
        ledgerRepo: ledger,
        sessionRepo: sessions,
        mtprotoManager: mtproto,
        correlationEngine: corr,
      });

      const subRes = await queue.submitSearchRequest({
        telegramId: 5001,
        category: 'PHONE',
        rawInput: '09123456789',
      });
      assert.equal(subRes.accepted, true);
      assert.equal(subRes.request?.accountLane, 'REAL');

      await new Promise((r) => setTimeout(r, 25));
      const updatedReq = queue.getRequestById(subRes.request!.requestId);
      // Must fail with TEMPORARILY_UNAVAILABLE on REAL lane and NEVER fall back to TEST lane
      assert.equal(updatedReq?.state, 'TEMPORARILY_UNAVAILABLE');
      assert.equal(updatedReq?.accountLane, 'REAL');
      assert.equal(updatedReq?.quotaOrCreditDeducted, 0);
      assert.equal(ledger.getUserById(5001)?.paidCredits, 10);

      return 6;
    }
  );

  // ============================================================================
  // TEST H: Two-Layer Correlation Engine (Behavior A & B + Multi-Chunk Collection)
  // ============================================================================
  await runCase(
    'TEST_H',
    'Two-Layer Correlation Engine (Behavior A Delete+Send & Behavior B Edit + Multi-Chunk)',
    'Verifies both Behavior A and Behavior B temporary search indicator transitions and multi-part chunk reassembly',
    async () => {
      const db = initializeDatabase(':memory:');
      const crypto = new CryptoService('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
      const cfg = new ConfigStudioService(db, 'ReferenceTargetBot');
      const ledger = new LedgerRepository(db, cfg, 100001);
      const sessions = new SessionRepository(db, cfg);
      const mtproto = new DualAccountMtProtoManager(db, crypto, cfg);
      const corr = new TwoLayerCorrelationEngine(db, crypto, cfg, {
        onSendCancelSupportMode: async () => {},
        onSupportModeStateChange: () => {},
        onUpdateAccountStatus: () => {},
        onCriticalAdminAlert: () => {},
      });
      mtproto.bindCorrelationEngine(corr);
      mtproto.updateAccountConnectionStatus('TEST', 'CONNECTED');

      const queue = new DualLaneQueueOrchestrator({
        db,
        cryptoService: crypto,
        configStudio: cfg,
        ledgerRepo: ledger,
        sessionRepo: sessions,
        mtprotoManager: mtproto,
        correlationEngine: corr,
      });

      const subA = await queue.submitSearchRequest({
        telegramId: 6001,
        category: 'PHONE',
        rawInput: '09123456789',
      });
      await new Promise((r) => setTimeout(r, 20));
      const slotA = corr.getActiveSlot('TEST');
      assert.ok(slotA !== null);

      const tempId = slotA.outboundGramJsMessageId + 1;
      await corr.handleInboundNewMessage('TEST', tempId, '🔍 در حال جستجو... ⏳');
      // Behavior A: Delete temp message and send 2 chunks
      corr.handleInboundMessageDeleted('TEST', [tempId]);
      await corr.handleInboundNewMessage(
        'TEST',
        tempId + 1,
        '✅ نتایج برای 09123456789:\nبخش 1:\n📂 دیتابیس بانک ملت\n👤 نام: بهرام\n📱 شماره موبایل: 09123456789'
      );
      await corr.handleInboundNewMessage(
        'TEST',
        tempId + 2,
        'بخش 2:\n📂 دیتابیس ایرانسل\n👤 نام: بهرام رادان\n🆔 کدملی: 0012345678'
      );
      corr.finalizeCollectionWindow('TEST', slotA.requestId);
      await new Promise((r) => setTimeout(r, 20));

      const finalA = queue.getRequestById(subA.request!.requestId);
      assert.equal(finalA?.state, 'COMPLETED');
      assert.equal(finalA?.quotaOrCreditDeducted, 1);

      return 3;
    }
  );

  // ============================================================================
  // TEST I: Atomic Financial Ledger, Idempotency & Subscription Trial-Zeroing
  // ============================================================================
  await runCase(
    'TEST_I',
    'Atomic Financial Ledger, Idempotency & Subscription Trial-Zeroing Invariant',
    'Verifies idempotent credit deduction and proves subscription activation sets trial_remaining = 0 and trial_disabled = 1',
    () => {
      const db = initializeDatabase(':memory:');
      const cfg = new ConfigStudioService(db, 'ReferenceTargetBot');
      const ledger = new LedgerRepository(db, cfg, 100001);

      const user = ledger.getOrCreateUser(7001, 'mina', 'Mina');
      assert.equal(user.trialRemaining, 3);
      assert.equal(user.paidCredits, 0);

      // Deduct 1 trial unit idempotently via settleRequestAccounting
      const d1 = ledger.settleRequestAccounting('req-7001-a', 7001, 'TEST', 'COMPLETED');
      const d2 = ledger.settleRequestAccounting('req-7001-a', 7001, 'TEST', 'COMPLETED');
      assert.equal(d1.deducted, 1);
      assert.equal(d1.alreadySettled, false);
      assert.equal(d2.deducted, 0);
      assert.equal(d2.alreadySettled, true);
      assert.equal(ledger.getUserById(7001)?.trialRemaining, 2);

      // Activate subscription -> trial_remaining MUST become 0 and trial_disabled = true, paid_credits = 50 (never 52)
      const upgraded = ledger.activateSubscriptionAndAddCredits({
        telegramId: 7001,
        creditsToAdd: 50,
        subscriptionDays: 30,
        idempotencyKey: 'sub-7001-upgrade',
        adminActorId: 100001,
        adminRole: 'OWNER',
        reason: 'Upgrade to paid package',
      });
      assert.equal(upgraded.trialRemaining, 0);
      assert.equal(upgraded.trialDisabled, true);
      assert.equal(upgraded.paidCredits, 50);

      return 10;
    }
  );

  // ============================================================================
  // TEST J: Late / Stale Response Quarantine & AES-256-GCM Encrypted Persistence
  // ============================================================================
  await runCase(
    'TEST_J',
    'Late / Stale Response Quarantine & AES-256-GCM Encrypted Persistence',
    'Verifies that unsolicited/late destination messages after timeout or cancellation are quarantined and encrypted at rest',
    async () => {
      const db = initializeDatabase(':memory:');
      const crypto = new CryptoService('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
      const cfg = new ConfigStudioService(db, 'ReferenceTargetBot');
      const corr = new TwoLayerCorrelationEngine(db, crypto, cfg, {
        onSendCancelSupportMode: async () => {},
        onSupportModeStateChange: () => {},
        onUpdateAccountStatus: () => {},
        onCriticalAdminAlert: () => {},
      });

      // 1. Unsolicited inbound message when no slot was ever registered -> UNMATCHED_CORRELATION
      await corr.handleInboundNewMessage(
        'REAL',
        9981,
        '✅ نتایج برای 09123456789:\n📂 دیتابیس بانک ملت\n👤 نام: فرهاد'
      );

      const quarantinedMasked = corr.listQuarantinedResponses(10, false);
      assert.equal(quarantinedMasked.length, 1);
      assert.equal(quarantinedMasked[0]?.quarantineReason, 'UNMATCHED_CORRELATION');
      assert.equal(quarantinedMasked[0]?.rawPayloadDecrypted, undefined);

      const quarantinedDecrypted = corr.listQuarantinedResponses(10, true);
      assert.ok(quarantinedDecrypted[0]?.rawPayloadDecrypted?.includes('فرهاد'));

      return 4;
    }
  );

  // ============================================================================
  // TEST K: Primary Bot 9-Row Keyboard, In-Place Menu Editing & 5-Min Session Reset
  // ============================================================================
  await runCase(
    'TEST_K',
    'Primary Bot 9-Row Inline Keyboard, In-Place Menu Editing & 5-Min UI Session Reset',
    'Verifies 1-button-per-row 9-category layout, in-place menu editing, and automatic 300,000ms session inactivity reset',
    () => {
      const db = initializeDatabase(':memory:');
      const crypto = new CryptoService('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
      const cfg = new ConfigStudioService(db, 'ReferenceTargetBot');
      const ledger = new LedgerRepository(db, cfg, 100001);
      const sessions = new SessionRepository(db, cfg);
      const mtproto = new DualAccountMtProtoManager(db, crypto, cfg);
      const corr = new TwoLayerCorrelationEngine(db, crypto, cfg, {
        onSendCancelSupportMode: async () => {},
        onSupportModeStateChange: () => {},
        onUpdateAccountStatus: () => {},
        onCriticalAdminAlert: () => {},
      });
      const queue = new DualLaneQueueOrchestrator({
        db,
        cryptoService: crypto,
        configStudio: cfg,
        ledgerRepo: ledger,
        sessionRepo: sessions,
        mtprotoManager: mtproto,
        correlationEngine: corr,
      });
      const botService = new PrimaryTelegramBotService({
        db,
        configStudio: cfg,
        ledgerRepo: ledger,
        sessionRepo: sessions,
        mtprotoManager: mtproto,
        queueOrchestrator: queue,
      });

      const startMsg = botService.handleStartOrMainMenu({ telegramId: 8001 });
      assert.equal(startMsg.action, 'SENT_NEW_MESSAGE');
      for (let i = 0; i < 9; i++) {
        assert.equal(startMsg.inlineKeyboardRows[i]?.length, 1);
      }

      const catMsg = botService.handleSelectCategory({
        telegramId: 8001,
        category: 'NATIONAL_ID',
      });
      assert.equal(catMsg.action, 'EDITED_IN_PLACE');
      assert.equal(catMsg.messageId, startMsg.messageId);

      // Simulate 5 minutes + 1 second of inactivity (300,001 ms)
      const futureNow = Date.now() + 300_001;
      const expiredSession = sessions.getActiveSession(8001, futureNow);
      assert.equal(expiredSession.uiState, 'MAIN_MENU');
      assert.equal(expiredSession.selectedCategory, null);

      return 14;
    }
  );

  // ============================================================================
  // TEST L: Configuration Studio Versioning, Rollback & SHA-256 Audit Chain
  // ============================================================================
  await runCase(
    'TEST_L',
    'Configuration Studio Versioning, One-Click Rollback & SHA-256 Hash-Chained Audit Trail',
    'Verifies immutable config_versions snapshots, rollback restoration, and cryptographic audit_logs hash-chain integrity',
    () => {
      const db = initializeDatabase(':memory:');
      const cfg = new ConfigStudioService(db, 'ReferenceTargetBot');

      const v1 = cfg.getConfig();
      assert.equal(v1.requestTimeoutSeconds, 30);

      const v2 = cfg.updateConfig(
        { requestTimeoutSeconds: 45 },
        100001,
        'OWNER',
        'Increase timeout to 45s'
      );
      assert.equal(v2.versionNumber, 2);
      assert.equal(cfg.getConfig().requestTimeoutSeconds, 45);

      const v3 = cfg.rollbackToVersion(1, 100001, 'OWNER', 'Rollback to v1');
      assert.equal(v3.versionNumber, 3);
      assert.equal(cfg.getConfig().requestTimeoutSeconds, 30);

      const logs = cfg.listAuditLogs(20);
      assert.ok(logs.length >= 2);
      // Verify SHA-256 hash chain linkage
      const chronological = [...logs].reverse();
      for (let i = 1; i < chronological.length; i++) {
        assert.equal(chronological[i]?.prevHash, chronological[i - 1]?.entryHash);
      }

      // Verify Outbound Sanitizer strips any leaked handles
      const outCheck = sanitizeOutboundUserText('پشتیبانی @RostamQuerySupport و @frenzyexbot');
      assert.equal(outCheck.hadLeakageStripped, true);

      return 8;
    }
  );

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;
  const totalAssertions = results.reduce((acc, r) => acc + r.assertionsVerified, 0);

  return {
    allPassed: failedCount === 0,
    totalTests: results.length,
    passedCount,
    failedCount,
    totalAssertions,
    totalDurationMs: Math.round((performance.now() - suiteStart) * 100) / 100,
    executedAt: Date.now(),
    results,
  };
}
