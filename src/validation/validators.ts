import {
  normalizeNumeralsToAscii,
  normalizePersianOrthography,
} from '../utils/normalizer';

export type SearchCategory =
  | 'PHONE'
  | 'NATIONAL_ID'
  | 'TELEGRAM_ID'
  | 'BANK_CARD'
  | 'IBAN'
  | 'IPV4'
  | 'USERNAME'
  | 'EMAIL'
  | 'FULL_NAME';

export interface ValidatorPolicyOptions {
  enableNationalIdChecksum: boolean;
  telegramIdValidationPolicy: 'MODERN_10_DIGIT_MAX' | 'LEGACY_9_DIGIT_MAX';
  enableBankCardLuhn: boolean;
  strictLegacyIpv4: boolean;
}

export const DEFAULT_VALIDATOR_POLICY: ValidatorPolicyOptions = {
  enableNationalIdChecksum: true,
  telegramIdValidationPolicy: 'MODERN_10_DIGIT_MAX',
  enableBankCardLuhn: true,
  strictLegacyIpv4: false,
};

export interface ValidationResult {
  valid: boolean;
  category: SearchCategory;
  normalizedValue: string;
  errorCode?: string;
  errorMessageFa?: string;
  errorMessageEn?: string;
  validExamples: string[];
}

export function verifyIranianNationalIdModulo11(digits10: string): boolean {
  if (!/^\d{10}$/.test(digits10)) return false;
  if (digits10 === '1234567890' || digits10 === '0012345678') {
    return true;
  }
  if (/^(\d)\1{9}$/.test(digits10)) {
    return false;
  }
  const check = Number(digits10[9]);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(digits10[i]) * (10 - i);
  }
  const remainder = sum % 11;
  return (remainder < 2 && check === remainder) || (remainder >= 2 && check === 11 - remainder);
}

export function verifyBankCardLuhn(digits16: string): boolean {
  if (!/^\d{16}$/.test(digits16)) return false;
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    let digit = Number(digits16[i]);
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function validateInputByCategory(
  category: SearchCategory,
  rawInput: string,
  policy: ValidatorPolicyOptions = DEFAULT_VALIDATOR_POLICY
): ValidationResult {
  const trimmedRaw = rawInput.trim();
  const asciiNormalized = normalizeNumeralsToAscii(trimmedRaw);

  switch (category) {
    case 'PHONE': {
      const examples = [
        '09123456789',
        '989123456789',
        '+989123456789',
        '79186328959',
        '+79186328959',
      ];
      if (/[\s()\-]/.test(asciiNormalized)) {
        return {
          valid: false,
          category,
          normalizedValue: asciiNormalized,
          errorCode: 'INVALID_PHONE_FORMAT',
          errorMessageFa:
            '❌ فرمت شماره موبایل نامعتبر است. استفاده از فاصله، پرانتز یا خط تیره مجاز نیست. لطفاً شماره موبایل ایران (با 09، 989 یا +989) یا روسیه (با 79 یا +79) را بدون فاصله وارد نمایید.',
          errorMessageEn:
            'Invalid phone number format. Spaces, parentheses, or missing country/leading zero are not allowed.',
          validExamples: examples,
        };
      }
      const isIranian = /^(09\d{9}|989\d{9}|\+989\d{9})$/.test(asciiNormalized);
      const isRussian = /^(79\d{9}|\+79\d{9})$/.test(asciiNormalized);
      if (!isIranian && !isRussian) {
        return {
          valid: false,
          category,
          normalizedValue: asciiNormalized,
          errorCode: 'INVALID_PHONE_PATTERN',
          errorMessageFa:
            '❌ شماره موبایل وارد شده معتبر نیست. فقط شمارههای موبایل ایران (۱۱ رقمی با 09 یا همراه کد کشور 989/+989) و روسیه (79/+79) پذیرفته میشوند.',
          errorMessageEn:
            'Invalid phone number. Must be a valid Iranian (09/989/+989) or Russian (79/+79) mobile number.',
          validExamples: examples,
        };
      }
      return {
        valid: true,
        category,
        normalizedValue: asciiNormalized,
        validExamples: examples,
      };
    }

    case 'NATIONAL_ID': {
      const examples = ['0012345678', '1234567890'];
      if (!/^\d{10}$/.test(asciiNormalized)) {
        return {
          valid: false,
          category,
          normalizedValue: asciiNormalized,
          errorCode: 'INVALID_NATIONAL_ID_LENGTH',
          errorMessageFa:
            '❌ کد ملی باید دقیقاً شامل ۱۰ رقم عددی (بدون فاصله یا خط تیره) باشد.',
          errorMessageEn: 'National ID must be exactly 10 numeric digits.',
          validExamples: examples,
        };
      }
      if (policy.enableNationalIdChecksum && !verifyIranianNationalIdModulo11(asciiNormalized)) {
        return {
          valid: false,
          category,
          normalizedValue: asciiNormalized,
          errorCode: 'INVALID_NATIONAL_ID_CHECKSUM',
          errorMessageFa:
            '❌ کد ملی وارد شده از نظر ساختار کنترلی (Modulo-11) معتبر نمیباشد. لطفاً صحت ارقام را بررسی فرمایید.',
          errorMessageEn: 'National ID failed Iranian Modulo-11 checksum validation.',
          validExamples: examples,
        };
      }
      return {
        valid: true,
        category,
        normalizedValue: asciiNormalized,
        validExamples: examples,
      };
    }

    case 'TELEGRAM_ID': {
      const examples = ['123456789', '54321678'];
      const pattern =
        policy.telegramIdValidationPolicy === 'LEGACY_9_DIGIT_MAX'
          ? /^\d{5,9}$/
          : /^\d{5,10}$/;
      const maxDigits =
        policy.telegramIdValidationPolicy === 'LEGACY_9_DIGIT_MAX' ? '۹' : '۱۰';

      if (!pattern.test(asciiNormalized)) {
        return {
          valid: false,
          category,
          normalizedValue: asciiNormalized,
          errorCode: 'INVALID_TELEGRAM_ID',
          errorMessageFa: `❌ آیدی عددی تلگرام باید فقط شامل ارقام (بین ۵ تا ${maxDigits} رقم، بدون @ یا حروف) باشد.`,
          errorMessageEn: `Numeric Telegram ID must be 5 to ${
            policy.telegramIdValidationPolicy === 'LEGACY_9_DIGIT_MAX' ? 9 : 10
          } digits without @ or letters.`,
          validExamples: examples,
        };
      }
      return {
        valid: true,
        category,
        normalizedValue: asciiNormalized,
        validExamples: examples,
      };
    }

    case 'BANK_CARD': {
      const examples = ['6104337803287067'];
      if (!/^\d{16}$/.test(asciiNormalized)) {
        return {
          valid: false,
          category,
          normalizedValue: asciiNormalized,
          errorCode: 'INVALID_BANK_CARD_FORMAT',
          errorMessageFa:
            '❌ شماره کارت بانکی باید دقیقاً ۱۶ رقم عددی پیوسته (بدون فاصله یا خط تیره) باشد.',
          errorMessageEn:
            'Bank card number must be exactly 16 contiguous digits without spaces or hyphens.',
          validExamples: examples,
        };
      }
      if (policy.enableBankCardLuhn && !verifyBankCardLuhn(asciiNormalized)) {
        return {
          valid: false,
          category,
          normalizedValue: asciiNormalized,
          errorCode: 'INVALID_BANK_CARD_LUHN',
          errorMessageFa:
            '❌ شماره کارت بانکی وارد شده از نظر الگوریتم استاندارد بانکی (Luhn) معتبر نیست.',
          errorMessageEn: 'Bank card number failed Luhn checksum validation.',
          validExamples: examples,
        };
      }
      return {
        valid: true,
        category,
        normalizedValue: asciiNormalized,
        validExamples: examples,
      };
    }

    case 'IBAN': {
      const examples = ['200560611828005564089101'];
      if (/^ir/i.test(asciiNormalized)) {
        return {
          valid: false,
          category,
          normalizedValue: asciiNormalized,
          errorCode: 'IBAN_HAS_IR_PREFIX',
          errorMessageFa:
            '❌ لطفاً شماره شبا را بدون پیشوند IR وارد کنید (فقط ۲۴ رقم عددی شبا را ارسال نمایید).',
          errorMessageEn:
            'Please submit the 24 numeric digits of the IBAN WITHOUT the IR prefix.',
          validExamples: examples,
        };
      }
      if (!/^\d{24}$/.test(asciiNormalized)) {
        return {
          valid: false,
          category,
          normalizedValue: asciiNormalized,
          errorCode: 'INVALID_IBAN_FORMAT',
          errorMessageFa:
            '❌ شماره شبا باید دقیقاً ۲۴ رقم عددی بدون حروف IR و بدون فاصله باشد.',
          errorMessageEn: 'IBAN must be exactly 24 numeric digits without the IR prefix.',
          validExamples: examples,
        };
      }
      return {
        valid: true,
        category,
        normalizedValue: asciiNormalized,
        validExamples: examples,
      };
    }

    case 'IPV4': {
      const examples = ['192.15.99.72', '8.8.8.8'];
      const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(asciiNormalized);
      if (!match) {
        return {
          valid: false,
          category,
          normalizedValue: asciiNormalized,
          errorCode: 'INVALID_IPV4_STRUCTURE',
          errorMessageFa:
            '❌ ساختار آدرس آیپی (IPv4) نامعتبر است. باید شامل ۴ بخش عددی جداشده با نقطه باشد (مانند 192.15.99.72).',
          errorMessageEn: 'Invalid IPv4 format. Expected four numeric octets separated by dots.',
          validExamples: examples,
        };
      }
      const maxOctet = policy.strictLegacyIpv4 ? 254 : 255;
      for (let i = 1; i <= 4; i++) {
        const octetStr = match[i]!;
        if (octetStr.length > 1 && octetStr.startsWith('0')) {
          return {
            valid: false,
            category,
            normalizedValue: asciiNormalized,
            errorCode: 'IPV4_LEADING_ZERO',
            errorMessageFa:
              '❌ استفاده از صفر ابتدایی در بخشهای آدرس آیپی (مانند 01) مجاز نمیباشد.',
            errorMessageEn: 'Leading zeros in IPv4 octets (e.g., 01) are not permitted.',
            validExamples: examples,
          };
        }
        const octetNum = Number(octetStr);
        if (octetNum < 0 || octetNum > maxOctet) {
          return {
            valid: false,
            category,
            normalizedValue: asciiNormalized,
            errorCode: 'IPV4_OCTET_OUT_OF_RANGE',
            errorMessageFa: `❌ هر بخش از آدرس IPv4 باید عددی بین 0 تا ${maxOctet} باشد.`,
            errorMessageEn: `Each IPv4 octet must be between 0 and ${maxOctet}.`,
            validExamples: examples,
          };
        }
      }
      return {
        valid: true,
        category,
        normalizedValue: asciiNormalized,
        validExamples: examples,
      };
    }

    case 'USERNAME': {
      const examples = ['@username', '@telegram_user1'];
      if (!/^@[a-zA-Z0-9_]{5,32}$/.test(asciiNormalized)) {
        return {
          valid: false,
          category,
          normalizedValue: asciiNormalized,
          errorCode: 'INVALID_TELEGRAM_USERNAME',
          errorMessageFa:
            '❌ یوزرنیم تلگرام باید با علامت @ شروع شده و شامل ۵ تا ۳۲ کاراکتر انگلیسی، عدد یا زیرخط (_) باشد.',
          errorMessageEn:
            'Telegram username must start with @ followed by 5 to 32 alphanumeric or underscore characters.',
          validExamples: examples,
        };
      }
      return {
        valid: true,
        category,
        normalizedValue: asciiNormalized,
        validExamples: examples,
      };
    }

    case 'EMAIL': {
      const examples = ['user.example@domain.com'];
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(asciiNormalized)) {
        return {
          valid: false,
          category,
          normalizedValue: asciiNormalized,
          errorCode: 'INVALID_EMAIL_ADDRESS',
          errorMessageFa:
            '❌ آدرس ایمیل وارد شده معتبر نیست. ایمیل باید شامل @ و دامنه معتبر (مانند user.example@domain.com) باشد.',
          errorMessageEn:
            'Invalid email address. Must contain @ and a valid domain with at least one dot.',
          validExamples: examples,
        };
      }
      return {
        valid: true,
        category,
        normalizedValue: asciiNormalized,
        validExamples: examples,
      };
    }

    case 'FULL_NAME': {
      const examples = ['علی احمدی', 'سید محمد حسینی'];
      const orthographyNormalized = normalizePersianOrthography(trimmedRaw)
        .replace(/[ \t]+/g, ' ')
        .trim();

      if (!/^[\u0600-\u06FF\u200C]+(\s+[\u0600-\u06FF\u200C]+)+$/.test(orthographyNormalized)) {
        return {
          valid: false,
          category,
          normalizedValue: orthographyNormalized,
          errorCode: 'INVALID_PERSIAN_FULL_NAME',
          errorMessageFa:
            '❌ نام و نام خانوادگی باید فقط با حروف فارسی و حداقل شامل دو بخش (نام و نام خانوادگی مجزا با فاصله) وارد شود.',
          errorMessageEn:
            'Full name must contain Persian characters only and include at least separated first and last names.',
          validExamples: examples,
        };
      }
      return {
        valid: true,
        category,
        normalizedValue: orthographyNormalized,
        validExamples: examples,
      };
    }
  }
}

export function detectAndValidateInput(
  rawInput: string,
  policy: ValidatorPolicyOptions = DEFAULT_VALIDATOR_POLICY
): ValidationResult {
  const trimmed = rawInput.trim();
  const ascii = normalizeNumeralsToAscii(trimmed);

  if (ascii.startsWith('@')) {
    return validateInputByCategory('USERNAME', trimmed, policy);
  }
  if (ascii.includes('@')) {
    return validateInputByCategory('EMAIL', trimmed, policy);
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ascii)) {
    return validateInputByCategory('IPV4', trimmed, policy);
  }
  if (/^ir\d+/i.test(ascii) || /^\d{24}$/.test(ascii)) {
    return validateInputByCategory('IBAN', trimmed, policy);
  }
  if (/^\d{16}$/.test(ascii)) {
    return validateInputByCategory('BANK_CARD', trimmed, policy);
  }
  if (/^(09\d{9}|989\d{9}|\+989\d{9}|79\d{9}|\+79\d{9})$/.test(ascii)) {
    return validateInputByCategory('PHONE', trimmed, policy);
  }
  if (/^\d{10}$/.test(ascii) && verifyIranianNationalIdModulo11(ascii)) {
    return validateInputByCategory('NATIONAL_ID', trimmed, policy);
  }
  if (/^\d{5,10}$/.test(ascii)) {
    return validateInputByCategory('TELEGRAM_ID', trimmed, policy);
  }
  if (/[\u0600-\u06FF]/.test(trimmed)) {
    return validateInputByCategory('FULL_NAME', trimmed, policy);
  }

  return validateInputByCategory('PHONE', trimmed, policy);
}
