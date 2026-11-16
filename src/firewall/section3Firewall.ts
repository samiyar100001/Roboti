import {
  normalizeNumeralsToAscii,
  normalizePersianOrthography,
  stripEmojiVariationSelectors,
} from '../utils/normalizer';

export type Section3SignatureId =
  | '3.1_PROFILE_SUBSCRIPTION_STATUS'
  | '3.2_MEMBERSHIP_CONFIRMATION'
  | '3.3_SUPPORT_MODE_ACTIVATION'
  | '3.3_SUPPORT_MODE_DEACTIVATION'
  | '3.4_PRIVACY_OPT_OUT_NOTICE'
  | '3.5_SUBSCRIPTION_PAYMENT_FLOW'
  | '3.6_DATABASE_LIST_STATS'
  | '3.7_DESTINATION_HELP_GUIDE';

export interface ProfileTelemetryData {
  destinationAccountId?: string;
  remainingQueries?: number;
  totalQueries?: number;
  remainingDays?: number;
  profileExpiredAlert: boolean;
}

export interface Section3InterceptionResult {
  blocked: boolean;
  signatureId?: Section3SignatureId;
  requiresSupportModeCancelDispatch: boolean;
  isSupportModeDeactivated: boolean;
  telemetry?: ProfileTelemetryData;
}

export function inspectSection3Firewall(rawMessageText: string): Section3InterceptionResult {
  const normalized = normalizeNumeralsToAscii(
    normalizePersianOrthography(stripEmojiVariationSelectors(rawMessageText))
  ).trim();

  if (!normalized) {
    return {
      blocked: false,
      requiresSupportModeCancelDispatch: false,
      isSupportModeDeactivated: false,
    };
  }

  if (
    normalized.includes('حالت پشتیبانی فعال شد') ||
    (normalized.includes('از این لحظه هر پیامی ارسال کنی برای ادمین میره') &&
      (normalized.includes('/exit') || normalized.includes('/cancel')))
  ) {
    return {
      blocked: true,
      signatureId: '3.3_SUPPORT_MODE_ACTIVATION',
      requiresSupportModeCancelDispatch: true,
      isSupportModeDeactivated: false,
    };
  }

  if (normalized.includes('حالت پشتیبانی خاموش شد')) {
    return {
      blocked: true,
      signatureId: '3.3_SUPPORT_MODE_DEACTIVATION',
      requiresSupportModeCancelDispatch: false,
      isSupportModeDeactivated: true,
    };
  }

  if (
    normalized.includes('بات جستجوی حرفه') &&
    normalized.includes('کاملترین دیتابیس ایرانی') &&
    normalized.includes('اطلاعات شما')
  ) {
    const telemetry: ProfileTelemetryData = {
      profileExpiredAlert: normalized.includes('دسترسی شما منقضی شده است'),
    };

    const idMatch = /آیدی\s*:\s*(\d+)/.exec(normalized);
    if (idMatch?.[1]) {
      telemetry.destinationAccountId = idMatch[1];
    }

    const daysMatch = /\(\s*(\d+)\s*روز باقی\s*مانده\s*\)/.exec(normalized);
    if (daysMatch?.[1]) {
      telemetry.remainingDays = Number(daysMatch[1]);
    }

    const quotaMatch = /جستجو\s*:\s*(\d+)\s*از\s*(\d+)\s*باقی\s*مانده/.exec(normalized);
    if (quotaMatch?.[1] && quotaMatch?.[2]) {
      telemetry.remainingQueries = Number(quotaMatch[1]);
      telemetry.totalQueries = Number(quotaMatch[2]);
    }

    return {
      blocked: true,
      signatureId: '3.1_PROFILE_SUBSCRIPTION_STATUS',
      requiresSupportModeCancelDispatch: false,
      isSupportModeDeactivated: false,
      telemetry,
    };
  }

  if (
    normalized.includes('عضویت تایید شد') ||
    normalized.includes('عضویت تأیید شد') ||
    normalized.includes('حالا دسترسی کامل داری. شروع کن')
  ) {
    return {
      blocked: true,
      signatureId: '3.2_MEMBERSHIP_CONFIRMATION',
      requiresSupportModeCancelDispatch: false,
      isSupportModeDeactivated: false,
    };
  }

  if (
    normalized.includes('تعهد جدی ما به حریم خصوصی و امنیت کاربران') ||
    (normalized.includes('حریم خصوصی') && normalized.includes('@RostamQuerySupport'))
  ) {
    return {
      blocked: true,
      signatureId: '3.4_PRIVACY_OPT_OUT_NOTICE',
      requiresSupportModeCancelDispatch: false,
      isSupportModeDeactivated: false,
    };
  }

  if (
    normalized.includes('پکیج انتخاب شد:') ||
    normalized.includes('اطلاعات پرداخت / شبکه: BSC (BEP20)') ||
    normalized.includes('پرداخت ریالی (ترون) / شبکه: (TRC20)') ||
    normalized.includes('@frenzyexbot') ||
    normalized.includes('ارسال هش تراکنش ترون') ||
    normalized.includes('فاکتور شما تشکیل شد.') ||
    normalized.includes('استارز رو پرداخت کنید') ||
    normalized.includes('پرداخت با موفقیت تایید شد!') ||
    normalized.includes('پرداخت با موفقیت تأیید شد!')
  ) {
    return {
      blocked: true,
      signatureId: '3.5_SUBSCRIPTION_PAYMENT_FLOW',
      requiresSupportModeCancelDispatch: false,
      isSupportModeDeactivated: false,
    };
  }

  if (
    normalized.includes('لیست دیتابیس های استفاده شده:') ||
    normalized.includes('لیست دیتابیسهای استفاده شده:') ||
    normalized.includes('آمار دیتابیسها:') ||
    normalized.includes('آمار دیتابیس ها:')
  ) {
    return {
      blocked: true,
      signatureId: '3.6_DATABASE_LIST_STATS',
      requiresSupportModeCancelDispatch: false,
      isSupportModeDeactivated: false,
    };
  }

  if (
    normalized.includes('راهنمای خرید و استفاده از بات') ||
    normalized.includes('برای گرفتن خروجیهای تمیز و بدون مشکل') ||
    normalized.includes('برای گرفتن خروجی های تمیز و بدون مشکل')
  ) {
    return {
      blocked: true,
      signatureId: '3.7_DESTINATION_HELP_GUIDE',
      requiresSupportModeCancelDispatch: false,
      isSupportModeDeactivated: false,
    };
  }

  return {
    blocked: false,
    requiresSupportModeCancelDispatch: false,
    isSupportModeDeactivated: false,
  };
}
