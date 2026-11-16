import { InlineKeyboard } from 'grammy';
import { NINE_CATEGORY_METADATA, ORDERED_NINE_CATEGORIES } from './i18n';
import type { SearchCategory } from '../validation/validators';

export interface InlineButtonDescriptor {
  text: string;
  callbackData: string;
}

/**
 * Section 4.3 Strict 9-Row Inline Keyboard Layout:
 * Each of the 9 search categories MUST occupy its own full row (1 button per row, never side by side).
 */
export function buildNineRowMainMenuKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const category of ORDERED_NINE_CATEGORIES) {
    const meta = NINE_CATEGORY_METADATA[category];
    kb.text(meta.buttonLabelFa, `cat:${category}`).row();
  }
  kb.text('📘 راهنمای جامع استعلام (/help)', 'nav:help').row();
  kb.text('📊 وضعیت درخواست فعال (/status)', 'nav:status').row();
  return kb;
}

/**
 * Returns the structured 9-row layout descriptors for inspection and simulator rendering.
 */
export function getNineRowKeyboardMatrix(): InlineButtonDescriptor[][] {
  const rows: InlineButtonDescriptor[][] = ORDERED_NINE_CATEGORIES.map((category) => [
    {
      text: NINE_CATEGORY_METADATA[category].buttonLabelFa,
      callbackData: `cat:${category}`,
    },
  ]);
  rows.push([{ text: '📘 راهنمای جامع استعلام (/help)', callbackData: 'nav:help' }]);
  rows.push([{ text: '📊 وضعیت درخواست فعال (/status)', callbackData: 'nav:status' }]);
  return rows;
}

export function buildCategoryBackKeyboard(selectedCategory?: SearchCategory): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (selectedCategory) {
    kb.text('🔄 لغو و بازگشت به منوی اصلی', 'nav:main').row();
  } else {
    kb.text('🔙 بازگشت به منوی ۹گانه اصلی', 'nav:main').row();
  }
  return kb;
}

export function buildAdminControlCenterKeyboard(queuePaused: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text('🔄 بروزرسانی وضعیت سلامت سامانه', 'admin:health').row();
  kb.text(
    queuePaused ? '▶️ ادامه پردازش صف (Resume Queue)' : '⏸ توقف موقت صف (Pause Queue)',
    queuePaused ? 'admin:queue_resume' : 'admin:queue_pause'
  ).row();
  kb.text('🔐 جادوگر نشست MTProto (اکانت اصلی REAL)', 'admin:wizard_REAL').row();
  kb.text('🧪 جادوگر نشست MTProto (اکانت تست TEST)', 'admin:wizard_TEST').row();
  kb.text('📡 استعلام سهمیه بات مرجع (/start Telemetry)', 'admin:telemetry_refresh').row();
  kb.text('🔙 بازگشت به منوی کاربری', 'nav:main').row();
  return kb;
}
