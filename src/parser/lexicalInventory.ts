import { normalizeTokenForMatching } from '../utils/normalizer';

export const DESTINATION_EMOJI_INVENTORY = {
  statusAlertsIndicators: [
    '✅',
    '❌',
    '⚠️',
    '🚨',
    '⛔',
    '⛔️',
    '💢',
    '✨',
    '🌟',
    '🎉',
    '⚡',
    '🔸',
    '🔹',
  ],
  foldersSearchSecurityComms: ['📂', '📦', '🔍', '🔎', '🔒', '🔐', '💬'],
  identityPersonal: ['👤', '🆔', '🪪', '🎂', '👪', '👨', '⚧'],
  contactNetworkTime: ['📞', '📱', '☎️', '📧', '📌', '🌐', '💻', '⏰', '📅', '🗓️', '⏳', '🔄'],
  locationGeography: ['📍', '🏠', '📮', '🏙', '🌍', '🗺️', '🇮🇷'],
  bankingFinancialStatistical: ['💳', '🏦', '🔢', '💵', '💰', '📊'],
  constructionEngineeringStoreEducation: [
    '📋',
    '📐',
    '📉',
    '🧱',
    '🏢',
    '🏘️',
    '🔖',
    '📄',
    '👷',
    '👷♂️',
    '🧩',
    '🏗️',
    '🏷️',
    '🗂',
    '🗂️',
    '🏛️',
    '🎓',
    '🩺',
  ],
  numbersMiscellaneous: ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '🚀'],
} as const;

export const ALL_76_DESTINATION_EMOJIS: readonly string[] = [
  ...DESTINATION_EMOJI_INVENTORY.statusAlertsIndicators,
  ...DESTINATION_EMOJI_INVENTORY.foldersSearchSecurityComms,
  ...DESTINATION_EMOJI_INVENTORY.identityPersonal,
  ...DESTINATION_EMOJI_INVENTORY.contactNetworkTime,
  ...DESTINATION_EMOJI_INVENTORY.locationGeography,
  ...DESTINATION_EMOJI_INVENTORY.bankingFinancialStatistical,
  ...DESTINATION_EMOJI_INVENTORY.constructionEngineeringStoreEducation,
  ...DESTINATION_EMOJI_INVENTORY.numbersMiscellaneous,
];

export const DATA_RECORD_DELIMITER = '───────────────────────────';
export const PAYMENT_NOISE_DELIMITER = '━━━━━━━━━━━━━━━━━━━━━━━━';

export const ENTRY_HEADER_REGEX_1 = /^✅\s*نتایج برای\s+(.+?)\s*:?\s*$/;
export const ENTRY_HEADER_REGEX_2 = /^✅\s*نتایج جستجوی نام\s*«(.+?)»\s*:?\s*$/;
export const ENTRY_HEADER_REGEX_3 = /^✅\s*نتایج کد ملی\s+([0-9۰-۹٠-٩]+)\s*:?\s*$/;
export const MULTI_RECORD_PAGINATION_ANNOUNCEMENT_REGEX =
  /^در حال ارسال نتایج\s*\(\s*([0-9۰-۹٠-٩]+)\s*رکورد\s*\)\s*\.{0,3}$/;
export const PAGINATED_CHUNK_HEADER_REGEX = /^بخش\s+([0-9۰-۹٠-٩]+)\s*:?\s*$/;

export type DataSourceType =
  | 'SOURCE_TELEGRAM'
  | 'SOURCE_BANK_MELLI'
  | 'SOURCE_BANK_MELLAT'
  | 'SOURCE_BANK_SADERAT'
  | 'SOURCE_SABT_AHVAL'
  | 'SOURCE_NUMBERBOOK'
  | 'SOURCE_IRANCELL'
  | 'SOURCE_TOROB'
  | 'SOURCE_NEZAM_YAZD'
  | 'SOURCE_RAYCHAT'
  | 'SOURCE_TAAVON'
  | 'SOURCE_SAFIR'
  | 'SOURCE_HYPERME'
  | 'SOURCE_DRDR'
  | 'SUBSECTION_USER_INFO'
  | 'SUBSECTION_ORDER_INFO';

export interface DataSourceMetadata {
  type: DataSourceType;
  rawHeaders: string[];
  whiteLabelIcon: string;
  whiteLabelTitle: string;
  isSubSection: boolean;
}

export const DATA_SOURCE_CATALOG: readonly DataSourceMetadata[] = [
  {
    type: 'SOURCE_TELEGRAM',
    rawHeaders: ['📂 دیتابیس تلگرام', 'دیتابیس تلگرام'],
    whiteLabelIcon: '📡',
    whiteLabelTitle: 'سامانه اطلاعات شبکه تلگرام',
    isSubSection: false,
  },
  {
    type: 'SOURCE_BANK_MELLI',
    rawHeaders: ['📂 دیتابیس بانک ملی', 'دیتابیس بانک ملی'],
    whiteLabelIcon: '🏛',
    whiteLabelTitle: 'سامانه اطلاعات بانکی (ملی)',
    isSubSection: false,
  },
  {
    type: 'SOURCE_BANK_MELLAT',
    rawHeaders: ['📂 دیتابیس بانک ملت', 'دیتابیس بانک ملت'],
    whiteLabelIcon: '🏛',
    whiteLabelTitle: 'سامانه اطلاعات بانکی (ملت)',
    isSubSection: false,
  },
  {
    type: 'SOURCE_BANK_SADERAT',
    rawHeaders: ['📂 دیتابیس بانک صادرات', 'دیتابیس بانک صادرات'],
    whiteLabelIcon: '🏛',
    whiteLabelTitle: 'سامانه اطلاعات بانکی (صادرات)',
    isSubSection: false,
  },
  {
    type: 'SOURCE_SABT_AHVAL',
    rawHeaders: ['📂 دیتابیس ثبت احوال', 'دیتابیس ثبت احوال'],
    whiteLabelIcon: '📑',
    whiteLabelTitle: 'سامانه سجلی و هویتی',
    isSubSection: false,
  },
  {
    type: 'SOURCE_NUMBERBOOK',
    rawHeaders: ['📂 دیتابیس نامبربوک مخاطبین', 'دیتابیس نامبربوک مخاطبین'],
    whiteLabelIcon: '◈',
    whiteLabelTitle: 'فهرست دفترچه تلفن همگانی',
    isSubSection: false,
  },
  {
    type: 'SOURCE_IRANCELL',
    rawHeaders: ['📂 دیتابیس ایرانسل', 'دیتابیس ایرانسل'],
    whiteLabelIcon: '❖',
    whiteLabelTitle: 'سامانه مشترکین مخابراتی (ایرانسل)',
    isSubSection: false,
  },
  {
    type: 'SOURCE_TOROB',
    rawHeaders: ['📂 دیتابیس فروشندگان ترب', 'دیتابیس فروشندگان ترب'],
    whiteLabelIcon: '▣',
    whiteLabelTitle: 'سامانه جامع فروشگاههای تجاری (ترب)',
    isSubSection: false,
  },
  {
    type: 'SOURCE_NEZAM_YAZD',
    rawHeaders: ['📂 دیتابیس نظام مهندسی یزد', 'دیتابیس نظام مهندسی یزد'],
    whiteLabelIcon: '📐',
    whiteLabelTitle: 'سامانه مهندسی و شهرسازی (یزد)',
    isSubSection: false,
  },
  {
    type: 'SOURCE_RAYCHAT',
    rawHeaders: ['📂 دیتابیس رایچت', 'دیتابیس رایچت'],
    whiteLabelIcon: '❖',
    whiteLabelTitle: 'سامانه ارتباطات آنلاین (رایچت)',
    isSubSection: false,
  },
  {
    type: 'SOURCE_TAAVON',
    rawHeaders: ['📂 دیتابیس وزارت تعاون', 'دیتابیس وزارت تعاون'],
    whiteLabelIcon: '🏛',
    whiteLabelTitle: 'سامانه جامع تعاون و رفاه',
    isSubSection: false,
  },
  {
    type: 'SOURCE_SAFIR',
    rawHeaders: ['📂 دیتابیس فروشگاه سفیر', 'دیتابیس فروشگاه سفیر'],
    whiteLabelIcon: '▣',
    whiteLabelTitle: 'سامانه مشتریان فروشگاهی (سفیر)',
    isSubSection: false,
  },
  {
    type: 'SOURCE_HYPERME',
    rawHeaders: ['📂 دیتابیس هایپرمی', 'دیتابیس هایپرمی'],
    whiteLabelIcon: '▣',
    whiteLabelTitle: 'سامانه مشتریان زنجیرهای (هایپرمی)',
    isSubSection: false,
  },
  {
    type: 'SOURCE_DRDR',
    rawHeaders: ['📂 دیتابیس سایت drdr', 'دیتابیس سایت drdr'],
    whiteLabelIcon: '🩺',
    whiteLabelTitle: 'سامانه جامع اطلاعات پزشکی (DRDR)',
    isSubSection: false,
  },
  {
    type: 'SUBSECTION_USER_INFO',
    rawHeaders: ['👤 اطلاعات کاربر:', '👤 اطلاعات کاربر', 'اطلاعات کاربر:', 'اطلاعات کاربر'],
    whiteLabelIcon: '◈',
    whiteLabelTitle: 'مشخصات فردی و کاربری',
    isSubSection: true,
  },
  {
    type: 'SUBSECTION_ORDER_INFO',
    rawHeaders: ['📦 اطلاعات سفارش:', '📦 اطلاعات سفارش', 'اطلاعات سفارش:', 'اطلاعات سفارش'],
    whiteLabelIcon: '◈',
    whiteLabelTitle: 'جزئیات پرونده و سفارش',
    isSubSection: true,
  },
];

export type CanonicalFieldKey =
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'savedNames'
  | 'recipientFirstName'
  | 'recipientLastName'
  | 'fatherName'
  | 'nationalId'
  | 'telegramId'
  | 'storeId'
  | 'birthCertificateNumber'
  | 'birthDate'
  | 'birthDateGregorian'
  | 'gender'
  | 'mobileNumbers'
  | 'recipientMobile'
  | 'landline'
  | 'storeSecondaryPhone'
  | 'email'
  | 'username'
  | 'residentialAddress'
  | 'propertyAddress'
  | 'ownerAddress'
  | 'recipientAddress'
  | 'postalCode'
  | 'recipientPostalCode'
  | 'city'
  | 'province'
  | 'district'
  | 'zoneType'
  | 'blockNumber'
  | 'plateNumber'
  | 'registrationPlate'
  | 'cardNumbers'
  | 'accountNumber'
  | 'tariffAmount'
  | 'registeredAt'
  | 'ipAddress'
  | 'operatingSystem'
  | 'browserName'
  | 'browserOs'
  | 'storeDomain'
  | 'createdAt'
  | 'publishedAt'
  | 'updatedAt'
  | 'torobJoinedAt'
  | 'accountCreatedAt'
  | 'accountUpdatedAt'
  | 'orderTimestamp'
  | 'dossierType'
  | 'areaSqm'
  | 'designAreaSqm'
  | 'supervisionAreaSqm'
  | 'quotaDeductedAreaSqm'
  | 'quotaDeductedDate'
  | 'licenseDate'
  | 'clearanceDate'
  | 'floorCount'
  | 'unitCount'
  | 'contractorName'
  | 'supervisionGroup'
  | 'structureGroup'
  | 'structureType'
  | 'usageGroup'
  | 'usageType'
  | 'issuingAuthority'
  | 'discountInfo'
  | 'storeCategory'
  | 'employmentInfo'
  | 'educationDegree'
  | 'medicalSpecialty';

export interface FieldMappingDefinition {
  canonicalKey: CanonicalFieldKey;
  domainGroup:
    | 'Identity'
    | 'Contact'
    | 'Location'
    | 'Financial'
    | 'Technical/Time'
    | 'Engineering/Prof';
  whiteLabelPersian: string;
  monospace: boolean;
  rawLabels: string[];
}

export const CANONICAL_FIELD_DEFINITIONS: readonly FieldMappingDefinition[] = [
  {
    canonicalKey: 'firstName',
    domainGroup: 'Identity',
    whiteLabelPersian: 'نام',
    monospace: false,
    rawLabels: ['👤 نام', 'نام'],
  },
  {
    canonicalKey: 'lastName',
    domainGroup: 'Identity',
    whiteLabelPersian: 'نام خانوادگی',
    monospace: false,
    rawLabels: ['👤 نام خانوادگی', '👤 نامخانوادگی', 'نام خانوادگی', 'نامخانوادگی'],
  },
  {
    canonicalKey: 'fullName',
    domainGroup: 'Identity',
    whiteLabelPersian: 'نام و نام خانوادگی',
    monospace: false,
    rawLabels: ['👤 نام و نامخانوادگی', '👤 نام و نام خانوادگی', '👤 نام کامل', 'نام و نامخانوادگی', 'نام و نام خانوادگی', 'نام کامل'],
  },
  {
    canonicalKey: 'savedNames',
    domainGroup: 'Identity',
    whiteLabelPersian: 'عناوین ثبتشده در مخاطبین',
    monospace: false,
    rawLabels: ['👤 نامهای ذخیرهشده', '👤 نام های ذخیره شده', 'نامهای ذخیرهشده', 'نام های ذخیره شده'],
  },
  {
    canonicalKey: 'recipientFirstName',
    domainGroup: 'Identity',
    whiteLabelPersian: 'نام تحویلگیرنده',
    monospace: false,
    rawLabels: ['👤 نام گیرنده', 'نام گیرنده'],
  },
  {
    canonicalKey: 'recipientLastName',
    domainGroup: 'Identity',
    whiteLabelPersian: 'نام خانوادگی تحویلگیرنده',
    monospace: false,
    rawLabels: ['👤 نام خانوادگی گیرنده', '👤 نامخانوادگی گیرنده', 'نام خانوادگی گیرنده', 'نامخانوادگی گیرنده'],
  },
  {
    canonicalKey: 'fatherName',
    domainGroup: 'Identity',
    whiteLabelPersian: 'نام پدر',
    monospace: false,
    rawLabels: ['👪 نام پدر', '👨 نام پدر', 'نام پدر'],
  },
  {
    canonicalKey: 'nationalId',
    domainGroup: 'Identity',
    whiteLabelPersian: 'کد ملی',
    monospace: true,
    rawLabels: ['🆔 کد ملی', '🆔 کدملی', '🆔 کد\u200Cملی', 'کد ملی', 'کدملی', 'کد\u200Cملی'],
  },
  {
    canonicalKey: 'telegramId',
    domainGroup: 'Identity',
    whiteLabelPersian: 'شناسه یکتا (ID)',
    monospace: true,
    rawLabels: ['🆔 آیدی', '🆔 ایدی', 'آیدی', 'ایدی'],
  },
  {
    canonicalKey: 'storeId',
    domainGroup: 'Identity',
    whiteLabelPersian: 'شناسه فروشگاه',
    monospace: true,
    rawLabels: ['🆔 ایدی فروشگاه', '🆔 آیدی فروشگاه', 'ایدی فروشگاه', 'آیدی فروشگاه'],
  },
  {
    canonicalKey: 'birthCertificateNumber',
    domainGroup: 'Identity',
    whiteLabelPersian: 'شماره شناسنامه',
    monospace: true,
    rawLabels: ['🪪 شماره شناسنامه', 'شماره شناسنامه'],
  },
  {
    canonicalKey: 'birthDate',
    domainGroup: 'Identity',
    whiteLabelPersian: 'تاریخ تولد',
    monospace: false,
    rawLabels: ['🎂 تاریخ تولد', '🔸 Birthday', 'تاریخ تولد', 'Birthday'],
  },
  {
    canonicalKey: 'birthDateGregorian',
    domainGroup: 'Identity',
    whiteLabelPersian: 'تاریخ تولد (میلادی)',
    monospace: false,
    rawLabels: ['🎂 تاریخ تولد (میلادی)', 'تاریخ تولد (میلادی)'],
  },
  {
    canonicalKey: 'gender',
    domainGroup: 'Identity',
    whiteLabelPersian: 'جنسیت',
    monospace: false,
    rawLabels: ['⚧ جنسیت', 'جنسیت'],
  },
  {
    canonicalKey: 'mobileNumbers',
    domainGroup: 'Contact',
    whiteLabelPersian: 'شماره همراه',
    monospace: true,
    rawLabels: [
      '📱 موبایل',
      '📞 شماره موبایل',
      '📱 شماره موبایل',
      '📞 لیست شمارهها',
      '📞 لیست شماره ها',
      '🔸 Phones',
      'موبایل',
      'شماره موبایل',
      'لیست شمارهها',
      'لیست شماره ها',
      'Phones',
    ],
  },
  {
    canonicalKey: 'recipientMobile',
    domainGroup: 'Contact',
    whiteLabelPersian: 'شماره همراه گیرنده',
    monospace: true,
    rawLabels: ['📞 موبایل گیرنده', 'موبایل گیرنده'],
  },
  {
    canonicalKey: 'landline',
    domainGroup: 'Contact',
    whiteLabelPersian: 'تلفن ثابت',
    monospace: true,
    rawLabels: ['☎️ تلفن ثابت', '📞 تلفن ثابت', 'تلفن ثابت'],
  },
  {
    canonicalKey: 'storeSecondaryPhone',
    domainGroup: 'Contact',
    whiteLabelPersian: 'تلفن پشتیبان فروشگاه',
    monospace: true,
    rawLabels: ['☎️ شماره دوم فروشگاه', 'شماره دوم فروشگاه'],
  },
  {
    canonicalKey: 'email',
    domainGroup: 'Contact',
    whiteLabelPersian: 'پست الکترونیکی',
    monospace: false,
    rawLabels: ['📧 ایمیل', '🔸 Mail', 'ایمیل', 'Mail'],
  },
  {
    canonicalKey: 'username',
    domainGroup: 'Contact',
    whiteLabelPersian: 'نام کاربری (@Username)',
    monospace: false,
    rawLabels: ['📌 یوزرنیم', 'یوزرنیم'],
  },
  {
    canonicalKey: 'residentialAddress',
    domainGroup: 'Location',
    whiteLabelPersian: 'نشانی محل سکونت',
    monospace: false,
    rawLabels: ['📍 آدرس محل سکونت', '🏠 آدرس کامل', 'آدرس محل سکونت', 'آدرس کامل'],
  },
  {
    canonicalKey: 'propertyAddress',
    domainGroup: 'Location',
    whiteLabelPersian: 'نشانی ملک',
    monospace: false,
    rawLabels: ['📍 آدرس ملک', 'آدرس ملک'],
  },
  {
    canonicalKey: 'ownerAddress',
    domainGroup: 'Location',
    whiteLabelPersian: 'نشانی مالک',
    monospace: false,
    rawLabels: ['🏠 آدرس مالک', 'آدرس مالک'],
  },
  {
    canonicalKey: 'recipientAddress',
    domainGroup: 'Location',
    whiteLabelPersian: 'نشانی تحویلگیرنده',
    monospace: false,
    rawLabels: ['📍 آدرس گیرنده', 'آدرس گیرنده'],
  },
  {
    canonicalKey: 'postalCode',
    domainGroup: 'Location',
    whiteLabelPersian: 'کد پستی',
    monospace: true,
    rawLabels: ['📮 کدپستی', '📮 کد پستی', 'کدپستی', 'کد پستی'],
  },
  {
    canonicalKey: 'recipientPostalCode',
    domainGroup: 'Location',
    whiteLabelPersian: 'کد پستی گیرنده',
    monospace: true,
    rawLabels: ['📮 کدپستی گیرنده', '📮 کد پستی گیرنده', 'کدپستی گیرنده', 'کد پستی گیرنده'],
  },
  {
    canonicalKey: 'city',
    domainGroup: 'Location',
    whiteLabelPersian: 'شهر',
    monospace: false,
    rawLabels: ['🏙 شهر', 'شهر'],
  },
  {
    canonicalKey: 'province',
    domainGroup: 'Location',
    whiteLabelPersian: 'استان',
    monospace: false,
    rawLabels: ['🌍 نام استان', '📍 استان', '🌍 استان', 'نام استان', 'استان'],
  },
  {
    canonicalKey: 'district',
    domainGroup: 'Location',
    whiteLabelPersian: 'منطقه / ناحیه',
    monospace: false,
    rawLabels: ['🗺️ ناحیه', '🗺 ناحیه', 'ناحیه'],
  },
  {
    canonicalKey: 'zoneType',
    domainGroup: 'Location',
    whiteLabelPersian: 'محدوده شهری',
    monospace: false,
    rawLabels: ['🗺️ بافت/محدوده', '🗺 بافت/محدوده', 'بافت/محدوده'],
  },
  {
    canonicalKey: 'blockNumber',
    domainGroup: 'Location',
    whiteLabelPersian: 'شماره بلوک',
    monospace: false,
    rawLabels: ['🧱 بلوک', 'بلوک'],
  },
  {
    canonicalKey: 'plateNumber',
    domainGroup: 'Location',
    whiteLabelPersian: 'پلاک',
    monospace: false,
    rawLabels: ['🔖 شماره پلاک', 'شماره پلاک'],
  },
  {
    canonicalKey: 'registrationPlate',
    domainGroup: 'Location',
    whiteLabelPersian: 'پلاک ثبتی',
    monospace: false,
    rawLabels: ['📄 پلاک ثبتی', 'پلاک ثبتی'],
  },
  {
    canonicalKey: 'cardNumbers',
    domainGroup: 'Financial',
    whiteLabelPersian: 'شماره کارت بانکی',
    monospace: true,
    rawLabels: ['💳 لیست شماره کارتها', '💳 لیست شماره کارت ها', '💳 شماره کارت', 'لیست شماره کارتها', 'لیست شماره کارت ها', 'شماره کارت'],
  },
  {
    canonicalKey: 'accountNumber',
    domainGroup: 'Financial',
    whiteLabelPersian: 'شماره حساب بانکی',
    monospace: true,
    rawLabels: ['🏦 شماره حساب', '🔢 شماره حساب', 'شماره حساب'],
  },
  {
    canonicalKey: 'tariffAmount',
    domainGroup: 'Financial',
    whiteLabelPersian: 'مبلغ تعرفه',
    monospace: false,
    rawLabels: ['💵 مبلغ تعرفه', 'مبلغ تعرفه'],
  },
  {
    canonicalKey: 'registeredAt',
    domainGroup: 'Technical/Time',
    whiteLabelPersian: 'زمان ثبت رکورد',
    monospace: false,
    rawLabels: ['⏰ زمان ثبت', 'زمان ثبت'],
  },
  {
    canonicalKey: 'ipAddress',
    domainGroup: 'Technical/Time',
    whiteLabelPersian: 'آدرس IP',
    monospace: true,
    rawLabels: ['🌐 آیپی', '🌐 ایپی', 'آیپی', 'ایپی'],
  },
  {
    canonicalKey: 'operatingSystem',
    domainGroup: 'Technical/Time',
    whiteLabelPersian: 'سیستمعامل',
    monospace: false,
    rawLabels: ['💻 سیستم عامل', 'سیستم عامل'],
  },
  {
    canonicalKey: 'browserName',
    domainGroup: 'Technical/Time',
    whiteLabelPersian: 'مرورگر',
    monospace: false,
    rawLabels: ['🧩 نام مرورگر', 'نام مرورگر'],
  },
  {
    canonicalKey: 'browserOs',
    domainGroup: 'Technical/Time',
    whiteLabelPersian: 'پلتفرم مرورگر',
    monospace: false,
    rawLabels: ['💻 سیستم عامل مرورگر', 'سیستم عامل مرورگر'],
  },
  {
    canonicalKey: 'storeDomain',
    domainGroup: 'Technical/Time',
    whiteLabelPersian: 'دامنه اینترنتی فروشگاه',
    monospace: false,
    rawLabels: ['🌐 ادرس دامنه فروشگاه', '🌐 آدرس دامنه فروشگاه', 'ادرس دامنه فروشگاه', 'آدرس دامنه فروشگاه'],
  },
  {
    canonicalKey: 'createdAt',
    domainGroup: 'Technical/Time',
    whiteLabelPersian: 'تاریخ ایجاد',
    monospace: false,
    rawLabels: ['تاریخ ایجاد'],
  },
  {
    canonicalKey: 'publishedAt',
    domainGroup: 'Technical/Time',
    whiteLabelPersian: 'تاریخ انتشار',
    monospace: false,
    rawLabels: ['تاریخ انتشار'],
  },
  {
    canonicalKey: 'updatedAt',
    domainGroup: 'Technical/Time',
    whiteLabelPersian: 'آخرین بروزرسانی',
    monospace: false,
    rawLabels: ['🔄 اخرین اپدیت', '🔄 آخرین آپدیت', '🔄 تاریخ بروزرسانی', 'اخرین اپدیت', 'آخرین آپدیت', 'تاریخ بروزرسانی'],
  },
  {
    canonicalKey: 'torobJoinedAt',
    domainGroup: 'Technical/Time',
    whiteLabelPersian: 'تاریخ عضویت فروشنده',
    monospace: false,
    rawLabels: ['📅 تاریخ عضویت در ترب', 'تاریخ عضویت در ترب'],
  },
  {
    canonicalKey: 'accountCreatedAt',
    domainGroup: 'Technical/Time',
    whiteLabelPersian: 'تاریخ افتتاح حساب کاربری',
    monospace: false,
    rawLabels: ['📅 تاریخ ایجاد حساب', 'تاریخ ایجاد حساب'],
  },
  {
    canonicalKey: 'accountUpdatedAt',
    domainGroup: 'Technical/Time',
    whiteLabelPersian: 'بروزرسانی حساب کاربری',
    monospace: false,
    rawLabels: ['📅 آخرین بروزرسانی حساب', 'آخرین بروزرسانی حساب'],
  },
  {
    canonicalKey: 'orderTimestamp',
    domainGroup: 'Technical/Time',
    whiteLabelPersian: 'تاریخ ثبت / ویرایش سفارش',
    monospace: false,
    rawLabels: ['📅 آخرین بروزرسانی سفارش', '📅 تاریخ ثبت سفارش', 'آخرین بروزرسانی سفارش', 'تاریخ ثبت سفارش'],
  },
  {
    canonicalKey: 'dossierType',
    domainGroup: 'Engineering/Prof',
    whiteLabelPersian: 'نوع پرونده مهندسی',
    monospace: false,
    rawLabels: ['📋 نوع پرونده', 'نوع پرونده'],
  },
  {
    canonicalKey: 'areaSqm',
    domainGroup: 'Engineering/Prof',
    whiteLabelPersian: 'متراژ کل (مترمربع)',
    monospace: false,
    rawLabels: ['📐 متراژ (متر مربع)', 'متراژ (متر مربع)'],
  },
  {
    canonicalKey: 'designAreaSqm',
    domainGroup: 'Engineering/Prof',
    whiteLabelPersian: 'متراژ طراحی',
    monospace: false,
    rawLabels: ['📐 متراژ طراحی', 'متراژ طراحی'],
  },
  {
    canonicalKey: 'supervisionAreaSqm',
    domainGroup: 'Engineering/Prof',
    whiteLabelPersian: 'متراژ نظارت',
    monospace: false,
    rawLabels: ['📐 متراژ تحت نظارت', 'متراژ تحت نظارت'],
  },
  {
    canonicalKey: 'quotaDeductedAreaSqm',
    domainGroup: 'Engineering/Prof',
    whiteLabelPersian: 'متراژ کسر سهمیه',
    monospace: false,
    rawLabels: ['📉 متراژ کسر سهمیه', 'متراژ کسر سهمیه'],
  },
  {
    canonicalKey: 'quotaDeductedDate',
    domainGroup: 'Engineering/Prof',
    whiteLabelPersian: 'تاریخ کسر سهمیه',
    monospace: false,
    rawLabels: ['🗓️ تاریخ کسر سهمیه', '🗓 تاریخ کسر سهمیه', 'تاریخ کسر سهمیه'],
  },
  {
    canonicalKey: 'licenseDate',
    domainGroup: 'Engineering/Prof',
    whiteLabelPersian: 'تاریخ صدور پروانه',
    monospace: false,
    rawLabels: ['🗓️ تاریخ پروانه', '🗓 تاریخ پروانه', 'تاریخ پروانه'],
  },
  {
    canonicalKey: 'clearanceDate',
    domainGroup: 'Engineering/Prof',
    whiteLabelPersian: 'تاریخ مفاصاحساب',
    monospace: false,
    rawLabels: ['✅ تاریخ مفاصاحساب', 'تاریخ مفاصاحساب'],
  },
  {
    canonicalKey: 'floorCount',
    domainGroup: 'Engineering/Prof',
    whiteLabelPersian: 'تعداد طبقات',
    monospace: false,
    rawLabels: ['🏢 تعداد طبقات', 'تعداد طبقات'],
  },
  {
    canonicalKey: 'unitCount',
    domainGroup: 'Engineering/Prof',
    whiteLabelPersian: 'تعداد واحد',
    monospace: false,
    rawLabels: ['🏘️ تعداد واحد', '🏘 تعداد واحد', 'تعداد واحد'],
  },
  {
    canonicalKey: 'contractorName',
    domainGroup: 'Engineering/Prof',
    whiteLabelPersian: 'مجری پروژه',
    monospace: false,
    rawLabels: ['👷 نام مجری', 'نام مجری'],
  },
  {
    canonicalKey: 'supervisionGroup',
    domainGroup: 'Engineering/Prof',
    whiteLabelPersian: 'گروه نظارت',
    monospace: false,
    rawLabels: ['👷♂️ گروه نظارت', '👷 گروه نظارت', 'گروه نظارت'],
  },
  {
    canonicalKey: 'structureGroup',
    domainGroup: 'Engineering/Prof',
    whiteLabelPersian: 'گروه سازه',
    monospace: false,
    rawLabels: ['🧩 گروه سازه', 'گروه سازه'],
  },
  {
    canonicalKey: 'structureType',
    domainGroup: 'Engineering/Prof',
    whiteLabelPersian: 'نوع سازه',
    monospace: false,
    rawLabels: ['🏗️ نوع سازه', '🏗 نوع سازه', 'نوع سازه'],
  },
  {
    canonicalKey: 'usageGroup',
    domainGroup: 'Engineering/Prof',
    whiteLabelPersian: 'گروه کاربری',
    monospace: false,
    rawLabels: ['🗂️ گروه کاربری', '🗂 گروه کاربری', 'گروه کاربری'],
  },
  {
    canonicalKey: 'usageType',
    domainGroup: 'Engineering/Prof',
    whiteLabelPersian: 'نوع کاربری',
    monospace: false,
    rawLabels: ['🏷️ نوع کاربری', '🏷 نوع کاربری', 'نوع کاربری'],
  },
  {
    canonicalKey: 'issuingAuthority',
    domainGroup: 'Engineering/Prof',
    whiteLabelPersian: 'مرجع صادرکننده',
    monospace: false,
    rawLabels: ['🏛️ مرجع صادرکننده', '🏛 مرجع صادرکننده', 'مرجع صادرکننده'],
  },
  {
    canonicalKey: 'discountInfo',
    domainGroup: 'Engineering/Prof',
    whiteLabelPersian: 'وضعیت / نوع تخفیف',
    monospace: false,
    rawLabels: ['🏷️ نوع تخفیف', '🏷 نوع تخفیف', '🏷️ وضعیت تخفیف', '🏷 وضعیت تخفیف', 'نوع تخفیف', 'وضعیت تخفیف'],
  },
  {
    canonicalKey: 'storeCategory',
    domainGroup: 'Engineering/Prof',
    whiteLabelPersian: 'نوع فعالیت فروشگاه',
    monospace: false,
    rawLabels: ['🏷️ نوع فروشگاه', '🏷 نوع فروشگاه', 'نوع فروشگاه'],
  },
  {
    canonicalKey: 'employmentInfo',
    domainGroup: 'Engineering/Prof',
    whiteLabelPersian: 'سمت / محل / بخش کاری',
    monospace: false,
    rawLabels: ['🏷️ بخش کاری', '🏷 بخش کاری', '📋 محل کار', '🏢 عنوان کاری', 'بخش کاری', 'محل کار', 'عنوان کاری'],
  },
  {
    canonicalKey: 'educationDegree',
    domainGroup: 'Engineering/Prof',
    whiteLabelPersian: 'مدرک / مقطع تحصیلی',
    monospace: false,
    rawLabels: ['🎓 مقطع تحصیلی', '🎓 مدرک تحصیلی', 'مقطع تحصیلی', 'مدرک تحصیلی'],
  },
  {
    canonicalKey: 'medicalSpecialty',
    domainGroup: 'Engineering/Prof',
    whiteLabelPersian: 'تخصص و شرح فعالیت',
    monospace: false,
    rawLabels: ['🩺 توضیح کوتاه تخصص', '📋 تخصص', 'توضیح کوتاه تخصص', 'تخصص'],
  },
];

const DATA_SOURCE_LOOKUP = new Map<string, DataSourceMetadata>();
for (const source of DATA_SOURCE_CATALOG) {
  for (const rawHeader of source.rawHeaders) {
    DATA_SOURCE_LOOKUP.set(normalizeTokenForMatching(rawHeader), source);
  }
}

const FIELD_DEFINITION_LOOKUP = new Map<string, FieldMappingDefinition>();
const FIELD_DEFINITION_BY_KEY = new Map<CanonicalFieldKey, FieldMappingDefinition>();
for (const def of CANONICAL_FIELD_DEFINITIONS) {
  FIELD_DEFINITION_BY_KEY.set(def.canonicalKey, def);
  for (const rawLabel of def.rawLabels) {
    FIELD_DEFINITION_LOOKUP.set(normalizeTokenForMatching(rawLabel), def);
  }
}

export function matchDataSourceHeader(line: string): DataSourceMetadata | null {
  const norm = normalizeTokenForMatching(line);
  const direct = DATA_SOURCE_LOOKUP.get(norm);
  if (direct) return direct;
  const withoutColon = norm.replace(/\s*:\s*$/, '');
  return DATA_SOURCE_LOOKUP.get(withoutColon) ?? null;
}

export function matchCanonicalFieldLabel(rawLabel: string): FieldMappingDefinition | null {
  const norm = normalizeTokenForMatching(rawLabel);
  const direct = FIELD_DEFINITION_LOOKUP.get(norm);
  if (direct) return direct;
  const strippedLeadingEmoji = norm
    .replace(/^[^\u0600-\u06FFa-zA-Z0-9]+/, '')
    .trim();
  return FIELD_DEFINITION_LOOKUP.get(strippedLeadingEmoji) ?? null;
}

export function getFieldDefinitionByKey(key: CanonicalFieldKey): FieldMappingDefinition {
  const def = FIELD_DEFINITION_BY_KEY.get(key);
  if (!def) {
    throw new Error(`Unknown CanonicalFieldKey: ${key}`);
  }
  return def;
}
