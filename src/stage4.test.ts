import test from 'node:test';
import assert from 'node:assert/strict';
import { CryptoService } from './crypto/aesGcm';
import { initializeDatabase } from './db/database';
import { ConfigStudioService } from './db/configStudio';
import { LedgerRepository } from './db/ledgerRepository';
import { SessionRepository } from './db/sessionRepository';
import { validateInputByCategory } from './validation/validators';
import { inspectSection3Firewall } from './firewall/section3Firewall';
import { evaluateSection4ErrorSignature } from './firewall/section4ErrorMachine';
import { parseDestinationPayloadToAst } from './parser/astParser';
import { renderWhiteLabelReportPages } from './parser/whiteLabelRenderer';
import { sanitizeOutboundUserText } from './firewall/outboundSanitizer';
import { TwoLayerCorrelationEngine } from './mtproto/correlationEngine';
import { DualAccountMtProtoManager } from './mtproto/accountWorker';
import { DualLaneQueueOrchestrator } from './queue/dualLaneQueue';
import { PrimaryTelegramBotService } from './bot/primaryBot';

test('Stage 2 & 3: Validators, AST Parser, White-Label Renderer & Section 3/4 Firewall', () => {
  // 1. Persian numeral normalization + 9 validators
  assert.equal(validateInputByCategory('PHONE', '۰۹۳۸۰۵۵۱۹۰۵').valid, true);
  assert.equal(validateInputByCategory('PHONE', '۰۹۳۸۰۵۵۱۹۰۵').normalizedValue, '09380551905');
  assert.equal(validateInputByCategory('PHONE', '9123456789').valid, false);
  assert.equal(validateInputByCategory('NATIONAL_ID', '0012345678').valid, true);
  assert.equal(validateInputByCategory('TELEGRAM_ID', '123456789').valid, true);
  assert.equal(validateInputByCategory('BANK_CARD', '6104337803287067').valid, true);
  assert.equal(validateInputByCategory('IBAN', '200560611828005564089101').valid, true);
  assert.equal(validateInputByCategory('IBAN', 'IR200560611828005564089101').valid, false);
  assert.equal(validateInputByCategory('IPV4', '192.15.99.72').valid, true);
  assert.equal(validateInputByCategory('IPV4', '192.168.01.1').valid, false);
  assert.equal(validateInputByCategory('USERNAME', '@username').valid, true);
  assert.equal(validateInputByCategory('EMAIL', 'user.example@domain.com').valid, true);
  assert.equal(validateInputByCategory('FULL_NAME', 'علی احمدی').valid, true);

  // 2. Example 1 from Master Prompt PDF (Page 17)
  const rawPayload = `
✅ نتایج برای 09123456789:
در حال ارسال نتایج (2 رکورد)...
بخش 1:
📂 دیتابیس بانک ملت
👤 نام: علی
👤 نامخانوادگی: محمدی
👪 نام پدر: حسن
🆔 کد ملی: 0012345678
📱 شماره موبایل: 09123456789
💳 شماره کارت: 6104337803287067
🏦 شماره حساب: 1234567890
───────────────────────────
📂 دیتابیس فروشندگان ترب
👤 اطلاعات کاربر:
👤 نام کامل: علی محمدی
📞 تلفن ثابت: 02188776655
🌍 استان: تهران
🏙 شهر: تهران
📮 کدپستی: 1415563111
📅 تاریخ عضویت در ترب: 1401/05/12
🔸 فیلد ۹: تایید شده
  `;

  const ast = parseDestinationPayloadToAst([rawPayload]);
  assert.equal(ast.isValidPositivePayload, true);
  assert.equal(ast.records.length, 2);
  assert.equal(ast.records[0]?.sourceType, 'SOURCE_BANK_MELLAT');
  assert.equal(ast.records[1]?.sourceType, 'SOURCE_TOROB');
  assert.equal(ast.records[1]?.extraFields['فیلد ۹'], 'تایید شده');

  const pages = renderWhiteLabelReportPages(ast, { referenceCode: 'REQ-904112' });
  assert.equal(pages.length, 1);
  assert.ok(pages[0]?.includes('🏛 مرجع ۱: سامانه اطلاعات بانکی (ملت)'));
  assert.ok(pages[0]?.includes('├─ نام: علی'));
  assert.ok(pages[0]?.includes('╰─ اطلاعات تکمیلی (فیلد ۹): تایید شده'));
  assert.equal(pages[0]?.includes('📂 دیتابیس'), false);
});

test('Stage 4: Dual-Account Isolation, Behavior A/B Correlation, 5s Collection & Quarantine', async () => {
  const db = initializeDatabase(':memory:');
  const cryptoService = new CryptoService('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
  const configStudio = new ConfigStudioService(db, 'ReferenceTargetBot');
  // Set short collectionWindowMs (1000ms) for fast deterministic unit testing
  configStudio.updateConfig(
    { collectionWindowMs: 1000, requestTimeoutSeconds: 10 },
    1001,
    'OWNER',
    'Fast test timing'
  );

  const ledgerRepo = new LedgerRepository(db, configStudio, 1001);
  const sessionRepo = new SessionRepository(db, configStudio);
  const mtprotoManager = new DualAccountMtProtoManager(db, cryptoService, configStudio);

  let supportModeCancelledOn: string | null = null;
  const correlationEngine = new TwoLayerCorrelationEngine(db, cryptoService, configStudio, {
    onSendCancelSupportMode: async (lane) => {
      supportModeCancelledOn = lane;
      await mtprotoManager.dispatchSupportModeExitCommands(lane);
    },
    onSupportModeStateChange: (lane, active) => {
      mtprotoManager.setSupportModeLock(lane, active);
    },
    onUpdateAccountStatus: (lane, status, telemetry) => {
      mtprotoManager.updateAccountConnectionStatus(lane, status, telemetry);
    },
    onCriticalAdminAlert: () => {},
  });
  mtprotoManager.bindCorrelationEngine(correlationEngine);

  // Mark both accounts CONNECTED
  mtprotoManager.updateAccountConnectionStatus('REAL', 'CONNECTED');
  mtprotoManager.updateAccountConnectionStatus('TEST', 'CONNECTED');

  let outboundSeq = 500;
  mtprotoManager.setCustomDispatchAdapter({
    sendMessageToDestination: async (_lane, destinationPeer) => {
      outboundSeq += 1;
      return { outboundMsgId: outboundSeq, destinationChatId: destinationPeer };
    },
  });

  const queue = new DualLaneQueueOrchestrator({
    db,
    cryptoService,
    configStudio,
    ledgerRepo,
    sessionRepo,
    mtprotoManager,
    correlationEngine,
  });

  const deliveredMessages: string[] = [];
  queue.bindPrimaryBotDeliveryAdapter({
    sendInitialSearchingStatus: async (_tid, text) => {
      deliveredMessages.push(text);
      return 701;
    },
    editSearchingStatusMessage: async (_tid, _msgId, newText) => {
      deliveredMessages.push(newText);
      return true;
    },
    deleteSearchingStatusMessage: async () => {},
    sendPaginatedResultMessages: async (_tid, pages) => {
      deliveredMessages.push(...pages);
    },
  });

  // 1. Test Section 3.3 Support Mode Self-Healing
  await correlationEngine.handleInboundNewMessage(
    'TEST',
    501,
    '✅ حالت پشتیبانی فعال شد / از این لحظه هر پیامی ارسال کنی برای ادمین میره. / برای خروج: /exit /cancel'
  );
  assert.equal(supportModeCancelledOn, 'TEST');
  assert.equal(mtprotoManager.getAccountState('TEST').supportModeLocked, true);

  await correlationEngine.handleInboundNewMessage('TEST', 502, '✅ حالت پشتیبانی خاموش شد.');
  assert.equal(mtprotoManager.getAccountState('TEST').supportModeLocked, false);

  // 2. Submit Trial User Search (routed to TEST_LANE) & simulate Behavior B (Edit temp search msg into result)
  const submitRes = await queue.submitSearchRequest({
    telegramId: 2002,
    username: 'trial_user',
    firstName: 'Trial',
    category: 'PHONE',
    rawInput: '09123456789',
    userMessageId: 11,
  });
  assert.equal(submitRes.accepted, true);
  assert.equal(submitRes.request?.accountLane, 'TEST');

  // Wait a tick for worker to dispatch and register slot
  await new Promise((r) => setTimeout(r, 25));
  const activeSlot = correlationEngine.getActiveSlot('TEST');
  assert.ok(activeSlot !== null);

  const tempMsgId = activeSlot.outboundGramJsMessageId + 1;
  // Destination sends temporary searching indicator
  await correlationEngine.handleInboundNewMessage('TEST', tempMsgId, '🔍 در حال جستجو... ⏳');
  assert.equal(correlationEngine.getActiveSlot('TEST')?.tempSearchingMessageId, tempMsgId);

  // Behavior B: Destination edits temporary message in-place into valid result
  await correlationEngine.handleInboundMessageEdited(
    'TEST',
    tempMsgId,
    '✅ نتایج برای 09123456789:\n📂 دیتابیس ایرانسل\n👤 نام: رضا\n👤 نام خانوادگی: کریمی\n📱 موبایل: 09123456789'
  );

  // Force finalize collection window for fast test completion
  correlationEngine.finalizeCollectionWindow('TEST', activeSlot.requestId);
  await new Promise((r) => setTimeout(r, 25));

  const completedReq = queue.getRequestById(activeSlot.requestId);
  assert.equal(completedReq?.state, 'COMPLETED');
  assert.equal(completedReq?.quotaOrCreditDeducted, 1);

  const userAfter = ledgerRepo.getUserById(2002);
  assert.equal(userAfter?.trialRemaining, 2);

  // 3. Verify Subscription Activation sets trial_remaining = 0 and trial_disabled = 1 without merging trial into paid credits
  const subUser = ledgerRepo.activateSubscriptionAndAddCredits({
    telegramId: 2002,
    creditsToAdd: 50,
    subscriptionDays: 30,
    idempotencyKey: 'sub_tx_1',
    adminActorId: 1001,
    adminRole: 'OWNER',
    reason: 'Purchased 50 credit package',
  });
  assert.equal(subUser.trialRemaining, 0);
  assert.equal(subUser.trialDisabled, true);
  assert.equal(subUser.paidCredits, 50);

  // 4. Verify Outbound Sanitizer strips any leaked handles
  const sanitized = sanitizeOutboundUserText('تماس با @RostamQuerySupport و ربات @frenzyexbot');
  assert.equal(sanitized.hadLeakageStripped, true);
  assert.equal(sanitized.cleanText.includes('@RostamQuerySupport'), false);
  assert.equal(sanitized.cleanText.includes('@frenzyexbot'), false);
});

test('Stage 5: Primary GrammY Bot, 9-Row Keyboard, In-Place Menu Editing, RBAC & 5-Min Session Reset', () => {
  const db = initializeDatabase(':memory:');
  const cryptoService = new CryptoService('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
  const configStudio = new ConfigStudioService(db, 'ReferenceTargetBot');
  const ledgerRepo = new LedgerRepository(db, configStudio, 100001);
  const sessionRepo = new SessionRepository(db, configStudio);
  const mtprotoManager = new DualAccountMtProtoManager(db, cryptoService, configStudio);
  const correlationEngine = new TwoLayerCorrelationEngine(db, cryptoService, configStudio, {
    onSendCancelSupportMode: async () => {},
    onSupportModeStateChange: () => {},
    onUpdateAccountStatus: () => {},
    onCriticalAdminAlert: () => {},
  });
  const queueOrchestrator = new DualLaneQueueOrchestrator({
    db,
    cryptoService,
    configStudio,
    ledgerRepo,
    sessionRepo,
    mtprotoManager,
    correlationEngine,
  });

  const botService = new PrimaryTelegramBotService({
    db,
    configStudio,
    ledgerRepo,
    sessionRepo,
    mtprotoManager,
    queueOrchestrator,
  });

  // 1. /start sends new message with 9-row category buttons (each category in its own single-button row)
  const startOut = botService.handleStartOrMainMenu({
    telegramId: 4001,
    username: 'ali_test',
    firstName: 'Ali',
    preferEditInPlace: false,
  });
  assert.equal(startOut.action, 'SENT_NEW_MESSAGE');
  assert.equal(startOut.uiState, 'MAIN_MENU');
  // First 9 rows correspond to the 9 categories, 1 button per row
  for (let i = 0; i < 9; i++) {
    assert.equal(startOut.inlineKeyboardRows[i]?.length, 1);
  }

  // 2. Selecting a category edits the existing menu message in place
  const catOut = botService.handleSelectCategory({
    telegramId: 4001,
    category: 'IBAN',
  });
  assert.equal(catOut.action, 'EDITED_IN_PLACE');
  assert.equal(catOut.messageId, startOut.messageId);
  assert.equal(catOut.selectedCategory, 'IBAN');
  assert.equal(catOut.uiState, 'AWAITING_CATEGORY_INPUT');

  // 3. Navigating back to main menu edits the same message ID in place
  const backOut = botService.handleStartOrMainMenu({
    telegramId: 4001,
    preferEditInPlace: true,
  });
  assert.equal(backOut.action, 'EDITED_IN_PLACE');
  assert.equal(backOut.messageId, startOut.messageId);
  assert.equal(backOut.selectedCategory, null);

  // 4. /admin RBAC check: regular user blocked, OWNER allowed
  const userAdminAttempt = botService.handleAdminControlCenter(4001, 'health');
  assert.ok(userAdminAttempt.textFa.includes('مجوز دسترسی'));

  const ownerAdminAttempt = botService.handleAdminControlCenter(100001, 'health');
  assert.ok(ownerAdminAttempt.textFa.includes('مرکز کنترل و مدیریت تلگرام'));
});

