import type {
  AccountLane,
  MtProtoConnectionStatus,
  RequestLifecycleState,
} from '../db/database';
import {
  normalizeNumeralsToAscii,
  normalizePersianOrthography,
  stripEmojiVariationSelectors,
} from '../utils/normalizer';

export type Section4ErrorSignatureId =
  | '4.1_NOT_FOUND'
  | '4.2_QUOTA_EXCEEDED'
  | '4.3_FREE_VERSION_MASKED_OUTPUT'
  | '4.4_INVALID_TX_HASH'
  | '4.5_ACCESS_DENIED'
  | '4.6_FREE_TRIAL_EXPIRED'
  | '4.7_PROFILE_EXPIRED'
  | '4.8_INVALID_OR_USED_CODE';

export interface Section4EvaluationResult {
  matched: boolean;
  signatureId?: Section4ErrorSignatureId;
  blockEntireMessage: boolean;
  stripMaskedWarningHeaderOnly: boolean;
  cleanedTextAfterStrip?: string;
  attachTrialWatermark: boolean;
  targetRequestState?: RequestLifecycleState;
  deductQuotaOrCredits: 0;
  newAccountConnectionStatus?: MtProtoConnectionStatus;
  fireCriticalAdminAlert: boolean;
  adminAlertMessage?: string;
  safeUserNoticeFa?: string;
}

const SAFE_TEMPORARILY_UNAVAILABLE_FA =
  '⚠️ سرویس استعلام در حال حاضر به دلیل بروزرسانی فنی موقتاً در دسترس نمیباشد. هیچ اعتباری از حساب شما کسر نشد. لطفاً دقایقی دیگر مجدداً تلاش فرمایید.';

export function evaluateSection4ErrorSignature(
  rawMessageText: string,
  accountLane: AccountLane
): Section4EvaluationResult {
  const normalized = normalizeNumeralsToAscii(
    normalizePersianOrthography(stripEmojiVariationSelectors(rawMessageText))
  ).trim();

  if (
    /^❌\s*هیچ رکوردی با\s*.+?\s*پیدا نشد\.?$/m.test(normalized) ||
    (normalized.includes('هیچ رکوردی با') && normalized.includes('پیدا نشد'))
  ) {
    return {
      matched: true,
      signatureId: '4.1_NOT_FOUND',
      blockEntireMessage: true,
      stripMaskedWarningHeaderOnly: false,
      attachTrialWatermark: false,
      targetRequestState: 'NO_RESULTS_FOUND',
      deductQuotaOrCredits: 0,
      fireCriticalAdminAlert: false,
      safeUserNoticeFa:
        'ℹ️ هیچ رکوردی مطابق با عبارت جستجو شده در سامانههای مرجع یافت نشد.\n✨ هیچ سهمیه یا اعتباری از حساب شما کسر نگردید.',
    };
  }

  if (normalized.includes('تعداد جستجوهای شما به پایان رسیده است')) {
    return {
      matched: true,
      signatureId: '4.2_QUOTA_EXCEEDED',
      blockEntireMessage: true,
      stripMaskedWarningHeaderOnly: false,
      attachTrialWatermark: false,
      targetRequestState: 'TEMPORARILY_UNAVAILABLE',
      deductQuotaOrCredits: 0,
      newAccountConnectionStatus: 'QUOTA_DEPLETED',
      fireCriticalAdminAlert: true,
      adminAlertMessage: `🚨 CRITICAL: ${accountLane} MTProto Account search quota on destination bot is depleted (Signature 4.2).`,
      safeUserNoticeFa: SAFE_TEMPORARILY_UNAVAILABLE_FA,
    };
  }

  if (
    normalized.includes('توجه مهم: پیامهای نسخه رایگان از بات') ||
    normalized.includes('توجه مهم: پیام های نسخه رایگان از بات') ||
    (normalized.includes('پیامهای نسخه رایگان') && normalized.includes('مخدوش شده')) ||
    (normalized.includes('پیام های نسخه رایگان') && normalized.includes('مخدوش شده'))
  ) {
    if (accountLane === 'REAL') {
      return {
        matched: true,
        signatureId: '4.3_FREE_VERSION_MASKED_OUTPUT',
        blockEntireMessage: true,
        stripMaskedWarningHeaderOnly: false,
        attachTrialWatermark: false,
        targetRequestState: 'TEMPORARILY_UNAVAILABLE',
        deductQuotaOrCredits: 0,
        newAccountConnectionStatus: 'UNSUBSCRIBED_MASKED',
        fireCriticalAdminAlert: true,
        adminAlertMessage:
          '🚨 CRITICAL: Real MTProto Account returned Free Version Masked Output Notice (Signature 4.3). Account marked UNSUBSCRIBED_MASKED.',
        safeUserNoticeFa: SAFE_TEMPORARILY_UNAVAILABLE_FA,
      };
    } else {
      const cleanedLines = rawMessageText.split(/\r?\n/).filter((line) => {
        const normLine = normalizePersianOrthography(stripEmojiVariationSelectors(line));
        if (normLine.includes('توجه مهم') && normLine.includes('نسخه رایگان')) return false;
        if (normLine.includes('مخدوش شده')) return false;
        if (normLine.includes('برای دریافت اطلاعات کامل') || normLine.includes('خرید اشتراک')) {
          return false;
        }
        return true;
      });
      const cleanedText = cleanedLines.join('\n').trim();
      const hasDataPayload = cleanedText.includes('✅ نتایج') || cleanedText.includes('📂 دیتابیس');

      return {
        matched: true,
        signatureId: '4.3_FREE_VERSION_MASKED_OUTPUT',
        blockEntireMessage: !hasDataPayload,
        stripMaskedWarningHeaderOnly: hasDataPayload,
        cleanedTextAfterStrip: cleanedText,
        attachTrialWatermark: true,
        deductQuotaOrCredits: 0,
        fireCriticalAdminAlert: false,
      };
    }
  }

  if (
    normalized.includes('فرمت هش تراکنش نامعتبر است') ||
    normalized.includes('هش صحیح (64 کاراکتر) را ارسال کنید')
  ) {
    return {
      matched: true,
      signatureId: '4.4_INVALID_TX_HASH',
      blockEntireMessage: true,
      stripMaskedWarningHeaderOnly: false,
      attachTrialWatermark: false,
      deductQuotaOrCredits: 0,
      fireCriticalAdminAlert: false,
      adminAlertMessage: 'WARN: Destination bot returned 4.4 Invalid Tx Hash internal noise.',
    };
  }

  if (/⛔\s*Access Denied!/i.test(normalized) || normalized.includes('Access Denied!')) {
    return {
      matched: true,
      signatureId: '4.5_ACCESS_DENIED',
      blockEntireMessage: true,
      stripMaskedWarningHeaderOnly: false,
      attachTrialWatermark: false,
      targetRequestState: 'TEMPORARILY_UNAVAILABLE',
      deductQuotaOrCredits: 0,
      newAccountConnectionStatus: 'UNAUTHORIZED',
      fireCriticalAdminAlert: true,
      adminAlertMessage: `🚨 CRITICAL: ${accountLane} MTProto Account received 4.5 Access Denied from destination bot.`,
      safeUserNoticeFa: SAFE_TEMPORARILY_UNAVAILABLE_FA,
    };
  }

  if (normalized.includes('مهلت استفاده رایگان شما تمام شده است')) {
    return {
      matched: true,
      signatureId: '4.6_FREE_TRIAL_EXPIRED',
      blockEntireMessage: true,
      stripMaskedWarningHeaderOnly: false,
      attachTrialWatermark: false,
      targetRequestState: 'TEMPORARILY_UNAVAILABLE',
      deductQuotaOrCredits: 0,
      newAccountConnectionStatus: 'TRIAL_EXPIRED',
      fireCriticalAdminAlert: true,
      adminAlertMessage: `🚨 CRITICAL: ${accountLane} MTProto Account free trial expired on destination bot (Signature 4.6).`,
      safeUserNoticeFa: SAFE_TEMPORARILY_UNAVAILABLE_FA,
    };
  }

  if (normalized.includes('دسترسی شما منقضی شده است')) {
    return {
      matched: true,
      signatureId: '4.7_PROFILE_EXPIRED',
      blockEntireMessage: true,
      stripMaskedWarningHeaderOnly: false,
      attachTrialWatermark: false,
      targetRequestState: 'TEMPORARILY_UNAVAILABLE',
      deductQuotaOrCredits: 0,
      newAccountConnectionStatus: 'ACCESS_EXPIRED',
      fireCriticalAdminAlert: true,
      adminAlertMessage: `🚨 CRITICAL: ${accountLane} MTProto Account profile access expired on destination bot (Signature 4.7).`,
      safeUserNoticeFa: SAFE_TEMPORARILY_UNAVAILABLE_FA,
    };
  }

  if (
    normalized.includes('این کد نامعتبره یا قبلا استفاده شده') ||
    normalized.includes('این کد نامعتبره یا قبلاً استفاده شده')
  ) {
    return {
      matched: true,
      signatureId: '4.8_INVALID_OR_USED_CODE',
      blockEntireMessage: true,
      stripMaskedWarningHeaderOnly: false,
      attachTrialWatermark: false,
      targetRequestState: 'FAILED',
      deductQuotaOrCredits: 0,
      fireCriticalAdminAlert: false,
      safeUserNoticeFa:
        '❌ درخواست ارسالی توسط سامانه مرجع پذیرفته نشد. هیچ اعتباری از حساب شما کسر نگردید.',
    };
  }

  return {
    matched: false,
    blockEntireMessage: false,
    stripMaskedWarningHeaderOnly: false,
    attachTrialWatermark: false,
    deductQuotaOrCredits: 0,
    fireCriticalAdminAlert: false,
  };
}
