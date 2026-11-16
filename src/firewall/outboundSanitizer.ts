import { PAYMENT_NOISE_DELIMITER } from '../parser/lexicalInventory';

export interface OutboundSanitizationResult {
  cleanText: string;
  hadLeakageStripped: boolean;
  detectedSignatures: string[];
}

const FORBIDDEN_PATTERNS: ReadonlyArray<{ id: string; regex: RegExp; replacement: string }> = [
  {
    id: 'DEST_SUPPORT_HANDLE',
    regex: /@RostamQuerySupport/gi,
    replacement: '[پشتیبانی سامانه]',
  },
  {
    id: 'DEST_PAYMENT_BOT',
    regex: /@frenzyexbot/gi,
    replacement: '[درگاه سامانه]',
  },
  {
    id: 'RAW_DATABASE_TITLE',
    regex: /📂\s*دیتابیس\s+[^\n\r]+/g,
    replacement: '🏛 مرجع اطلاعاتی سامانه',
  },
  {
    id: 'MASKED_FREE_VERSION_WARNING',
    regex: /🚨?\s*توجه مهم:\s*پیام[\s]*های نسخه رایگان از بات[^\n\r]*/g,
    replacement: '',
  },
  {
    id: 'SUPPORT_MODE_LEAK',
    regex: /حالت پشتیبانی فعال شد[^\n\r]*/g,
    replacement: '',
  },
  {
    id: 'TRON_WALLET_ADDRESS',
    regex: /\bT[1-9A-HJ-NP-Za-km-z]{33}\b/g,
    replacement: '[REDACTED_WALLET]',
  },
  {
    id: 'EVM_WALLET_ADDRESS',
    regex: /\b0x[a-fA-F0-9]{40}\b/g,
    replacement: '[REDACTED_WALLET]',
  },
];

export function sanitizeOutboundUserText(rawOutboundText: string): OutboundSanitizationResult {
  let cleanText = rawOutboundText;
  const detectedSignatures: string[] = [];

  for (const rule of FORBIDDEN_PATTERNS) {
    if (rule.regex.test(cleanText)) {
      detectedSignatures.push(rule.id);
      cleanText = cleanText.replace(rule.regex, rule.replacement);
    }
    rule.regex.lastIndex = 0;
  }

  return {
    cleanText: cleanText.trim(),
    hadLeakageStripped: detectedSignatures.length > 0,
    detectedSignatures,
  };
}

export function containsForbiddenDestinationLeak(text: string): boolean {
  if (text.includes(PAYMENT_NOISE_DELIMITER) && text.includes('پکیج انتخاب شد')) {
    return true;
  }
  return FORBIDDEN_PATTERNS.some((rule) => {
    const matched = rule.regex.test(text);
    rule.regex.lastIndex = 0;
    return matched;
  });
}
