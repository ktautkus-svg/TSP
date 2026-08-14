import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
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
