import { toPersianDigits } from '../utils/normalizer';
import {
  type CanonicalFieldKey,
  DATA_SOURCE_CATALOG,
  getFieldDefinitionByKey,
} from './lexicalInventory';
import type { CanonicalRecordBlock, CanonicalSearchReport } from './astParser';

export interface WhiteLabelRenderOptions {
  referenceCode: string;
  headerTitle?: string;
  footerText?: string;
  trialWatermarkText?: string;
  maxMessageLength?: number;
}

export function renderWhiteLabelReportPages(
  report: CanonicalSearchReport,
  options: WhiteLabelRenderOptions
): string[] {
  const headerTitle = options.headerTitle ?? '💠 گزارش جامع استعلام سامانه';
  const footerText = options.footerText ?? 'پردازش شده توسط هسته تحلیلی اختصاصی';
  const maxLen = options.maxMessageLength ?? 4096;

  const uniqueSourceCount = new Set(report.records.map((r) => r.sourceType)).size;
  const totalRecordsCount = report.records.length;

  const headerBlockLines: string[] = [
    headerTitle,
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    `🔹 شناسه استعلام: ${options.referenceCode}`,
    `🔹 مقدار جستجو: ${report.queryTarget}`,
    `🔹 تعداد رکوردهای منطبق: ${toPersianDigits(totalRecordsCount)} رکورد در ${toPersianDigits(uniqueSourceCount)} مرجع داده`,
    '━━━━━━━━━━━━━━━━━━━━━━━━',
  ];

  if (report.isTrialWatermarked && options.trialWatermarkText) {
    headerBlockLines.push(options.trialWatermarkText);
    headerBlockLines.push('━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  const renderedRecordBlocks: string[] = report.records.map((rec, idx) =>
    renderSingleRecordTree(rec, idx + 1)
  );

  const rawPages: string[][] = [];
  let currentPageBlocks: string[] = [headerBlockLines.join('\n')];
  let currentLength = currentPageBlocks[0]!.length;

  const footerReserve = 120;

  for (const block of renderedRecordBlocks) {
    if (currentLength + 2 + block.length + footerReserve > maxLen && currentPageBlocks.length > 1) {
      rawPages.push(currentPageBlocks);
      currentPageBlocks = [headerBlockLines.join('\n'), block];
      currentLength = currentPageBlocks[0]!.length + 2 + block.length;
    } else if (currentLength + 2 + block.length + footerReserve > maxLen) {
      const lines = block.split('\n');
      let chunkLines: string[] = [];
      for (const line of lines) {
        const candidate = [...chunkLines, line].join('\n');
        if (currentLength + 2 + candidate.length + footerReserve > maxLen && chunkLines.length > 0) {
          currentPageBlocks.push(chunkLines.join('\n'));
          rawPages.push(currentPageBlocks);
          currentPageBlocks = [headerBlockLines.join('\n')];
          currentLength = currentPageBlocks[0]!.length;
          chunkLines = [line];
        } else {
          chunkLines.push(line);
        }
      }
      if (chunkLines.length > 0) {
        const finalChunk = chunkLines.join('\n');
        currentPageBlocks.push(finalChunk);
        currentLength += 2 + finalChunk.length;
      }
    } else {
      currentPageBlocks.push(block);
      currentLength += 2 + block.length;
    }
  }

  if (currentPageBlocks.length > 0) {
    rawPages.push(currentPageBlocks);
  }

  const totalPages = rawPages.length;
  return rawPages.map((pageBlocks, idx) => {
    const pageNumFa = toPersianDigits(idx + 1);
    const totalPagesFa = toPersianDigits(totalPages);
    const footerLine = `\n📄 صفحه ${pageNumFa} از ${totalPagesFa} • ${footerText}`;
    return `${pageBlocks.join('\n\n')}\n${footerLine}`;
  });
}

function renderSingleRecordTree(record: CanonicalRecordBlock, recordIndex: number): string {
  const lines: string[] = [];
  const indexFa = toPersianDigits(recordIndex);
  lines.push(`${record.whiteLabelIcon} مرجع ${indexFa}: ${record.whiteLabelTitle}`);

  for (const subType of record.subSections) {
    const meta = DATA_SOURCE_CATALOG.find((d) => d.type === subType);
    if (meta) {
      lines.push(`${meta.whiteLabelIcon} ${meta.whiteLabelTitle}`);
    }
  }

  const treeItems: Array<{ label: string; value: string }> = [];
  const renderedKeys = new Set<CanonicalFieldKey>();

  const hasBothProvinceAndCity =
    Boolean(record.fields.province?.length) && Boolean(record.fields.city?.length);

  for (const key of record.fieldOrder) {
    if (renderedKeys.has(key)) continue;

    if ((key === 'province' || key === 'city') && hasBothProvinceAndCity) {
      renderedKeys.add('province');
      renderedKeys.add('city');
      const prov = record.fields.province!.join('، ');
      const cty = record.fields.city!.join('، ');
      treeItems.push({
        label: 'استان / شهر',
        value: `${prov} / ${cty}`,
      });
      continue;
    }

    renderedKeys.add(key);
    const values = record.fields[key];
    if (!values || values.length === 0) continue;

    const def = getFieldDefinitionByKey(key);
    const joinedVal = values.join(' ، ');
    treeItems.push({
      label: def.whiteLabelPersian,
      value: joinedVal,
    });
  }

  for (const [rawKey, val] of Object.entries(record.extraFields)) {
    treeItems.push({
      label: `اطلاعات تکمیلی (${rawKey})`,
      value: val,
    });
  }

  for (let i = 0; i < treeItems.length; i++) {
    const item = treeItems[i]!;
    const branch = i === treeItems.length - 1 ? '╰─' : '├─';
    lines.push(`${branch} ${item.label}: ${item.value}`);
  }

  return lines.join('\n');
}
