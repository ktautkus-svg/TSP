import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

import { excelPreviewToDraftStops, excelPreviewToImportResult } from '../../src/application/import/excel-route-mapper';
import {
  extractAddressText,
  filterExcelPreviewByRouteCodes,
  looksLikeAddress,
  normalizeLithuanianAddress,
  parseLithuanianWeightToGrams,
  parseLogisticsExcelWorkbook,
  stripSupplierPrefix,
} from '../../src/application/import/logistics-excel-v1';
import { ActivateRoute, CreateDraftRouteWithStops } from '../../src/application/routes/route-commands';
import { CompleteRoute, ConfirmRouteReturnArrival, MarkStopDelivered, MarkStopLoaded, SaveStartOdometer, StartRoute, StartRouteReturn } from '../../src/application/routes/route-workday';
import { ExcelImportRepository } from '../../src/database/repositories/excel-import-repository';
import { RouteRepository } from '../../src/database/repositories/route-repository';
import { ShipmentLineRepository } from '../../src/database/repositories/shipment-line-repository';
import { LOGISTICS_EXCEL_V1, type ExcelImportPreview } from '../../src/domain/import/excel-models';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureBytes = new Uint8Array(readFileSync(resolve(here, '../fixtures/realaus-formato-logistikos-importas-v1.xlsx')));
const realLayoutFixtureBytes = new Uint8Array(readFileSync(resolve(here, '../fixtures/realaus-darbo-lapo-formatas-v1.xlsx')));

function parseFixture(importId = 'excel-test'): ExcelImportPreview {
  return parseLogisticsExcelWorkbook(fixtureBytes, {
    importId,
    fileName: 'realaus-formato-logistikos-importas-v1.xlsx',
    fileHash: 'fixture-sha256',
  });
}

function pajuoscioWorkbook(): Uint8Array {
  const cell = (column: string, row: number, value: string | number) => typeof value === 'number'
    ? `<c r="${column}${row}"><v>${value}</v></c>`
    : `<c r="${column}${row}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
  const values: (string | number)[][] = [
    ['Užs. Nr.', 'Svoris', 'Stulpelis', 'Adresas', 'Pavadinimas', 'Kryptis'],
    ['S614031', 437.24, '08:00-16:00', 'UAB GaliasasP.Puzino g.12Panevėžys LT_97123Lietuva', 'UAB Galiasas', 'R54'],
    ['S614054', 17, '08:00-16:00', 'UAB GaliasasP.Puzino g.12Panevėžys LT_97123Lietuva', 'UAB Galiasas', 'R54'],
    ['S613364', 216.28, '06:00-15:00', 'Gynybos resursų agentūra prie Krašto apsaugos ministerijos', 'Gynybos resursų agentūra', 'R11'],
    ['S614429', 440.4, '06:00-15:00', 'UAB Lambda LTPajuosčio pl.73Dembavos k. Velžio sen., Panevėžio r.', 'UAB Lambda LT', 'R11'],
    ['S613369', 633.72, '06:00-15:00', 'UAB Lambda LTPajuosčio pl.73Dembavos k. Velžio sen., Panevėžio r.', 'UAB Lambda LT', 'R11'],
    ['S614395', 11.5, '06:00-15:00', 'UAB GaliasasPajuosčio pl.73, Dembavos k. Velžio sen., Panevėžio r.', 'UAB Galiasas', 'R11'],
    ['S613365', 34.55, '06:00-15:00', 'UAB GaliasasPajuosčio pl.73, Dembavos k. Velžio sen., Panevėžio r.', 'UAB Galiasas', 'R11'],
  ];
  const rows = values.map((row, index) => {
    const rowNumber = index + 4;
    return `<row r="${rowNumber}">${row.map((value, column) => cell(String.fromCharCode(65 + column), rowNumber, value)).join('')}</row>`;
  }).join('');
  return zipSync({
    'xl/workbook.xml': strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="K.Tautkus" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`),
  });
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

describe('LOGISTICS_EXCEL_V1 direct cell parser', () => {
  it('parses the real A-F driver sheet layout with dynamic direction codes and more than 15 stops', () => {
    const preview = parseLogisticsExcelWorkbook(realLayoutFixtureBytes, {
      importId: 'real-layout-regression',
      fileName: 'realaus-darbo-lapo-formatas-v1.xlsx',
      fileHash: 'real-layout-fixture-sha256',
    });
    expect(preview.mapping).toMatchObject({
      orderNumber: 'A', weightKg: 'B', deliveryTime: 'C', deliveryAddress: 'D', recipient: 'E', routeCode: 'F',
    });
    expect(preview.rows).toHaveLength(21);
    expect(preview.groups).toHaveLength(18);
    expect([...preview.summary.routeCodes].sort()).toEqual(['H02', 'M14', 'R51']);
    expect(preview.rows.filter((row) => row.supplierPrefix !== null)).toHaveLength(10);
    expect(preview.rows.every((row) => !/^(?:uab\s+)?(?:lambda(?:\s+lt)?|galiasas)\b/iu.test(row.normalizedAddress ?? ''))).toBe(true);
    expect(preview.rows.every((row) => !/^(?:uab\s+)?(?:lambda(?:\s+lt)?|galiasas)\b/iu.test(row.recipient ?? ''))).toBe(true);
    expect(preview.groups.every((group) => !group.issueCodes.includes('ADDRESS_SOURCE_CONFLICT'))).toBe(true);
  });

  it('reads the workbook, selects the likely sheet and detects the first data row', () => {
    const preview = parseFixture();
    expect(preview.selectedSheetName).toBe('Maršrutas');
    expect(preview.firstDataRow).toBe(4);
    expect(preview.mappingRecognized).toBe(true);
    expect(preview.rows).toHaveLength(40);
    expect(preview.sheets.map((sheet) => sheet.name)).toEqual(['Informacija', 'Maršrutas']);
  });

  it.each([
    ['1,5', 1500], ['125,08', 125080], ['0,5', 500], ['201,6', 201600], ['25', 25000], ['', null],
  ])('parses Lithuanian weight %s exactly into grams', (raw, grams) => {
    expect(parseLithuanianWeightToGrams(raw)).toEqual({ grams, issue: null });
  });

  it('rejects negative and invalid weights without inventing zero', () => {
    expect(parseLithuanianWeightToGrams('-1,5')).toEqual({ grams: null, issue: 'NEGATIVE_WEIGHT' });
    expect(parseLithuanianWeightToGrams('daug')).toEqual({ grams: null, issue: 'INVALID_WEIGHT' });
  });

  it('keeps an empty self-closing Excel weight cell null without shifting later columns', () => {
    const row = parseFixture().rows.find((item) => item.sourceRowNumber === 9)!;
    expect(row.weightGrams).toBeNull();
    expect(row.weightRaw).toBeNull();
    expect(row.deliveryTimeRaw).toBe('07:00-10:00');
    expect(row.issueCodes).not.toContain('INVALID_WEIGHT');
  });

  it.each(LOGISTICS_EXCEL_V1.supplierPrefixes)('removes configurable prefix %s only at the beginning', (prefix) => {
    const parsed = stripSupplierPrefix(`  ${prefix},   Gavėjas Alfa`, LOGISTICS_EXCEL_V1.supplierPrefixes);
    expect(parsed.supplierPrefix?.toLocaleLowerCase('lt-LT')).toBe(prefix.toLocaleLowerCase('lt-LT'));
    expect(parsed.cleaned).toBe('Gavėjas Alfa');
    expect(stripSupplierPrefix(`Gavėjas ${prefix} Centras`, LOGISTICS_EXCEL_V1.supplierPrefixes).supplierPrefix).toBeNull();
  });

  it.each([
    ['uAb   Lambda   LT, Dainų g. 11, Šiauliai', 'UAB Lambda LT', 'Dainų g. 11, Šiauliai'],
    ['Lambda: Pakruojo g. 51, Šiauliai', 'Lambda', 'Pakruojo g. 51, Šiauliai'],
    ['UAB. Galiasas; Tilžės g. 10, Šiauliai', 'UAB Galiasas', 'Tilžės g. 10, Šiauliai'],
    ['Galiasas - Pramonės g. 4, Šiauliai', 'Galiasas', 'Pramonės g. 4, Šiauliai'],
  ])('tolerates spacing and punctuation in supplier prefix %s', (raw, supplierPrefix, cleaned) => {
    expect(stripSupplierPrefix(raw)).toEqual({ supplierPrefix, cleaned });
  });

  it('separates a supplier name glued directly to the Pajuosčio street name', () => {
    expect(stripSupplierPrefix('UAB Lambda LTPajuosčio pl.73Dembavos k. Velžio sen.'))
      .toEqual({ supplierPrefix: 'UAB Lambda LT', cleaned: 'Pajuosčio pl.73Dembavos k. Velžio sen.' });
    expect(stripSupplierPrefix('UAB GaliasasPajuosčio pl.73, Dembavos k.'))
      .toEqual({ supplierPrefix: 'UAB Galiasas', cleaned: 'Pajuosčio pl.73, Dembavos k.' });
  });

  it('preserves original supplier text and detects a D/E address conflict', () => {
    const row = parseFixture().rows.find((item) => item.sourceRowNumber === 7)!;
    expect(row.rawColumnD).toContain('UAB Lambda LT');
    expect(row.rawColumnE).toContain('Tilžės');
    expect(row.supplierPrefix).toBe('UAB Lambda LT');
    expect(row.issueCodes).toContain('ADDRESS_SOURCE_CONFLICT');
    expect(row.alternateAddress).toContain('Dainų');
  });

  it.each([
    ['Dainų g.15Šiauliai Lietuva', 'Dainų g. 15, Šiauliai, Lietuva'],
    ['J.Basanavičiaus g.92Šiauliai', 'J. Basanavičiaus g. 92, Šiauliai, Lietuva'],
    ['Architektų g.9CŠiauliai', 'Architektų g. 9C, Šiauliai, Lietuva'],
  ])('normalizes missing spaces in %s', (raw, normalized) => {
    expect(normalizeLithuanianAddress(raw, 'Šiauliai', 'Lietuva')).toBe(normalized);
  });

  it('does not append the default city when the address already names a village, eldership and district', () => {
    const normalized = normalizeLithuanianAddress('Pajuosčio pl.73Dembavos k. Velžio sen., Panevėžio r.', 'Šiauliai', 'Lietuva');
    expect(normalized).toContain('Pajuosčio pl. 73');
    expect(normalized).toContain('Dembavos k.');
    expect(normalized).not.toContain('Šiauliai');
    expect(normalized).toContain('Lietuva');
  });

  it.each([
    'Katedros a. 4',
    'Katedros a.4',
    'Katedros a. 4, Vilnius',
  ])('recognizes an "aikštė" (square) address abbreviated as "a." — %s — instead of silently dropping it', (raw) => {
    expect(looksLikeAddress(raw)).toBe(true);
    expect(extractAddressText(raw)).not.toBeNull();
    expect(normalizeLithuanianAddress(extractAddressText(raw)!, 'Vilnius', 'Lietuva')).toContain('Katedros a. 4');
  });

  it('accepts a street-name address even when the source omits the street suffix', () => {
    expect(normalizeLithuanianAddress('Dariaus ir Girėno 34A, Vilnius', 'Vilnius', 'Lietuva'))
      .toContain('Dariaus ir Girėno 34A');
  });

  it('groups repeated physical address rows while preserving every order number and exact weight sum', () => {
    const preview = parseFixture();
    const group = preview.groups.find((item) => item.normalizedAddress.includes('Pakruojo'))!;
    expect(group.lineIds).toHaveLength(6);
    expect(group.orderNumbers).toHaveLength(6);
    expect(group.totalWeightGrams).toBe(386680);
    expect(group.recipients).toEqual(['Centras Vienas']);
  });

  it('intersects compatible time windows and flags a disjoint group', () => {
    const preview = parseFixture();
    const dainu = preview.groups.find((item) => item.normalizedAddress.includes('Dainų'))!;
    const pakruojo = preview.groups.find((item) => item.normalizedAddress.includes('Pakruojo'))!;
    expect([dainu.deliveryTimeFrom, dainu.deliveryTimeTo]).toEqual(['07:00', '10:00']);
    expect(pakruojo.deliveryTimeFrom).toBeNull();
    expect(pakruojo.issueCodes).toContain('TIME_WINDOW_CONFLICT');
    expect(pakruojo.conflictingLineIds).toHaveLength(6);
  });

  it('filters R56 and R57 without changing route engine semantics', () => {
    const preview = parseFixture();
    expect(filterExcelPreviewByRouteCodes(preview, ['R56']).summary.includedRowCount).toBe(20);
    expect(filterExcelPreviewByRouteCodes(preview, ['R57']).summary.includedRowCount).toBe(20);
    expect(filterExcelPreviewByRouteCodes(preview, ['R56', 'R57']).summary.includedRowCount).toBe(40);
  });

  it('keeps all seven daily-export rows and groups the four Pajuosčio lines into one real stop', () => {
    const preview = parseLogisticsExcelWorkbook(pajuoscioWorkbook(), {
      importId: 'pajuoscio-regression', fileName: '2026.08.31 Vilnius.xlsx', fileHash: 'pajuoscio-hash',
    });
    expect(preview.rows).toHaveLength(7);
    expect(preview.summary.routeCodes).toEqual(['R54', 'R11']);
    const pajuoscio = preview.groups.find((group) => group.normalizedAddress.includes('Pajuosčio'));
    expect(pajuoscio?.lineIds).toHaveLength(4);
    expect(pajuoscio?.normalizedAddress).not.toContain('Šiauliai');
    expect(preview.summary.physicalStopCount).toBe(2);
    expect(preview.summary.unconfirmedAddressCount).toBe(1);
  });
});

class ExpoLikeDatabase {
  constructor(readonly raw = new DatabaseSync(':memory:')) {}
  async execAsync(sql: string) { this.raw.exec(sql); }
  async runAsync(sql: string, ...params: unknown[]) { return this.raw.prepare(sql).run(...params as never[]); }
  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> { return (this.raw.prepare(sql).get(...params as never[]) as T | undefined) ?? null; }
  async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> { return this.raw.prepare(sql).all(...params as never[]) as T[]; }
  async withTransactionAsync(operation: () => Promise<void>) {
    this.raw.exec('BEGIN IMMEDIATE');
    try { await operation(); this.raw.exec('COMMIT'); } catch (error) { this.raw.exec('ROLLBACK'); throw error; }
  }
}

function createDb(): SQLiteDatabase {
  const adapter = new ExpoLikeDatabase();
  const source = readFileSync(resolve(here, '../../src/database/migrations.ts'), 'utf8');
  const tick = String.fromCharCode(96);
  const schemaVersion = Number(source.match(/SCHEMA_VERSION = (\d+)/)?.[1]);
  for (let version = 1; version <= schemaVersion; version += 1) {
    const match = source.match(new RegExp(`const migrationV${version} = ${tick}([\\s\\S]*?)${tick};`));
    if (!match) throw new Error(`Missing migrationV${version}`);
    adapter.raw.exec(match[1]);
  }
  return adapter as unknown as SQLiteDatabase;
}

const endpoint = {
  originalAddress: 'Pramonės g. 1, Šiauliai', geocodingQuery: 'Pramonės g. 1, Šiauliai',
  normalizedAddress: 'Pramonės g. 1, Šiauliai, Lietuva', latitude: 55.93, longitude: 23.31,
};

function confirmAddresses(preview: ExcelImportPreview) {
  const result = excelPreviewToImportResult(preview);
  return {
    ...result,
    requiresReview: false,
    deliveries: result.deliveries.map((delivery, index) => ({
      ...delivery,
      addressConfidence: 0.99,
      validationState: 'valid' as const,
      selectedAddress: {
        placeId: `place-${index}`,
        normalizedAddress: delivery.addressQuery ?? String(delivery.address.value ?? ''),
        latitude: 55.90 + index * 0.001,
        longitude: 23.30 + index * 0.001,
        confidence: 0.99,
        rawProviderData: null,
      },
    })),
  };
}

describe('Excel import persistence and ShipmentLine history', () => {
  let db: SQLiteDatabase;
  beforeEach(() => { db = createDb(); });

  it('detects the same file/sheet and restores the saved review after a repository restart', async () => {
    const preview = parseFixture('session-one');
    const first = new ExcelImportRepository(db);
    await first.savePreview(preview);
    const result = confirmAddresses(preview);
    await first.saveReviewResult(preview.id, result);
    const restarted = new ExcelImportRepository(db);
    expect((await restarted.findLatestByFingerprint(preview.fileHash, preview.selectedSheetName))?.id).toBe(preview.id);
    expect((await restarted.getReviewResult(preview.id))?.deliveries[0]?.selectedAddress).not.toBeNull();
  });

  it('keeps a routed Excel session reusable for planning another route', async () => {
    const preview = parseFixture('session-reusable-after-route');
    const repository = new ExcelImportRepository(db);
    await repository.savePreview(preview);
    const result = confirmAddresses(preview);
    await repository.saveReviewResult(preview.id, result);
    let id = 0;
    const created = await new CreateDraftRouteWithStops(db, undefined, (prefix) => `${prefix}-reusable-${++id}`).execute({
      commandId: 'excel-command-reusable',
      startLocation: endpoint,
      endLocation: endpoint,
      importSource: { type: 'excel', originalText: null, imageReference: null },
      stops: excelPreviewToDraftStops(preview, result.deliveries),
    });
    await repository.markRouted(preview.id, created.routeId);

    const restored = await new ExcelImportRepository(db).getLatestReview();
    expect(restored?.preview.id).toBe(preview.id);
    expect(restored?.result?.deliveries[0]?.selectedAddress).not.toBeNull();
  });

  it('persists a multi-sheet planning queue and keeps completed sheets routed', async () => {
    const first = parseFixture('session-batch-first');
    const second = {
      ...parseFixture('session-batch-second'),
      fileHash: first.fileHash,
      fileName: first.fileName,
      selectedSheetName: 'R80',
    };
    const repository = new ExcelImportRepository(db);
    await repository.savePreview(first);
    await repository.savePreview(second);
    await repository.saveActiveBatchFileHashes([first.fileHash]);
    let id = 0;
    const created = await new CreateDraftRouteWithStops(db, undefined, (prefix) => `${prefix}-batch-${++id}`).execute({
      commandId: 'excel-command-batch', startLocation: endpoint, endLocation: endpoint,
      importSource: { type: 'excel', originalText: null, imageReference: null },
      stops: excelPreviewToDraftStops(first, confirmAddresses(first).deliveries),
    });
    await repository.markRouted(first.id, created.routeId);
    await repository.saveReviewResult(first.id, confirmAddresses(first));

    expect(await repository.getActiveBatchFileHashes()).toEqual([first.fileHash]);
    const sessions = await repository.listSheetSessions([first.fileHash]);
    expect(sessions).toHaveLength(2);
    expect(sessions.find((session) => session.id === first.id)).toMatchObject({ status: 'routed', finalRouteId: created.routeId });
    expect(sessions.find((session) => session.id === second.id)).toMatchObject({ status: 'review', sheetName: 'R80' });

    await repository.abandonSession(second.id);
    expect(await repository.listSheetSessions([first.fileHash])).toHaveLength(1);
  });

  it('persists audited manual corrections', async () => {
    const preview = parseFixture('session-correction');
    const repository = new ExcelImportRepository(db);
    await repository.savePreview(preview);
    await repository.recordCorrection({
      id: 'correction-1', importSessionId: preview.id, targetType: 'group', targetId: preview.groups[0]!.id,
      field: 'address', previousValue: 'senas', correctedValue: 'naujas', createdAt: '2026-08-03T10:00:00.000Z',
    });
    expect(await new ExcelImportRepository(db).listCorrections(preview.id)).toHaveLength(1);
  });

  it('creates only physical DeliveryStops and attaches every original row as ShipmentLine', async () => {
    const preview = filterExcelPreviewByRouteCodes(parseFixture('session-route'), ['R57']);
    const result = confirmAddresses(preview);
    const stops = excelPreviewToDraftStops(preview, result.deliveries);
    let id = 0;
    const created = await new CreateDraftRouteWithStops(db, undefined, (prefix) => `${prefix}-${++id}`).execute({
      commandId: 'excel-command-1', startLocation: endpoint, endLocation: endpoint,
      importSource: { type: 'excel', originalText: JSON.stringify(preview.summary), imageReference: null }, stops,
    });
    const persistedStops = await new RouteRepository(db).getStops(created.routeId);
    const lines = await new ShipmentLineRepository(db).getByRoute(created.routeId);
    expect(persistedStops).toHaveLength(stops.length);
    expect(lines).toHaveLength(20);
    expect(lines.map((line) => line.orderNumber)).toContain('S604064');
    expect(new Set(lines.map((line) => line.id)).size).toBe(20);
  });

  it('keeps ShipmentLine rows after the physical route is completed and reopened from history', async () => {
    const preview = filterExcelPreviewByRouteCodes(parseFixture('session-history'), ['R57']);
    const result = confirmAddresses(preview);
    let id = 0;
    const created = await new CreateDraftRouteWithStops(db, undefined, (prefix) => `${prefix}-${++id}`).execute({
      commandId: 'excel-command-history', startLocation: endpoint, endLocation: endpoint,
      importSource: { type: 'excel', originalText: null, imageReference: null },
      stops: excelPreviewToDraftStops(preview, result.deliveries),
    });
    await db.runAsync("UPDATE routes SET status = 'planned' WHERE id = ?", created.routeId);
    await new ActivateRoute(db).execute(created.routeId);
    const routeRepository = new RouteRepository(db);
    for (const stop of await routeRepository.getStops(created.routeId)) await new MarkStopLoaded(db).execute(created.routeId, stop.id);
    await new SaveStartOdometer(db).execute(created.routeId, 1000);
    await new StartRoute(db).execute(created.routeId);
    for (const stop of await routeRepository.getStops(created.routeId)) await new MarkStopDelivered(db).execute(created.routeId, stop.id);
    await new StartRouteReturn(db).execute(created.routeId, 'warehouse', endpoint);
    await new ConfirmRouteReturnArrival(db).execute(created.routeId);
    await new CompleteRoute(db).execute(created.routeId, { endOdometer: 1018.4, confirmUnfinished: false });
    expect((await routeRepository.getById(created.routeId))?.status).toBe('completed');
    expect(await new ShipmentLineRepository(db).getByRoute(created.routeId)).toHaveLength(20);
  });
});
