import { strToU8, zipSync } from 'fflate';

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
};

export type TripSheetWorkbookInput = {
  companyName: string;
  companyAddress: string;
  groups: TripSheetExportGroup[];
};

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export { MIME_XLSX };

export function buildTripSheetWorkbook(input: TripSheetWorkbookInput): Uint8Array {
  if (input.groups.length === 0) throw new Error('Nėra kelionės lapų, kuriuos būtų galima eksportuoti.');
  const names = uniqueSheetNames(input.groups);
  const sheets = input.groups.map((group, index) => worksheetXml(group, input, names[index]!));
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
  sheets.forEach((sheet, index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = xml(sheet); });
  return zipSync(files, { level: 6 });
}

function worksheetXml(group: TripSheetExportGroup, input: TripSheetWorkbookInput, sheetName: string): string {
  const firstDataRow = 7;
  const lastDataRow = firstDataRow + group.rows.length - 1;
  const totalRow = Math.max(firstDataRow, lastDataRow + 1);
  const rows = [
    rowXml(1, [textCell('A1', 'Kelionės lapų ataskaita', 1)]),
    rowXml(2, [textCell('A2', [input.companyName, input.companyAddress].filter(Boolean).join(', ') || 'FiRo', 2)]),
    rowXml(3, [
      textCell('A3', 'Transporto priemonė:', 3), textCell('B3', `${group.registrationNumber} · ${group.vehicleModel}`, 3),
      textCell('D3', 'Degalų norma:', 3), textCell('E3', group.fuelNormLitersPer100Km === null ? '—' : `${formatPlain(group.fuelNormLitersPer100Km)} L/100 km`, 3),
      textCell('G3', 'Kuro tipas:', 3), textCell('H3', group.fuelType, 3),
    ]),
    rowXml(4, [
      textCell('A4', 'Vairuotojas:', 3), textCell('B4', group.driverName, 3),
      textCell('D4', 'Laikotarpis:', 3), textCell('E4', monthPeriod(group.month), 3),
    ]),
    rowXml(6, HEADERS.map((value, index) => textCell(`${columnName(index + 1)}6`, value, 4))),
    ...group.rows.map((item, index) => {
      const rowNumber = firstDataRow + index;
      return rowXml(rowNumber, [
        textCell(`A${rowNumber}`, item.date, 5),
        textCell(`B${rowNumber}`, item.route, 5),
        numberCell(`C${rowNumber}`, item.distanceKm, 6),
        numberCell(`D${rowNumber}`, item.fuelStartLiters, 6),
        numberCell(`E${rowNumber}`, item.fuelAddedLiters, 6),
        textCell(`F${rowNumber}`, item.receiptNumbers.join(' / '), 5),
        numberCell(`G${rowNumber}`, item.fuelConsumedLiters, 6),
        numberCell(`H${rowNumber}`, item.fuelEndLiters, 6),
        numberCell(`I${rowNumber}`, item.startOdometer, 6),
        numberCell(`J${rowNumber}`, item.endOdometer, 6),
        textCell(`K${rowNumber}`, item.driverName, 5),
      ]);
    }),
    rowXml(totalRow, [
      textCell(`A${totalRow}`, 'Iš viso:', 7),
      textCell(`B${totalRow}`, '', 7),
      formulaCell(`C${totalRow}`, sumFormula('C', firstDataRow, lastDataRow), sum(group.rows.map((row) => row.distanceKm)), 8),
      textCell(`D${totalRow}`, '', 7),
      formulaCell(`E${totalRow}`, sumFormula('E', firstDataRow, lastDataRow), sum(group.rows.map((row) => row.fuelAddedLiters)), 8),
      textCell(`F${totalRow}`, '', 7),
      formulaCell(`G${totalRow}`, sumFormula('G', firstDataRow, lastDataRow), sum(group.rows.map((row) => row.fuelConsumedLiters)), 8),
      numberCell(`H${totalRow}`, group.rows.at(-1)?.fuelEndLiters ?? null, 8),
      numberCell(`I${totalRow}`, group.rows.find((row) => row.startOdometer !== null)?.startOdometer ?? null, 8),
      numberCell(`J${totalRow}`, [...group.rows].reverse().find((row) => row.endOdometer !== null)?.endOdometer ?? null, 8),
      textCell(`K${totalRow}`, '', 7),
    ]),
  ].join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:K${totalRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${COL_WIDTHS.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${rows}</sheetData><mergeCells count="4"><mergeCell ref="A1:K1"/><mergeCell ref="A2:K2"/><mergeCell ref="E4:J4"/><mergeCell ref="A${totalRow}:B${totalRow}"/></mergeCells><autoFilter ref="A6:K${Math.max(6, lastDataRow)}"/><pageMargins left="0.25" right="0.25" top="0.45" bottom="0.45" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;L${escapeXml(sheetName)}&amp;R&amp;P / &amp;N</oddFooter></headerFooter></worksheet>`;
}

const HEADERS = ['Data', 'Važiavimo maršrutas', 'Nuvažiuota, km', 'Kuro kiekis dienos pradžioje, L', 'Įpilta kuro, L', 'Kasos čekio Nr.', 'Sunaudota pagal normą, L', 'Kuro likutis, L', 'Odometras pradžioje', 'Odometras pabaigoje', 'Vairuotojas'];
const COL_WIDTHS = [12, 32, 14, 18, 14, 18, 20, 16, 18, 18, 22];

function rowXml(index: number, cells: string[]): string { return `<row r="${index}">${cells.join('')}</row>`; }
function textCell(ref: string, value: string, style: number): string { return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`; }
function numberCell(ref: string, value: number | null, style: number): string { return value === null ? `<c r="${ref}" s="${style}"/>` : `<c r="${ref}" s="${style}"><v>${finite(value)}</v></c>`; }
function formulaCell(ref: string, formula: string, value: number, style: number): string { return `<c r="${ref}" s="${style}"><f>${formula}</f><v>${finite(value)}</v></c>`; }
function sumFormula(column: string, first: number, last: number): string { return last < first ? '0' : `SUM(${column}${first}:${column}${last})`; }
function sum(values: (number | null)[]): number { return values.reduce<number>((total, value) => total + (value ?? 0), 0); }
function finite(value: number): string { return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0'; }
function formatPlain(value: number): string { return new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 2 }).format(value); }
function xml(value: string): Uint8Array { return strToU8(value); }
const ILLEGAL_XML_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
function escapeXml(value: string): string {
  // Route/address text can come from OCR'd photos or pasted spreadsheet
  // cells and occasionally carries stray control characters. Those are
  // illegal in XML 1.0 even when entity-escaped, and Excel responds to one
  // anywhere in the workbook by discarding the sheet's content and showing
  // the "we found a problem" repair prompt.
  return value.replace(ILLEGAL_XML_CHARS, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function columnName(index: number): string { let value = index; let result = ''; while (value > 0) { const remainder = (value - 1) % 26; result = String.fromCharCode(65 + remainder) + result; value = Math.floor((value - 1) / 26); } return result; }
function monthPeriod(month: string): string { const [year, monthNumber] = month.split('-').map(Number); if (!year || !monthNumber) return month; const last = new Date(year, monthNumber, 0).getDate(); return `${month}-01 - ${month}-${String(last).padStart(2, '0')}`; }
/** Excel rejects core.xml W3CDTF timestamps with milliseconds and then "repairs" the file empty. */
export function officeOpenXmlTimestamp(now = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
function uniqueSheetNames(groups: TripSheetExportGroup[]): string[] { const used = new Set<string>(); return groups.map((group, index) => { const base = `${group.registrationNumber || group.driverName || `Lapas ${index + 1}`} ${group.month}`.replace(/[\\/*?:\[\]]/g, ' ').trim().slice(0, 31) || `Lapas ${index + 1}`; let candidate = base; let suffix = 2; while (used.has(candidate)) { const tail = ` ${suffix++}`; candidate = `${base.slice(0, 31 - tail.length)}${tail}`; } used.add(candidate); return candidate; }); }

function contentTypesXml(sheetCount: number): string { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${Array.from({ length: sheetCount }, (_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`; }
function rootRelsXml(): string { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`; }
function workbookXml(names: string[]): string { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`; }
function workbookRelsXml(sheetCount: number): string { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Array.from({ length: sheetCount }, (_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`; }
function appXml(names: string[]): string { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>FiRo</Application><TitlesOfParts><vt:vector size="${names.length}" baseType="lpstr">${names.map((name) => `<vt:lpstr>${escapeXml(name)}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts></Properties>`; }
function coreXml(now: string): string { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>FiRo</dc:creator><cp:lastModifiedBy>FiRo</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`; }
function stylesXml(): string { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.0"/></numFmts><fonts count="3"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="16"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7E6E6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0"/><xf numFmtId="164" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`; }
