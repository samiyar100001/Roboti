import {
  normalizeNumeralsToAscii,
  normalizePersianOrthography,
  stripEmojiVariationSelectors,
} from '../utils/normalizer';
import {
  type CanonicalFieldKey,
  DATA_RECORD_DELIMITER,
  type DataSourceType,
  ENTRY_HEADER_REGEX_1,
  ENTRY_HEADER_REGEX_2,
  ENTRY_HEADER_REGEX_3,
  MULTI_RECORD_PAGINATION_ANNOUNCEMENT_REGEX,
  PAGINATED_CHUNK_HEADER_REGEX,
  PAYMENT_NOISE_DELIMITER,
  matchCanonicalFieldLabel,
  matchDataSourceHeader,
} from './lexicalInventory';

export interface CanonicalRecordBlock {
  sourceType: DataSourceType;
  whiteLabelIcon: string;
  whiteLabelTitle: string;
  subSections: DataSourceType[];
  fields: Partial<Record<CanonicalFieldKey, string[]>>;
  fieldOrder: CanonicalFieldKey[];
  extraFields: Record<string, string>;
}

export interface CanonicalSearchReport {
  isValidPositivePayload: boolean;
  queryTarget: string;
  announcedTotalRecords?: number;
  chunkNumbers: number[];
  records: CanonicalRecordBlock[];
  isTrialWatermarked: boolean;
}

export function isPositiveValidDataPayload(rawMessageText: string): boolean {
  const norm = normalizeNumeralsToAscii(
    normalizePersianOrthography(stripEmojiVariationSelectors(rawMessageText))
  ).trim();

  if (!norm || norm.includes(PAYMENT_NOISE_DELIMITER)) {
    return false;
  }

  const lines = norm.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (
      ENTRY_HEADER_REGEX_1.test(line) ||
      ENTRY_HEADER_REGEX_2.test(line) ||
      ENTRY_HEADER_REGEX_3.test(line) ||
      MULTI_RECORD_PAGINATION_ANNOUNCEMENT_REGEX.test(line) ||
      PAGINATED_CHUNK_HEADER_REGEX.test(line)
    ) {
      return true;
    }
    const ds = matchDataSourceHeader(line);
    if (ds && !ds.isSubSection) {
      return true;
    }
  }
  return false;
}

export function parseDestinationPayloadToAst(
  rawChunks: string[],
  options?: {
    fallbackQueryTarget?: string;
    isTrialWatermarked?: boolean;
    customDatabaseTitles?: Record<string, string>;
  }
): CanonicalSearchReport {
  let queryTarget = options?.fallbackQueryTarget ?? '';
  let announcedTotalRecords: number | undefined;
  const chunkNumbers: number[] = [];
  const records: CanonicalRecordBlock[] = [];
  let hasValidHeaderOrSource = false;

  const combinedText = rawChunks.join('\n').trim();
  const rawRecordSegments = combinedText.split(new RegExp(`${DATA_RECORD_DELIMITER}+`, 'g'));

  for (const segment of rawRecordSegments) {
    const rawLines = segment
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    let currentRecord: CanonicalRecordBlock | null = null;

    for (const rawLine of rawLines) {
      const normalizedLine = normalizeNumeralsToAscii(
        normalizePersianOrthography(stripEmojiVariationSelectors(rawLine))
      ).trim();

      if (!normalizedLine || normalizedLine.includes(PAYMENT_NOISE_DELIMITER)) {
        continue;
      }

      const m1 = ENTRY_HEADER_REGEX_1.exec(normalizedLine);
      if (m1?.[1]) {
        hasValidHeaderOrSource = true;
        if (!queryTarget) queryTarget = m1[1].trim();
        continue;
      }

      const m2 = ENTRY_HEADER_REGEX_2.exec(normalizedLine);
      if (m2?.[1]) {
        hasValidHeaderOrSource = true;
        if (!queryTarget) queryTarget = m2[1].trim();
        continue;
      }

      const m3 = ENTRY_HEADER_REGEX_3.exec(normalizedLine);
      if (m3?.[1]) {
        hasValidHeaderOrSource = true;
        if (!queryTarget) queryTarget = m3[1].trim();
        continue;
      }

      const mAnnounce = MULTI_RECORD_PAGINATION_ANNOUNCEMENT_REGEX.exec(normalizedLine);
      if (mAnnounce?.[1]) {
        hasValidHeaderOrSource = true;
        announcedTotalRecords = Number(mAnnounce[1]);
        continue;
      }

      const mChunk = PAGINATED_CHUNK_HEADER_REGEX.exec(normalizedLine);
      if (mChunk?.[1]) {
        hasValidHeaderOrSource = true;
        const cNum = Number(mChunk[1]);
        if (!chunkNumbers.includes(cNum)) {
          chunkNumbers.push(cNum);
        }
        continue;
      }

      const matchedSource = matchDataSourceHeader(normalizedLine);
      if (matchedSource) {
        hasValidHeaderOrSource = true;
        if (!matchedSource.isSubSection) {
          if (currentRecord) {
            records.push(currentRecord);
          }
          const customTitle = options?.customDatabaseTitles?.[matchedSource.type];
          currentRecord = {
            sourceType: matchedSource.type,
            whiteLabelIcon: matchedSource.whiteLabelIcon,
            whiteLabelTitle: customTitle || matchedSource.whiteLabelTitle,
            subSections: [],
            fields: {},
            fieldOrder: [],
            extraFields: {},
          };
        } else {
          if (!currentRecord) {
            currentRecord = {
              sourceType: 'SOURCE_TELEGRAM',
              whiteLabelIcon: '📡',
              whiteLabelTitle:
                options?.customDatabaseTitles?.['SOURCE_TELEGRAM'] ||
                'سامانه اطلاعات شبکه تلگرام',
              subSections: [],
              fields: {},
              fieldOrder: [],
              extraFields: {},
            };
          }
          if (!currentRecord.subSections.includes(matchedSource.type)) {
            currentRecord.subSections.push(matchedSource.type);
          }
        }
        continue;
      }

      const colonIndex = rawLine.indexOf(':');
      if (colonIndex !== -1) {
        const rawKeyPart = rawLine.slice(0, colonIndex).trim();
        const rawValPart = rawLine.slice(colonIndex + 1).trim();
        if (!rawValPart) continue;

        const cleanValue = normalizePersianOrthography(stripEmojiVariationSelectors(rawValPart)).trim();

        if (!currentRecord) {
          currentRecord = {
            sourceType: 'SOURCE_TELEGRAM',
            whiteLabelIcon: '📡',
            whiteLabelTitle:
              options?.customDatabaseTitles?.['SOURCE_TELEGRAM'] ||
              'سامانه اطلاعات شبکه تلگرام',
            subSections: [],
            fields: {},
            fieldOrder: [],
            extraFields: {},
          };
        }

        const fieldDef = matchCanonicalFieldLabel(rawKeyPart);
        if (fieldDef) {
          const key = fieldDef.canonicalKey;
          const valueToStore = fieldDef.monospace
            ? normalizeNumeralsToAscii(cleanValue)
            : cleanValue;
          const existingList = currentRecord.fields[key] ?? [];
          if (!existingList.includes(valueToStore)) {
            existingList.push(valueToStore);
          }
          currentRecord.fields[key] = existingList;
          if (!currentRecord.fieldOrder.includes(key)) {
            currentRecord.fieldOrder.push(key);
          }
        } else {
          const cleanDynamicKey = normalizePersianOrthography(
            stripEmojiVariationSelectors(rawKeyPart)
          )
            .replace(/^[🔸🔹•\-*\s]+/, '')
            .trim();
          if (cleanDynamicKey) {
            currentRecord.extraFields[cleanDynamicKey] = cleanValue;
          }
        }
      }
    }

    if (currentRecord && (currentRecord.fieldOrder.length > 0 || Object.keys(currentRecord.extraFields).length > 0)) {
      records.push(currentRecord);
    }
  }

  return {
    isValidPositivePayload: hasValidHeaderOrSource && records.length > 0,
    queryTarget: queryTarget || 'نامشخص',
    announcedTotalRecords,
    chunkNumbers,
    records,
    isTrialWatermarked: Boolean(options?.isTrialWatermarked),
  };
}
