import { strToU8, zipSync } from 'fflate';

import { TRIP_SHEET_PRINT_COLUMNS, tripSheetColumnLegend } from './columns';

export type TripSheetExportRow = {
  date: string;
  driverName: string;
  route: string;
  distanceKm: number | null;
  fuelStartLiters: number | null;
  fuelAddedLiters: number;
  receiptNumbers: string[];
  fuelConsumedLiters: number | null;
  fuelEndLiters: number | null;
  startOdometer: number | null;
  endOdometer: number | null;
};

export type TripSheetExportGroup = {
  month: string;
  /** Summary line for the header (e.g. joined names) — each row also carries its own driverName. */
  driverName: string;
  registrationNumber: string;
  vehicleModel: string;
  fuelNormLitersPer100Km: number | null;
  fuelType: string;
  rows: TripSheetExportRow[];
  /** Numbered per-driver sheet ("Kelionės lapas Nr. N"); null/undefined = continuous month sheet. */
  sheetNumber?: number | null;
  /** Worksheet tab name base (e.g. "NLL182 Karolis Nr.2"); falls back to "<plate> <month>". */
  sheetLabel?: string;
  /** Period range for this sheet; falls back to the workbook period, then the month range. */
  periodLabel?: string;
};

export type TripSheetWorkbookInput = {
  companyName: string;
  companyAddress: string;
  /** Filter period shown on the PDF (`Laikotarpis`). Falls back to the vehicle-month range. */
  periodLabel?: string;
  /** Append the Suvestinė sheet (last, never sheet1). Default true. */
  includeSummary?: boolean;
  groups: TripSheetExportGroup[];
};

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export { MIME_XLSX };

const SUMMARY_SHEET_NAME = 'Suvestinė';
const PRINT_HEADERS = TRIP_SHEET_PRINT_COLUMNS.map((column) => column.short);
const PRINT_COL_WIDTHS = [12, 16, 28, 12, 12, 10, 12, 10, 16, 12, 12];
const SUMMARY_HEADERS = [
  'Transporto priemonė',
  'Modelis',
  'Laikotarpis',
  'Vairuotojas',
  'Dienų sk.',
  'Nuvažiuota, km',
  'Įpilta, L',
  'Sunaudota, L',
  'Kuro likutis, L',
  'Odometras pradžioje',
  'Odometras pabaigoje',
];
const SUMMARY_COL_WIDTHS = [18, 22, 22, 28, 12, 16, 12, 14, 16, 20, 20];
const SIGNATURE_LINES = [
  'Kelionės lapą išdavė ______________________________ (vardas, pavardė, parašas, data)',
  'Vadovas ______________________________ (vardas, pavardė, parašas, data)',
  'Kelionės lapą priėmė ______________________________ (vardas, pavardė, parašas, data)',
];

/**
 * Excel Desktop repairs any worksheet whose child elements are out of the
 * ECMA-376 sequence (the previous writer put mergeCells before autoFilter,
 * froze panes without a selection, and emitted SUM formulas). The repair
 * keeps sheet *names* and strips every cell — which is the blank MET630 /
 * NLL182 / LRI* workbook Karolis opened.
 *
 * This builder writes a minimal workbook Excel never strips:
 * - first sheet is a real kelionės lapas (busiest vehicle-month), matching
 *   the PDF from print-document.ts / TRIP_SHEET_PRINT_COLUMNS;
 * - one worksheet per vehicle-month, Suvestinė last if kept;
 * - inline strings + numeric <v> values, no autoFilter / freeze / formula /
 *   headerFooter / mergeCells.
 */
export function buildTripSheetWorkbook(input: TripSheetWorkbookInput): Uint8Array {
  if (input.groups.length === 0) throw new Error('Nėra kelionės lapų, kuriuos būtų galima eksportuoti.');
  const groups = sortGroupsByBusiest(input.groups);
  const vehicleNames = uniqueSheetNames(groups);
  const withSummary = input.includeSummary ?? true;
  const names = withSummary ? [...vehicleNames, SUMMARY_SHEET_NAME] : vehicleNames;
  const sheets = [
    ...groups.map((group, index) => vehicleWorksheetXml(group, input, index === 0)),
    ...(withSummary ? [summaryWorksheetXml({ ...input, groups })] : []),
  ];
  const now = officeOpenXmlTimestamp();
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': xml(contentTypesXml(sheets.length)),
    '_rels/.rels': xml(rootRelsXml()),
    'docProps/app.xml': xml(appXml(names)),
    'docProps/core.xml': xml(coreXml(now)),
    'xl/workbook.xml': xml(workbookXml(names)),
    'xl/_rels/workbook.xml.rels': xml(workbookRelsXml(sheets.length)),
    'xl/styles.xml': xml(stylesXml()),
  };
  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = xml(sheet);
  });
  // fflate may return a view into a larger buffer. Excel / Blob downloads that
  // see .buffer (or a SharedArrayBuffer-backed view) get extra bytes and the
  // ZIP looks truncated. Always hand back a packed copy.
  return packedBytes(zipSync(files, { level: 6 }));
}

/** Copy into a new ArrayBuffer so callers never pass a sliced .buffer to Blob. */
export function packedBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function summaryWorksheetXml(input: TripSheetWorkbookInput): string {
  const firstDataRow = 5;
  const lastDataRow = firstDataRow + input.groups.length - 1;
  const totalRow = lastDataRow + 1;
  const company = [input.companyName, input.companyAddress].filter(Boolean).join(', ') || 'FiRo';
  const rows = [
    rowXml(1, [textCell('A1', 'Kelionės lapų suvestinė', 1)]),
    rowXml(2, [textCell('A2', company, 2)]),
    rowXml(4, SUMMARY_HEADERS.map((value, index) => textCell(`${columnName(index + 1)}4`, value, 4))),
    ...input.groups.map((group, index) => {
      const rowNumber = firstDataRow + index;
      const totals = groupTotals(group);
      return rowXml(rowNumber, [
        textCell(`A${rowNumber}`, group.registrationNumber, 5),
        textCell(`B${rowNumber}`, group.vehicleModel, 5),
        textCell(`C${rowNumber}`, monthPeriod(group.month), 5),
        textCell(`D${rowNumber}`, group.driverName, 5),
        numberCell(`E${rowNumber}`, group.rows.length, 6),
        numberCell(`F${rowNumber}`, totals.distanceKm, 6),
        numberCell(`G${rowNumber}`, totals.fuelAddedLiters, 6),
        numberCell(`H${rowNumber}`, totals.fuelConsumedLiters, 6),
        numberCell(`I${rowNumber}`, totals.fuelEndLiters, 6),
        numberCell(`J${rowNumber}`, totals.startOdometer, 6),
        numberCell(`K${rowNumber}`, totals.endOdometer, 6),
      ]);
    }),
    rowXml(totalRow, [
      textCell(`A${totalRow}`, 'Iš viso', 7),
      textCell(`B${totalRow}`, '', 7),
      textCell(`C${totalRow}`, '', 7),
      textCell(`D${totalRow}`, '', 7),
      numberCell(`E${totalRow}`, input.groups.reduce((total, group) => total + group.rows.length, 0), 8),
      numberCell(`F${totalRow}`, sum(input.groups.map((group) => groupTotals(group).distanceKm)), 8),
      numberCell(`G${totalRow}`, sum(input.groups.map((group) => groupTotals(group).fuelAddedLiters)), 8),
      numberCell(`H${totalRow}`, sum(input.groups.map((group) => groupTotals(group).fuelConsumedLiters)), 8),
      textCell(`I${totalRow}`, '', 7),
      textCell(`J${totalRow}`, '', 7),
      textCell(`K${totalRow}`, '', 7),
    ]),
  ].join('');
  return worksheetXml(rows, `A1:K${totalRow}`, SUMMARY_COL_WIDTHS, false);
}

function vehicleWorksheetXml(group: TripSheetExportGroup, input: TripSheetWorkbookInput, selected: boolean): string {
  const headerRow = 6;
  const firstDataRow = 7;
  const lastDataRow = firstDataRow + Math.max(group.rows.length, 1) - 1;
  const totalRow = group.rows.length === 0 ? firstDataRow + 1 : lastDataRow + 1;
  const legendRow = totalRow + 2;
  const firstSignatureRow = legendRow + 2;
  const lastRow = firstSignatureRow + SIGNATURE_LINES.length - 1;
  const totals = groupTotals(group);
  const company = [input.companyName, input.companyAddress].filter(Boolean).join(', ') || 'FiRo';
  const period = group.periodLabel?.trim() || input.periodLabel?.trim() || monthPeriod(group.month);
  const title = group.sheetNumber == null ? 'Kelionės lapas' : `Kelionės lapas Nr. ${group.sheetNumber}`;
  const dataRows = group.rows.length === 0
    ? [rowXml(firstDataRow, [textCell(`A${firstDataRow}`, 'Nėra dienų šiame laikotarpyje.', 5)])]
    : group.rows.map((item, index) => {
      const rowNumber = firstDataRow + index;
      return rowXml(rowNumber, [
        textCell(`A${rowNumber}`, item.date, 5),
        textCell(`B${rowNumber}`, item.driverName, 5),
        textCell(`C${rowNumber}`, item.route, 5),
        numberCell(`D${rowNumber}`, item.startOdometer, 6),
        numberCell(`E${rowNumber}`, item.endOdometer, 6),
        numberCell(`F${rowNumber}`, item.distanceKm, 6),
        numberCell(`G${rowNumber}`, item.fuelStartLiters, 6),
        numberCell(`H${rowNumber}`, item.fuelAddedLiters, 6),
        textCell(`I${rowNumber}`, item.receiptNumbers.filter(Boolean).join(' / '), 5),
        numberCell(`J${rowNumber}`, item.fuelConsumedLiters, 6),
        numberCell(`K${rowNumber}`, item.fuelEndLiters, 6),
      ]);
    });
  const rows = [
    rowXml(1, [textCell('A1', title, 1)]),
    rowXml(2, [textCell('A2', company, 2)]),
    rowXml(3, [
      textCell('A3', 'Transporto priemonė:', 3),
      textCell('B3', `${group.vehicleModel} · ${group.registrationNumber}`, 3),
      textCell('D3', 'Degalų norma:', 3),
      textCell('E3', formatFuelNorm(group.fuelNormLitersPer100Km), 3),
      textCell('G3', 'Kuro tipas:', 3),
      textCell('H3', group.fuelType, 3),
    ]),
    rowXml(4, [
      textCell('A4', 'Vairuotojas(-ai):', 3),
      textCell('B4', group.driverName, 3),
      textCell('D4', 'Laikotarpis:', 3),
      textCell('E4', period, 3),
      textCell('G4', 'Mėnuo:', 3),
      textCell('H4', monthLabel(group.month), 3),
    ]),
    rowXml(headerRow, PRINT_HEADERS.map((value, index) => textCell(`${columnName(index + 1)}${headerRow}`, value, 4))),
    ...dataRows,
    rowXml(totalRow, [
      textCell(`A${totalRow}`, '', 7),
      textCell(`B${totalRow}`, '', 7),
      textCell(`C${totalRow}`, 'Iš viso', 7),
      numberCell(`D${totalRow}`, totals.startOdometer, 8),
      numberCell(`E${totalRow}`, totals.endOdometer, 8),
      numberCell(`F${totalRow}`, totals.distanceKm, 8),
      textCell(`G${totalRow}`, '', 7),
      numberCell(`H${totalRow}`, totals.fuelAddedLiters, 8),
      textCell(`I${totalRow}`, '', 7),
      numberCell(`J${totalRow}`, totals.fuelConsumedLiters, 8),
      numberCell(`K${totalRow}`, totals.fuelEndLiters, 8),
    ]),
    rowXml(legendRow, [textCell(`A${legendRow}`, tripSheetColumnLegend(TRIP_SHEET_PRINT_COLUMNS), 5)]),
    ...SIGNATURE_LINES.map((line, index) => rowXml(firstSignatureRow + index, [
      textCell(`A${firstSignatureRow + index}`, line, 3),
    ])),
  ].join('');
  return worksheetXml(rows, `A1:K${lastRow}`, PRINT_COL_WIDTHS, selected);
}

/**
 * Child order is the ECMA-376 CT_Worksheet sequence. Anything else makes Excel
 * Desktop "repair" the part into an empty sheet.
 */
function worksheetXml(sheetData: string, dimension: string, widths: number[], selected: boolean): string {
  const cols = widths
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join('');
  const selectedAttr = selected ? ' tabSelected="1"' : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="${dimension}"/><sheetViews><sheetView${selectedAttr} workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${sheetData}</sheetData><pageMargins left="0.25" right="0.25" top="0.45" bottom="0.45" header="0.3" footer="0.3"/></worksheet>`;
}

function groupTotals(group: TripSheetExportGroup) {
  return {
    distanceKm: sum(group.rows.map((row) => row.distanceKm)),
    fuelAddedLiters: sum(group.rows.map((row) => row.fuelAddedLiters)),
    fuelConsumedLiters: sum(group.rows.map((row) => row.fuelConsumedLiters)),
    fuelEndLiters: [...group.rows].reverse().find((row) => row.fuelEndLiters !== null)?.fuelEndLiters ?? null,
    startOdometer: group.rows.find((row) => row.startOdometer !== null)?.startOdometer ?? null,
    endOdometer: [...group.rows].reverse().find((row) => row.endOdometer !== null)?.endOdometer ?? null,
  };
}

function sortGroupsByBusiest(groups: TripSheetExportGroup[]): TripSheetExportGroup[] {
  return [...groups].sort((left, right) => {
    const rowDelta = right.rows.length - left.rows.length;
    if (rowDelta !== 0) return rowDelta;
    const kmDelta = sum(right.rows.map((row) => row.distanceKm)) - sum(left.rows.map((row) => row.distanceKm));
    if (kmDelta !== 0) return kmDelta;
    return (left.registrationNumber || left.driverName).localeCompare(right.registrationNumber || right.driverName, 'lt');
  });
}

function rowXml(index: number, cells: string[]): string {
  return `<row r="${index}">${cells.join('')}</row>`;
}

function textCell(ref: string, value: string, style: number): string {
  if (value === '') return `<c r="${ref}" s="${style}"/>`;
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function numberCell(ref: string, value: number | null, style: number): string {
  return value === null ? `<c r="${ref}" s="${style}"/>` : `<c r="${ref}" s="${style}"><v>${finite(value)}</v></c>`;
}

function sum(values: (number | null)[]): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function finite(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0';
}

function formatFuelNorm(value: number | null): string {
  return value === null ? '—' : `${new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 2 }).format(value)} L/100km`;
}

function xml(value: string): Uint8Array {
  return strToU8(value);
}

const ILLEGAL_XML_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function escapeXml(value: string): string {
  // Route/address text can come from OCR'd photos or pasted spreadsheet
  // cells and occasionally carries stray control characters. Those are
  // illegal in XML 1.0 even when entity-escaped, and Excel responds to one
  // anywhere in the workbook by discarding the sheet's content and showing
  // the "we found a problem" repair prompt.
  return value
    .replace(ILLEGAL_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(index: number): string {
  let value = index;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function monthPeriod(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return month;
  const last = new Date(year, monthNumber, 0).getDate();
  return `${month}-01 - ${month}-${String(last).padStart(2, '0')}`;
}

function monthLabel(month: string): string {
  const date = new Date(`${month}-15T12:00:00`);
  return Number.isNaN(date.getTime())
    ? month
    : new Intl.DateTimeFormat('lt-LT', { year: 'numeric', month: 'long' }).format(date);
}

/** Excel rejects core.xml W3CDTF timestamps with milliseconds and then "repairs" the file empty. */
export function officeOpenXmlTimestamp(now = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function uniqueSheetNames(groups: TripSheetExportGroup[]): string[] {
  const used = new Set<string>([SUMMARY_SHEET_NAME.toLowerCase()]);
  return groups.map((group, index) => {
    const rawBase = group.sheetLabel?.trim()
      || `${group.registrationNumber || group.driverName || `Lapas ${index + 1}`} ${group.month}`;
    const base = rawBase
      .replace(/[\\/*?:\[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 31) || `Lapas ${index + 1}`;
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate.toLowerCase())) {
      const tail = ` ${suffix++}`;
      candidate = `${base.slice(0, 31 - tail.length)}${tail}`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

function contentTypesXml(sheetCount: number): string {
  const sheets = Array.from({ length: sheetCount }, (_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

function rootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function workbookXml(names: string[]): string {
  const sheets = names
    .map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets}</sheets></workbook>`;
}

function workbookRelsXml(sheetCount: number): string {
  const sheets = Array.from({ length: sheetCount }, (_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets}<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function appXml(names: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>FiRo</Application><TitlesOfParts><vt:vector size="${names.length}" baseType="lpstr">${names.map((name) => `<vt:lpstr>${escapeXml(name)}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts></Properties>`;
}

function coreXml(now: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>FiRo</dc:creator><cp:lastModifiedBy>FiRo</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.0"/></numFmts><fonts count="3"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="16"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7E6E6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0"/><xf numFmtId="164" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}
