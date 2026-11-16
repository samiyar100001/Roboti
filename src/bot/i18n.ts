import type { UserRecord } from '../db/ledgerRepository';
import { toPersianDigits } from '../utils/normalizer';
import type { SearchCategory } from '../validation/validators';

export type SupportedLocale = 'fa' | 'en';

export interface CategoryPromptMetadata {
  category: SearchCategory;
  buttonLabelFa: string;
  titleFa: string;
  instructionFa: string;
  acceptedExamples: string[];
  rejectedExamples: string[];
}

/**
 * Strict 9-Category Metadata & Original White-Label User Guide (Section 4.3).
 * Never copies raw destination bot text and never leaks destination support handles.
 */
export const NINE_CATEGORY_METADATA: Readonly<Record<SearchCategory, CategoryPromptMetadata>> = {
  PHONE: {
    category: 'PHONE',
    buttonLabelFa: '📱 جستجو با شماره موبایل (ایران و روسیه)',
    titleFa: '📱 استعلام با شماره موبایل (ایران و روسیه)',
    instructionFa:
      'لطفاً شماره موبایل مورد نظر را بدون فاصله، پرانتز یا خط تیره ارسال نمایید.\n' +
      '• شمارههای ایران با 09، 989 یا +989 و شمارههای روسیه با 79 یا +79 پذیرفته میشوند.\n' +
      '• ارقام فارسی (۰-۹) و عربی (٠-٩) بهصورت خودکار استانداردسازی میشوند.',
    acceptedExamples: ['09123456789', '+989123456789', '79186328959', '۰۹۳۸۰۵۵۱۹۰۵'],
    rejectedExamples: ['9123456789 (بدون صفر)', '+79 186328959 (دارای فاصله)'],
  },
  NATIONAL_ID: {
    category: 'NATIONAL_ID',
    buttonLabelFa: '🪪 جستجو با کد ملی (۱۰ رقمی)',
    titleFa: '🪪 استعلام با کد ملی (۱۰ رقمی)',
    instructionFa:
      'لطفاً کد ملی ۱۰ رقمی را بهصورت پیوسته و بدون خط تیره ارسال فرمایید.\n' +
      '• صحت ساختار کد ملی بر اساس الگوریتم کنترلی (Modulo-11) پیش از ارسال بررسی میگردد.',
    acceptedExamples: ['0012345678', '1234567890'],
    rejectedExamples: ['123456789 (۹ رقمی)', '12345678901 (۱۱ رقمی)'],
  },
  TELEGRAM_ID: {
    category: 'TELEGRAM_ID',
    buttonLabelFa: '🆔 جستجو با آیدی عددی تلگرام',
    titleFa: '🆔 استعلام با آیدی عددی تلگرام',
    instructionFa:
      'لطفاً شناسه عددی (Numeric ID) حساب تلگرام را فقط بهصورت ارقام عددی (۵ تا ۱۰ رقم) بدون علامت @ یا حروف ارسال نمایید.',
    acceptedExamples: ['123456789', '54321678'],
    rejectedExamples: ['@123456', 'abc12345'],
  },
  BANK_CARD: {
    category: 'BANK_CARD',
    buttonLabelFa: '💳 جستجو با شماره کارت بانکی (۱۶ رقمی)',
    titleFa: '💳 استعلام با شماره کارت بانکی (۱۶ رقمی)',
    instructionFa:
      'لطفاً شماره ۱۶ رقمی کارت بانکی را بهصورت پیوسته (بدون فاصله یا خط تیره) وارد نمایید.\n' +
      '• صحت شماره کارت توسط الگوریتم استاندارد بانکی (Luhn) بررسی میشود.',
    acceptedExamples: ['6104337803287067'],
    rejectedExamples: ['6104-3378-0328-7067', '610433780328 (کمتر از ۱۶ رقم)'],
  },
  IBAN: {
    category: 'IBAN',
    buttonLabelFa: '🏦 جستجو با شماره شبا (۲۴ رقمی بدون IR)',
    titleFa: '🏦 استعلام با شماره شبا (۲۴ رقمی بدون IR)',
    instructionFa:
      'لطفاً فقط ۲۴ رقم عددی شماره شبا را **بدون پیشوند IR** و بدون فاصله ارسال نمایید.',
    acceptedExamples: ['200560611828005564089101'],
    rejectedExamples: ['IR200560611828005564089101 (دارای پیشوند IR)'],
  },
  IPV4: {
    category: 'IPV4',
    buttonLabelFa: '🌐 جستجو با آدرس آیپی (IPv4)',
    titleFa: '🌐 استعلام با آدرس آیپی (IPv4)',
    instructionFa:
      'لطفاً آدرس IPv4 را در قالب ۴ بخش عددی جداشده با نقطه (هر بخش بین 0 تا 255 بدون صفر ابتدایی) وارد نمایید.',
    acceptedExamples: ['192.15.99.72', '8.8.8.8'],
    rejectedExamples: ['256.10.1.1', '192.168.01.1 (دارای صفر ابتدایی)'],
  },
  USERNAME: {
    category: 'USERNAME',
    buttonLabelFa: '📌 جستجو با یوزرنیم تلگرام (@Username)',
    titleFa: '📌 استعلام با یوزرنیم تلگرام (@Username)',
    instructionFa:
      'لطفاً نام کاربری تلگرام را همراه با علامت @ در ابتدا (شامل ۵ تا ۳۲ کاراکتر انگلیسی، عدد یا زیرخط) ارسال نمایید.',
    acceptedExamples: ['@username', '@telegram_user1'],
    rejectedExamples: ['username (بدون @)', '@ab (کمتر از ۵ کاراکتر)'],
  },
  EMAIL: {
    category: 'EMAIL',
    buttonLabelFa: '📧 جستجو با آدرس ایمیل',
    titleFa: '📧 استعلام با آدرس پست الکترونیکی (Email)',
    instructionFa:
      'لطفاً آدرس ایمیل کامل و معتبر (شامل @ و دامنه استاندارد) را وارد نمایید.',
    acceptedExamples: ['user.example@domain.com'],
    rejectedExamples: ['userdomain.com', 'user@domain'],
  },
  FULL_NAME: {
    category: 'FULL_NAME',
    buttonLabelFa: '👤 جستجو با نام و نام خانوادگی (فارسی)',
    titleFa: '👤 استعلام با نام و نام خانوادگی (فارسی)',
    instructionFa:
      'لطفاً نام و نام خانوادگی را فقط با حروف فارسی و حداقل شامل دو بخش مجزا با فاصله ارسال فرمایید.',
    acceptedExamples: ['علی احمدی', 'سید محمد حسینی'],
    rejectedExamples: ['Ali Ahmadi (حروف لاتین)', 'علی (تککلمهای)'],
  },
};

export const ORDERED_NINE_CATEGORIES: readonly SearchCategory[] = [
  'PHONE',
  'NATIONAL_ID',
  'TELEGRAM_ID',
  'BANK_CARD',
  'IBAN',
  'IPV4',
  'USERNAME',
  'EMAIL',
  'FULL_NAME',
];

/**
 * Renders the `/start` Welcome Dashboard showing User ID, Account Tier (Subscribed vs. Trial),
 * and Remaining Credits / Trial Quota.
 */
export function renderWelcomeDashboardText(user: UserRecord, locale: SupportedLocale = 'fa'): string {
  if (locale === 'en') {
    const tier =
      user.subscriptionActive || user.paidCredits > 0
        ? 'Subscribed / Paid Tier (REAL_LANE)'
        : 'Free Trial Tier (TEST_LANE)';
    const balance =
      user.subscriptionActive || user.paidCredits > 0
        ? `${user.paidCredits} Paid Credits`
        : `${user.trialRemaining} / ${user.trialInitial} Free Trial Queries`;

    return (
      `💠 Sovereign Intelligence & Inquiry Relay\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🔹 User ID: \`${user.telegramId}\`\n` +
      `🔹 Account Tier: ${tier}\n` +
      `🔹 Available Balance: ${balance}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Select one of the 9 specialized search categories below or submit your query directly:`
    );
  }

  const isSubscribedTier = user.subscriptionActive || user.paidCredits > 0;
  const tierLabelFa = isSubscribedTier
    ? '🌟 اشتراک ویژه / اعتبار اختصاصی (مسیر اصلی)'
    : '🧪 حساب آزمایشی رایگان (مسیر تست)';

  const balanceLineFa = isSubscribedTier
    ? `🔹 اعتبار اختصاصی باقیمانده: ${toPersianDigits(user.paidCredits)} استعلام`
    : `🔹 سهمیه آزمایشی باقیمانده: ${toPersianDigits(user.trialRemaining)} از ${toPersianDigits(user.trialInitial)} استعلام`;

  return (
    `💠 سامانه هوشمند استعلام و تحلیل یکپارچه\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 شناسه کاربری شما: \`${user.telegramId}\`\n` +
    `🏷 سطح دسترسی: ${tierLabelFa}\n` +
    `${balanceLineFa}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `لطفاً یکی از ۹ دسته استعلام تخصصی زیر را از منوی شیشهای انتخاب فرمایید:`
  );
}

/**
 * Renders the category instruction prompt when a user clicks one of the 9 inline buttons.
 */
export function renderCategorySelectionPrompt(category: SearchCategory): string {
  const meta = NINE_CATEGORY_METADATA[category];
  const validLines = meta.acceptedExamples.map((ex) => `  ✅ \`${ex}\``).join('\n');
  const invalidLines = meta.rejectedExamples.map((ex) => `  ❌ \`${ex}\``).join('\n');

  return (
    `${meta.titleFa}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `${meta.instructionFa}\n\n` +
    `📌 نمونههای صحیح:\n${validLines}\n\n` +
    `🚫 نمونههای نامعتبر:\n${invalidLines}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `✍️ اکنون مقدار مورد نظر خود را ارسال فرمایید (یا جهت بازگشت از دکمه زیر استفاده کنید):`
  );
}

/**
 * Renders the polished, original `/help` user guide detailing all 9 categories with
 * accepted and rejected examples (never copying raw destination bot text or leaking support IDs).
 */
export function renderOriginalHelpGuideFa(): string {
  const sections = ORDERED_NINE_CATEGORIES.map((cat, idx) => {
    const meta = NINE_CATEGORY_METADATA[cat];
    return (
      `${toPersianDigits(idx + 1)}. ${meta.titleFa}\n` +
      `   • نمونه معتبر: \`${meta.acceptedExamples[0]}\`\n` +
      `   • نمونه نامعتبر: \`${meta.rejectedExamples[0]}\``
    );
  });

  return (
    `📘 راهنمای جامع استفاده از سامانه استعلام هوشمند\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `تمامی ورودیها پیش از ارسال به هسته پردازش، اعتبارسنجی و استانداردسازی میشوند:\n\n` +
    `${sections.join('\n\n')}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💡 قوانین مالی و سهمیه:\n` +
    `• در صورت عدم یافتن نتیجه («هیچ رکوردی یافت نشد»)، خطای فنی یا لغو درخواست در صف (/cancel)، هیچ سهمیه یا اعتباری از حساب شما کسر نمیگردد.\n` +
    `• دستورات کاربردی: /start (منوی اصلی) | /status (وضعیت صف) | /cancel (لغو درخواست)`
  );
}
