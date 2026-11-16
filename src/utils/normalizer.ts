const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const ARABIC_INDIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

/**
 * Converts Persian (`۰-۹`) and Arabic-Indic (`٠-٩`) numerals to standard ASCII (`0-9`)
 * without altering any non-numeric characters.
 */
export function normalizeNumeralsToAscii(input: string): string {
  let out = '';
  for (const ch of input) {
    const pIdx = PERSIAN_DIGITS.indexOf(ch);
    if (pIdx !== -1) {
      out += String(pIdx);
      continue;
    }
    const aIdx = ARABIC_INDIC_DIGITS.indexOf(ch);
    if (aIdx !== -1) {
      out += String(aIdx);
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Converts ASCII digits (`0-9`) to Persian digits (`۰-۹`) for polished Persian UI rendering.
 */
export function toPersianDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d);
}

/**
 * CRITICAL UNICODE NORMALIZATION INVARIANT (Document 2.1):
 * Strips invisible Unicode Variation Selector-16 (`\uFE0F`) and Zero-Width Joiners (`\u200D`)
 * when matching emojis, headers, or field labels, while strictly preserving standard
 * Persian ZWNJ (`\u200C` / نیمفاصله) in canonical output.
 */
export function stripEmojiVariationSelectors(input: string): string {
  return input.replace(/\uFE0F/g, '');
}

/**
 * Normalizes Arabic character variants (`ك`, `ي`, `ى`, `ة`, `ؤ`, `إ`, `أ`) into standard
 * Persian characters (`ک`, `ی`, `ه`, `و`, `ا`) while preserving Persian ZWNJ (`\u200C`).
 */
export function normalizePersianOrthography(input: string): string {
  return input
    .replace(/\u0643/g, '\u06A9') // ك -> ک
    .replace(/[\u064A\u0649]/g, '\u06CC') // ي / ى -> ی
    .replace(/\u0629/g, '\u0647') // ة -> ه
    .replace(/\u0624/g, '\u0648') // ؤ -> و
    .replace(/[\u0623\u0625]/g, '\u0627'); // أ / إ -> ا
}

/**
 * Normalizes a raw destination field label or header for deterministic lexical lookup:
 * 1. Strips `\uFE0F` and `\u200D`
 * 2. Normalizes Arabic `ك/ي` to Persian `ک/ی`
 * 3. Normalizes numerals to ASCII
 * 4. Collapses multiple horizontal spaces into a single space and trims
 */
export function normalizeTokenForMatching(raw: string): string {
  return normalizeNumeralsToAscii(
    normalizePersianOrthography(stripEmojiVariationSelectors(raw))
  )
    .replace(/\u200D/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
