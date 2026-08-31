import { strFromU8, unzipSync } from 'fflate';

import {
    LOGISTICS_EXCEL_V1,
    type ExcelCellValue,
    type ExcelColumnMapping,
    type ExcelDeliveryGroup,
    type ExcelImportIssueCode,
    type ExcelImportPreview,
    type ExcelImportSummary,
    type ExcelSourceRow,
    type ExcelWorkbookSheet,
    type LogisticsExcelTemplate,
} from '@/domain/import/excel-models';
import { normalizeRegionCode } from '@/domain/route-code';

type WorkbookRow = { rowNumber: number; cells: Record<string, ExcelCellValue> };
type WorkbookSheetData = { name: string; rows: WorkbookRow[] };

export type ParseLogisticsExcelOptions = {
  importId: string;
  fileName: string;
  fileHash: string;
  createdAt?: string;
  sheetName?: string;
  template?: LogisticsExcelTemplate;
};

const STREET_MARKER = /\b(?:g\.|gatv(?:ė|e)|pr\.|prospekt(?:as|o)|pl\.|plentas|kelias|takas|tak\.|al\.|alėja|aikšt(?:ė|e)|a\.|skg\.)\s*\d/iu;
const ORDER_NUMBER = /^\p{L}{1,3}\d{5,}[\p{L}\d-]*$/iu;
/** First three rows are contact/header noise; route sheets need more than that. */
const MIN_ROUTE_SHEET_ROWS = 4;
const IGNORED_SHEET_NAMES = new Set([
  'kontaktai',
  'kelių mokestis',
  'keliu mokestis',
  'ataskaita',
  'atmintinė',
  'atmintine',
  'atmintinės',
  'atmintines',
]);

export function normalizeExcelSheetName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Sheets that never carry deliveries (contacts, tolls, reports). */
export function isIgnoredExcelSheetName(name: string): boolean {
  return IGNORED_SHEET_NAMES.has(normalizeExcelSheetName(name));
}

/** Candidate route sheets: not blacklisted and more than 3 visible rows. */
export function isRouteCandidateSheet(sheet: { name: string; rowCount: number }): boolean {
  return !isIgnoredExcelSheetName(sheet.name) && sheet.rowCount >= MIN_ROUTE_SHEET_ROWS;
}

export function parseLogisticsExcelWorkbook(
  bytes: Uint8Array,
  options: ParseLogisticsExcelOptions,
): ExcelImportPreview {
  const template = options.template ?? LOGISTICS_EXCEL_V1;
  const workbook = readXlsxWorkbook(bytes);
  if (!workbook.length) throw new Error('Excel faile nerasta skaitomų lapų.');

  const scored = workbook.map((sheet) => {
    const rowCount = sheet.rows.filter(hasVisibleCells).length;
    const eligible = isRouteCandidateSheet({ name: sheet.name, rowCount });
    return {
      sheet,
      rowCount,
      eligible,
      score: eligible ? scoreSheet(sheet, template) : -1,
    };
  });
  const eligible = scored.filter((entry) => entry.eligible);
  if (!options.sheetName && eligible.length === 0) {
    throw new Error('Excel faile nerasta maršruto lapų (daugiau nei 3 eilutės, ne Kontaktai / Kelių mokestis / Ataskaita).');
  }
  const selected = options.sheetName
    ? scored.find((entry) => entry.sheet.name === options.sheetName)
    : [...eligible].sort((a, b) => b.score - a.score || b.rowCount - a.rowCount)[0];
  if (!selected) throw new Error('Pasirinktas Excel lapas nerastas.');

  const detected = detectColumnMapping(selected.sheet, template);
  const parsedRows = parseRows(
    selected.sheet,
    options.importId,
    detected.mapping,
    detected.firstDataRow,
    template,
  );
  const routeCodes = uniqueStrings(parsedRows.map((row) => row.routeCode));
  const rows = markDuplicateOrders(parsedRows);
  const groups = groupExcelRows(rows);
  // Initially show every eligible sheet; ignored / tiny sheets stay hidden.
  const sheets: ExcelWorkbookSheet[] = (eligible.length > 0 ? eligible : scored).map(({ sheet, score, rowCount }) => ({
    name: sheet.name,
    rowCount,
    score,
    selected: sheet.name === selected.sheet.name,
  }));

  return {
    id: options.importId,
    fileName: options.fileName,
    fileHash: options.fileHash,
    templateId: template.id,
    templateVersion: template.version,
    sheets,
    selectedSheetName: selected.sheet.name,
    firstDataRow: detected.firstDataRow,
    mapping: detected.mapping,
    mappingRecognized: detected.recognized,
    selectedRouteCodes: routeCodes,
    rows,
    groups,
    summary: summarizeExcelRows(rows, groups),
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
}

export function filterExcelPreviewByRouteCodes(
  preview: ExcelImportPreview,
  selectedRouteCodes: string[],
): ExcelImportPreview {
  const normalized = uniqueStrings(selectedRouteCodes.map((value) => value.toUpperCase()));
  const rows = preview.rows.map((row) => ({
    ...row,
    excluded: normalized.length > 0 && (!row.routeCode || !normalized.includes(row.routeCode.toUpperCase())),
  }));
  const groups = groupExcelRows(rows);
  return { ...preview, selectedRouteCodes: normalized, rows, groups, summary: summarizeExcelRows(rows, groups) };
}

export function parseLithuanianWeightToGrams(value: ExcelCellValue): {
  grams: number | null;
  issue: Extract<ExcelImportIssueCode, 'INVALID_WEIGHT' | 'NEGATIVE_WEIGHT'> | null;
} {
  if (value === null || String(value).trim() === '') return { grams: null, issue: null };
  const normalized = String(value).trim().replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(?:\.\d{1,3})?$/.test(normalized)) return { grams: null, issue: 'INVALID_WEIGHT' };
  if (normalized.startsWith('-')) return { grams: null, issue: 'NEGATIVE_WEIGHT' };
  const [whole, fraction = ''] = normalized.split('.');
  const grams = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  return Number.isSafeInteger(grams) ? { grams, issue: null } : { grams: null, issue: 'INVALID_WEIGHT' };
}

export function parseDeliveryTimeWindow(value: ExcelCellValue): {
  from: string | null;
  to: string | null;
  issue: Extract<ExcelImportIssueCode, 'INVALID_TIME_WINDOW'> | null;
} {
  if (value === null || String(value).trim() === '') return { from: null, to: null, issue: null };
  const text = String(value).trim().replace(/[–—]/g, '-');
  const match = text.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!match) return { from: null, to: null, issue: 'INVALID_TIME_WINDOW' };
  const from = `${match[1]!.padStart(2, '0')}:${match[2]}`;
  const to = `${match[3]!.padStart(2, '0')}:${match[4]}`;
  const valid = [from, to].every((time) => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours! >= 0 && hours! <= 23 && minutes! >= 0 && minutes! <= 59;
  });
  if (!valid || timeMinutes(from) >= timeMinutes(to)) return { from: null, to: null, issue: 'INVALID_TIME_WINDOW' };
  return { from, to, issue: null };
}

export function stripSupplierPrefix(
  value: string | null,
  prefixes: string[] = LOGISTICS_EXCEL_V1.supplierPrefixes,
): { cleaned: string | null; supplierPrefix: string | null } {
  if (!value?.trim()) return { cleaned: null, supplierPrefix: null };
  const leading = value.trimStart();
  const ordered = [...prefixes].sort((a, b) => b.length - a.length);
  for (const prefix of ordered) {
    const pattern = prefix.trim().split(/\s+/).map(supplierTokenPattern).join('[\\s,.;:-]+');
    // Daily exports sometimes concatenate the supplier and street without a
    // separator ("UAB Lambda LTPajuosčio..."). An uppercase next letter is a
    // valid boundary too; keeping it out of the consumed match preserves the
    // street name.
    const match = leading.match(new RegExp(`^${pattern}(?=\\s|,|\\.|;|:|-|\\p{Lu}|$)[\\s,.;:-]*`, 'iu'));
    if (!match) continue;
    const cleaned = leading.slice(match[0].length).trim();
    return { cleaned: cleaned || null, supplierPrefix: prefix };
  }
  return { cleaned: leading.trim() || null, supplierPrefix: null };
}

export function normalizeLithuanianAddress(
  value: string,
  defaultCity = LOGISTICS_EXCEL_V1.defaultCity,
  defaultCountry = LOGISTICS_EXCEL_V1.defaultCountry,
): string {
  let text = value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/([A-ZĄČĘĖĮŠŲŪŽ])\.(?=[A-ZĄČĘĖĮŠŲŪŽ])/gu, '$1. ')
    .replace(/\b(g|pr|pl|al|a|skg)\.(?=\d)/giu, '$1. ')
    .replace(/(\d+[A-Za-z]?)(?=[A-ZĄČĘĖĮŠŲŪŽ][a-ząčęėįšųūž])/gu, '$1, ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/,+/g, ',')
    .trim();

  text = text.replace(
    /([A-ZĄČĘĖĮŠŲŪŽ][\p{L}-]+)\s*,?\s*Lietuva\s+\1\s*,?\s*Lietuva$/iu,
    '$1, Lietuva',
  );

  const countryPattern = new RegExp(`(?:,|\\s)\\s*${escapeRegExp(defaultCountry)}$`, 'iu');
  const hadCountry = countryPattern.test(text);
  if (!hadCountry) {
    const lower = text.toLocaleLowerCase('lt-LT');
    if (!lower.includes(defaultCity.toLocaleLowerCase('lt-LT')) && !hasLocalityContext(text)) text += `, ${defaultCity}`;
    text += `, ${defaultCountry}`;
  }
  text = text
    .replace(/(\d+[A-Za-zĄČĘĖĮŠŲŪŽąčęėįšųūž]?)\s+([A-ZĄČĘĖĮŠŲŪŽ][\p{L}-]+)\s+(Lietuva)$/gu, '$1, $2, $3')
    .replace(new RegExp(`\\s*,?\\s*${escapeRegExp(defaultCountry)}$`, 'iu'), `, ${defaultCountry}`)
    .replace(new RegExp(`\\s*,?\\s*${escapeRegExp(defaultCity)}\\s*,?\\s*${escapeRegExp(defaultCountry)}$`, 'iu'), `, ${defaultCity}, ${defaultCountry}`)
    .replace(/\s+/g, ' ')
    .replace(/,\s*,/g, ',')
    .trim();
  return text;
}

function hasLocalityContext(value: string): boolean {
  return /\b(?:k|mstl|m|sen|r|raj)\.\s*/iu.test(value)
    || /,\s*\p{Lu}[\p{L}-]+(?:\s*,|\s*$)/u.test(value);
}

export function groupExcelRows(rows: ExcelSourceRow[]): ExcelDeliveryGroup[] {
  const included = rows.filter((row) => !row.excluded && row.normalizedAddress);
  const byAddress = new Map<string, ExcelSourceRow[]>();
  for (const row of included) {
    const key = row.manualGroupKey ?? addressKey(row.normalizedAddress!);
    const bucket = byAddress.get(key) ?? [];
    bucket.push(row);
    byAddress.set(key, bucket);
  }

  return [...byAddress.entries()].map(([key, lines]) => {
    const windows = lines
      .filter((line) => line.deliveryTimeFrom && line.deliveryTimeTo)
      .map((line) => ({ id: line.id, from: line.deliveryTimeFrom!, to: line.deliveryTimeTo! }));
    const from = windows.length ? windows.map((window) => window.from).sort(compareTime).at(-1)! : null;
    const to = windows.length ? windows.map((window) => window.to).sort(compareTime)[0]! : null;
    const timeConflict = Boolean(from && to && timeMinutes(from) >= timeMinutes(to));
    const lineIssues = uniqueStrings(lines.flatMap((line) => line.issueCodes)) as ExcelImportIssueCode[];
    const issueCodes = uniqueStrings([
      ...lineIssues,
      ...(timeConflict ? ['TIME_WINDOW_CONFLICT'] : []),
    ]) as ExcelImportIssueCode[];
    return {
      id: `excel-group-${stableKey(key)}`,
      normalizedAddressKey: key,
      originalAddress: lines[0]!.originalAddress!,
      normalizedAddress: lines[0]!.normalizedAddress!,
      lineIds: lines.map((line) => line.id),
      orderNumbers: uniqueStrings(lines.map((line) => line.orderNumber)),
      recipients: uniqueStrings(lines.map((line) => line.recipient)),
      totalWeightGrams: lines.reduce((sum, line) => sum + (line.weightGrams ?? 0), 0),
      knownWeightLineCount: lines.filter((line) => line.weightGrams !== null).length,
      unknownWeightLineCount: lines.filter((line) => line.weightGrams === null).length,
      deliveryTimeFrom: timeConflict ? null : from,
      deliveryTimeTo: timeConflict ? null : to,
      issueCodes,
      conflictingLineIds: timeConflict ? windows.map((window) => window.id) : [],
    };
  });
}

export function readXlsxWorkbook(bytes: Uint8Array): WorkbookSheetData[] {
  let archive: Record<string, Uint8Array>;
  try {
    archive = unzipSync(bytes);
  } catch {
    throw new Error('Failas nėra teisingas .xlsx archyvas.');
  }
  const workbookXml = readArchiveText(archive, 'xl/workbook.xml');
  const relsXml = readArchiveText(archive, 'xl/_rels/workbook.xml.rels');
  const sharedStrings = archive['xl/sharedStrings.xml']
    ? parseSharedStrings(strFromU8(archive['xl/sharedStrings.xml']!))
    : [];
  const relationships = new Map<string, string>();
  for (const match of relsXml.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)) {
    const id = xmlAttribute(match[0], 'Id');
    const target = xmlAttribute(match[0], 'Target');
    if (id && target) relationships.set(id, normalizeSheetTarget(target));
  }
  const result: WorkbookSheetData[] = [];
  for (const match of workbookXml.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)) {
    const nameValue = xmlAttribute(match[0], 'name');
    const relationshipId = xmlAttribute(match[0], 'r:id');
    if (!nameValue || !relationshipId) continue;
    const name = decodeXml(nameValue);
    const target = relationships.get(relationshipId);
    if (!target || !archive[target]) continue;
    result.push({ name, rows: parseSheetRows(strFromU8(archive[target]!), sharedStrings) });
  }
  return result;
}

function parseRows(
  sheet: WorkbookSheetData,
  importId: string,
  mapping: ExcelColumnMapping,
  firstDataRow: number,
  template: LogisticsExcelTemplate,
): ExcelSourceRow[] {
  return sheet.rows
    .filter((row) => row.rowNumber >= firstDataRow && isDeliveryDataRow(row, mapping))
    .map((row) => parseSourceRow(row, sheet.name, importId, mapping, template));
}

function parseSourceRow(
  row: WorkbookRow,
  sheetName: string,
  importId: string,
  mapping: ExcelColumnMapping,
  template: LogisticsExcelTemplate,
): ExcelSourceRow {
  const rawD = cellText(row, mapping.companyOrSupplier);
  const rawE = cellText(row, mapping.deliveryAddress);
  const explicitRecipient = mapping.recipient ? cellText(row, mapping.recipient) : null;
  const supplierD = stripSupplierPrefix(rawD, template.supplierPrefixes);
  const supplierE = stripSupplierPrefix(rawE, template.supplierPrefixes);
  const supplierRecipient = stripSupplierPrefix(explicitRecipient, template.supplierPrefixes);
  const dSourceAddress = extractAddressText(supplierD.cleaned);
  const eSourceAddress = extractAddressText(supplierE.cleaned);
  const dAddress = dSourceAddress ? normalizeLithuanianAddress(dSourceAddress, template.defaultCity, template.defaultCountry) : null;
  const eAddress = eSourceAddress ? normalizeLithuanianAddress(eSourceAddress, template.defaultCity, template.defaultCountry) : null;
  const addressConflict = Boolean(dAddress && eAddress && addressKey(dAddress) !== addressKey(eAddress));
  const originalAddress = eAddress ? eSourceAddress : dAddress ? dSourceAddress : null;
  const normalizedAddress = originalAddress
    ? normalizeLithuanianAddress(originalAddress, template.defaultCity, template.defaultCountry)
    : null;
  const weightRaw = cellText(row, mapping.weightKg);
  const weight = parseLithuanianWeightToGrams(row.cells[mapping.weightKg] ?? null);
  const timeRaw = cellText(row, mapping.deliveryTime);
  const time = parseDeliveryTimeWindow(timeRaw);
  const issueCodes: ExcelImportIssueCode[] = [];
  if (!normalizedAddress) issueCodes.push('ADDRESS_MISSING');
  if (addressConflict) issueCodes.push('ADDRESS_SOURCE_CONFLICT');
  if (weight.issue) issueCodes.push(weight.issue);
  if (time.issue) issueCodes.push(time.issue);
  const recipient = supplierRecipient.cleaned ?? recipientFromCompanyText(supplierD.cleaned);
  const routeCode = detectRouteCode(row, mapping.routeCode);

  return {
    id: `${importId}:row:${row.rowNumber}`,
    sourceImportId: importId,
    sourceSheetName: sheetName,
    sourceRowNumber: row.rowNumber,
    orderNumber: cellText(row, mapping.orderNumber)?.trim() || null,
    weightGrams: weight.grams,
    weightRaw,
    deliveryTimeFrom: time.from,
    deliveryTimeTo: time.to,
    deliveryTimeRaw: timeRaw,
    supplierPrefix: supplierD.supplierPrefix ?? supplierE.supplierPrefix ?? supplierRecipient.supplierPrefix,
    recipient,
    routeCode,
    rawColumnD: rawD,
    rawColumnE: rawE,
    rawRow: row.cells,
    originalAddress,
    normalizedAddress,
    alternateAddress: addressConflict ? dAddress : null,
    manualGroupKey: null,
    issueCodes,
    excluded: false,
  };
}

function detectColumnMapping(
  sheet: WorkbookSheetData,
  template: LogisticsExcelTemplate,
): { mapping: ExcelColumnMapping; firstDataRow: number; recognized: boolean } {
  const mapping: ExcelColumnMapping = { ...template.columns };
  let headerMatches = 0;
  let headerRow = 0;
  const definitions: { role: keyof ExcelColumnMapping; pattern: RegExp }[] = [
    { role: 'orderNumber', pattern: /užsak|order|siunt/iu },
    { role: 'weightKg', pattern: /svor|kg/iu },
    { role: 'deliveryTime', pattern: /laik|interval/iu },
    { role: 'companyOrSupplier', pattern: /įmon|tiekėj|klient/iu },
    { role: 'deliveryAddress', pattern: /pristat.*adres|adresas/iu },
    { role: 'recipient', pattern: /gavėj|pavadinim/iu },
    { role: 'routeCode', pattern: /maršrut|route|kodas|krypt/iu },
  ];
  for (const row of sheet.rows.slice(0, 20)) {
    let rowMatches = 0;
    const candidate = { ...mapping };
    for (const [column, value] of Object.entries(row.cells)) {
      const text = String(value ?? '').trim();
      for (const definition of definitions) {
        if (!definition.pattern.test(text)) continue;
        candidate[definition.role] = column;
        rowMatches += 1;
        break;
      }
    }
    if (rowMatches > headerMatches) {
      headerMatches = rowMatches;
      headerRow = row.rowNumber;
      Object.assign(mapping, candidate);
    }
  }
  const firstData = sheet.rows.find((row) => {
    if (row.rowNumber <= headerRow) return false;
    const order = cellText(row, mapping.orderNumber);
    const address = cellText(row, mapping.deliveryAddress) ?? cellText(row, mapping.companyOrSupplier);
    return Boolean(order && ORDER_NUMBER.test(order.trim())) || Boolean(address && looksLikeAddress(address));
  });
  const defaultPatternScore = sheet.rows.slice(0, 60).filter((row) => {
    const order = cellText(row, template.columns.orderNumber);
    const address = cellText(row, template.columns.deliveryAddress) ?? cellText(row, template.columns.companyOrSupplier);
    return Boolean(order && ORDER_NUMBER.test(order.trim()) && address);
  }).length;
  return {
    mapping,
    firstDataRow: firstData?.rowNumber ?? Math.max(1, headerRow + 1),
    recognized: headerMatches >= 3 || defaultPatternScore >= 2,
  };
}

function scoreSheet(sheet: WorkbookSheetData, template: LogisticsExcelTemplate): number {
  const detected = detectColumnMapping(sheet, template);
  const usableRows = sheet.rows
    .filter((row) => row.rowNumber >= detected.firstDataRow && isDeliveryDataRow(row, detected.mapping))
    .length;
  return (detected.recognized ? 100 : 0) + usableRows;
}

export function summarizeExcelRows(rows: ExcelSourceRow[], groups: ExcelDeliveryGroup[]): ExcelImportSummary {
  const included = rows.filter((row) => !row.excluded);
  const duplicateOrders = new Set(
    included.filter((row) => row.issueCodes.includes('DUPLICATE_ORDER_NUMBER')).map((row) => row.orderNumber).filter(Boolean),
  );
  return {
    sourceRowCount: rows.length,
    includedRowCount: included.length,
    uniqueOrderCount: new Set(included.map((row) => row.orderNumber).filter(Boolean)).size,
    physicalStopCount: groups.length,
    totalWeightGrams: included.reduce((sum, row) => sum + (row.weightGrams ?? 0), 0),
    unknownWeightLineCount: included.filter((row) => row.weightGrams === null).length,
    routeCodes: uniqueStrings(included.map((row) => row.routeCode)),
    unconfirmedAddressCount: included.filter((row) => !row.normalizedAddress || row.issueCodes.includes('ADDRESS_SOURCE_CONFLICT')).length,
    timeWindowConflictCount: groups.filter((group) => group.issueCodes.includes('TIME_WINDOW_CONFLICT')).length,
    possibleDuplicateCount: duplicateOrders.size,
  };
}

function markDuplicateOrders(rows: ExcelSourceRow[]): ExcelSourceRow[] {
  const counts = new Map<string, number>();
  for (const row of rows) if (row.orderNumber) counts.set(row.orderNumber, (counts.get(row.orderNumber) ?? 0) + 1);
  return rows.map((row) => row.orderNumber && (counts.get(row.orderNumber) ?? 0) > 1
    ? { ...row, issueCodes: uniqueStrings([...row.issueCodes, 'DUPLICATE_ORDER_NUMBER']) as ExcelImportIssueCode[] }
    : row);
}

function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((match) =>
    decodeXml([...match[1]!.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((part) => part[1]).join('')),
  );
}

function parseSheetRows(xml: string, sharedStrings: string[]): WorkbookRow[] {
  const rows: WorkbookRow[] = [];
  for (const rowMatch of xml.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const rowNumber = Number(rowMatch[1]!.match(/\br="(\d+)"/)?.[1] ?? rows.length + 1);
    const cells: Record<string, ExcelCellValue> = {};
    for (const cellMatch of rowMatch[2]!.matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const attrs = cellMatch[1]!;
      const reference = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      if (!reference) continue;
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] ?? 'n';
      const body = cellMatch[2] ?? '';
      const rawValue = body.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1] ?? null;
      if (type === 'inlineStr') {
        cells[reference] = decodeXml([...body.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((part) => part[1]).join(''));
      } else if (type === 's') {
        cells[reference] = rawValue === null ? null : sharedStrings[Number(rawValue)] ?? null;
      } else if (type === 'b') {
        cells[reference] = rawValue === '1';
      } else if (type === 'str') {
        cells[reference] = rawValue === null ? null : decodeXml(rawValue);
      } else if (rawValue !== null && rawValue.trim() !== '') {
        const numeric = Number(rawValue);
        cells[reference] = Number.isFinite(numeric) ? numeric : decodeXml(rawValue);
      } else {
        cells[reference] = null;
      }
    }
    rows.push({ rowNumber, cells });
  }
  return rows;
}

function readArchiveText(archive: Record<string, Uint8Array>, path: string): string {
  const data = archive[path];
  if (!data) throw new Error(`Excel struktūroje trūksta ${path}.`);
  return strFromU8(data);
}

function xmlAttribute(tag: string, name: string): string | null {
  const escaped = name.replace(':', '\\:');
  return tag.match(new RegExp(`(?:^|\\s)${escaped}="([^"]*)"`, 'i'))?.[1] ?? null;
}

function normalizeSheetTarget(target: string): string {
  const normalized = target.replace(/\\/g, '/').replace(/^\//, '');
  return normalized.startsWith('xl/') ? normalized : `xl/${normalized.replace(/^\.\//, '')}`;
}

function detectRouteCode(row: WorkbookRow, mappedColumn: string | null): string | null {
  const mapped = normalizeRegionCode(cellText(row, mappedColumn));
  if (mapped) return mapped;
  for (const value of Object.values(row.cells)) {
    const code = normalizeRegionCode(value);
    if (code) return code;
  }
  return null;
}

function cellText(row: WorkbookRow, column: string | null): string | null {
  if (!column) return null;
  const value = row.cells[column.toUpperCase()] ?? null;
  return value === null ? null : String(value);
}

function hasVisibleCells(row: WorkbookRow): boolean {
  return Object.values(row.cells).some((value) => value !== null && String(value).trim() !== '');
}

function isDeliveryDataRow(row: WorkbookRow, mapping: ExcelColumnMapping): boolean {
  const order = cellText(row, mapping.orderNumber)?.trim() ?? '';
  if (ORDER_NUMBER.test(order)) return true;
  const address = cellText(row, mapping.deliveryAddress) ?? cellText(row, mapping.companyOrSupplier);
  const weight = cellText(row, mapping.weightKg);
  const time = cellText(row, mapping.deliveryTime);
  return Boolean(address && extractAddressText(address) && (weight || time));
}

function supplierTokenPattern(token: string): string {
  const compact = token.replace(/\./g, '');
  if (/^[A-Z]{2,3}$/iu.test(compact)) {
    return compact.split('').map((letter) => `${escapeRegExp(letter)}\\s*\\.?\\s*`).join('');
  }
  return escapeRegExp(token);
}

export function looksLikeAddress(value: string): boolean {
  return STREET_MARKER.test(value.replace(/([A-Za-zĄČĘĖĮŠŲŪŽąčęėįšųūž])\.(?=\d)/g, '$1. '));
}

function looksLikeLooseStreetAddress(value: string): boolean {
  return /^\p{L}[\p{L}\s.'’‘-]+\s\d+[A-ZĄČĘĖĮŠŲŪŽ]?(?:\s*,.*)?$/iu.test(value.trim());
}

export function extractAddressText(value: string | null): string | null {
  if (!value) return null;
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const addressLine = lines.findIndex((line) => looksLikeAddress(line));
  if (addressLine >= 0) return joinAddressLines(lines, addressLine);
  const looseAddressLine = lines.findIndex((line) => looksLikeLooseStreetAddress(line));
  if (looseAddressLine >= 0) return joinAddressLines(lines, looseAddressLine);
  return looksLikeAddress(value) ? value.trim() : null;
}

function joinAddressLines(lines: string[], start: number): string | null {
  const addressLines = lines.slice(start);
  // Some operational workbooks repeat district/country below an already
  // complete multiline address. Once the country is present, later lines are
  // no longer part of that address and must not change its grouping key.
  const countryLine = addressLines.findIndex((line) => /\bLietuva\b/iu.test(line));
  const selected = countryLine >= 0 ? addressLines.slice(0, countryLine + 1) : addressLines;
  return selected.join(' ').trim() || null;
}

function recipientFromCompanyText(value: string | null): string | null {
  if (!value) return null;
  if (!looksLikeAddress(value)) return value.trim() || null;
  const match = value.match(STREET_MARKER);
  const prefix = match?.index ? value.slice(0, match.index).replace(/[,:;-]+$/, '').trim() : '';
  return prefix || null;
}

function addressKey(value: string): string {
  return value.toLocaleLowerCase('lt-LT').replace(/[^a-ząčęėįšųūž0-9]/giu, '');
}

function stableKey(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function timeMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours! * 60 + minutes!;
}

function compareTime(left: string, right: string): number {
  return timeMinutes(left) - timeMinutes(right);
}

function uniqueStrings(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
