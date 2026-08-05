import type { SQLiteDatabase } from 'expo-sqlite';

import { groupExcelRows, summarizeExcelRows } from '@/application/import/logistics-excel-v1';
import type { ExcelImportCorrection, ExcelImportPreview, ExcelSourceRow } from '@/domain/import/excel-models';
import type { ImportResult } from '@/domain/import/models';

type ExcelRowDb = {
  id: string;
  import_session_id: string;
  source_sheet_name: string;
  source_row_number: number;
  order_number: string | null;
  weight_grams: number | null;
  weight_raw: string | null;
  delivery_time_from: string | null;
  delivery_time_to: string | null;
  delivery_time_raw: string | null;
  supplier_prefix: string | null;
  recipient: string | null;
  route_code: string | null;
  raw_column_d: string | null;
  raw_column_e: string | null;
  raw_row_json: string;
  original_address: string | null;
  normalized_address: string | null;
  alternate_address: string | null;
  manual_group_key: string | null;
  issue_codes_json: string;
  excluded: number;
};

export class ExcelImportRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async savePreview(preview: ExcelImportPreview): Promise<void> {
    const now = new Date().toISOString();
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `INSERT INTO excel_import_sessions (
          id, file_hash, file_name, template_id, template_version, sheet_name,
          first_data_row, column_mapping_json, selected_route_codes_json,
          status, summary_json, preview_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'review', ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          file_hash = excluded.file_hash,
          file_name = excluded.file_name,
          template_id = excluded.template_id,
          template_version = excluded.template_version,
          sheet_name = excluded.sheet_name,
          first_data_row = excluded.first_data_row,
          column_mapping_json = excluded.column_mapping_json,
          selected_route_codes_json = excluded.selected_route_codes_json,
          summary_json = excluded.summary_json,
          preview_json = excluded.preview_json,
          updated_at = excluded.updated_at`,
        preview.id,
        preview.fileHash,
        preview.fileName,
        preview.templateId,
        preview.templateVersion,
        preview.selectedSheetName,
        preview.firstDataRow,
        JSON.stringify(preview.mapping),
        JSON.stringify(preview.selectedRouteCodes),
        JSON.stringify(preview.summary),
        JSON.stringify(preview),
        preview.createdAt,
        now,
      );
      await this.db.runAsync('DELETE FROM excel_import_rows WHERE import_session_id = ?', preview.id);
      for (const row of preview.rows) await this.insertRow(row, now);
    });
  }

  async findLatestByFingerprint(fileHash: string, sheetName: string): Promise<ExcelImportPreview | null> {
    const row = await this.db.getFirstAsync<{ id: string }>(
      `SELECT id FROM excel_import_sessions
       WHERE file_hash = ? AND sheet_name = ? AND status <> 'abandoned'
       ORDER BY created_at DESC LIMIT 1`,
      fileHash,
      sheetName,
    );
    return row ? this.getPreview(row.id) : null;
  }

  async getLatestReview(): Promise<{ preview: ExcelImportPreview; result: ImportResult | null } | null> {
    const session = await this.db.getFirstAsync<{ id: string; review_result_json: string | null }>(
      `SELECT id, review_result_json FROM excel_import_sessions
       WHERE status IN ('review','ready') ORDER BY updated_at DESC LIMIT 1`,
    );
    if (!session) return null;
    const preview = await this.getPreview(session.id);
    if (!preview) return null;
    return {
      preview,
      result: session.review_result_json
        ? JSON.parse(session.review_result_json) as ImportResult
        : null,
    };
  }

  async getReviewResult(importSessionId: string): Promise<ImportResult | null> {
    const row = await this.db.getFirstAsync<{ review_result_json: string | null }>(
      'SELECT review_result_json FROM excel_import_sessions WHERE id = ?',
      importSessionId,
    );
    return row?.review_result_json ? JSON.parse(row.review_result_json) as ImportResult : null;
  }

  async saveReviewResult(importSessionId: string, result: ImportResult): Promise<void> {
    await this.db.runAsync(
      `UPDATE excel_import_sessions SET review_result_json = ?, status = ?, updated_at = ? WHERE id = ?`,
      JSON.stringify(result),
      result.requiresReview ? 'review' : 'ready',
      new Date().toISOString(),
      importSessionId,
    );
  }

  async getPreview(id: string): Promise<ExcelImportPreview | null> {
    const session = await this.db.getFirstAsync<{ preview_json: string }>(
      'SELECT preview_json FROM excel_import_sessions WHERE id = ?',
      id,
    );
    if (!session) return null;
    const stored = JSON.parse(session.preview_json) as ExcelImportPreview;
    const dbRows = await this.db.getAllAsync<ExcelRowDb>(
      'SELECT * FROM excel_import_rows WHERE import_session_id = ? ORDER BY source_row_number',
      id,
    );
    const rows = dbRows.map(mapRow);
    const groups = groupExcelRows(rows);
    return { ...stored, rows, groups, summary: summarizeExcelRows(rows, groups) };
  }

  async recordCorrection(correction: ExcelImportCorrection): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO excel_import_corrections (
        id, import_session_id, target_type, target_id, field,
        previous_value_json, corrected_value_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      correction.id,
      correction.importSessionId,
      correction.targetType,
      correction.targetId,
      correction.field,
      JSON.stringify(correction.previousValue),
      JSON.stringify(correction.correctedValue),
      correction.createdAt,
    );
  }

  async markRouted(importSessionId: string, routeId: string): Promise<void> {
    await this.db.runAsync(
      `UPDATE excel_import_sessions
       SET status = 'routed', final_route_id = ?, updated_at = ? WHERE id = ?`,
      routeId,
      new Date().toISOString(),
      importSessionId,
    );
  }

  async listCorrections(importSessionId: string): Promise<ExcelImportCorrection[]> {
    const rows = await this.db.getAllAsync<{
      id: string;
      import_session_id: string;
      target_type: ExcelImportCorrection['targetType'];
      target_id: string;
      field: string;
      previous_value_json: string;
      corrected_value_json: string;
      created_at: string;
    }>('SELECT * FROM excel_import_corrections WHERE import_session_id = ? ORDER BY created_at', importSessionId);
    return rows.map((row) => ({
      id: row.id,
      importSessionId: row.import_session_id,
      targetType: row.target_type,
      targetId: row.target_id,
      field: row.field,
      previousValue: JSON.parse(row.previous_value_json) as unknown,
      correctedValue: JSON.parse(row.corrected_value_json) as unknown,
      createdAt: row.created_at,
    }));
  }

  private async insertRow(row: ExcelSourceRow, now: string): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO excel_import_rows (
        id, import_session_id, source_sheet_name, source_row_number, order_number,
        weight_grams, weight_raw, delivery_time_from, delivery_time_to,
        delivery_time_raw, supplier_prefix, recipient, route_code, raw_column_d,
        raw_column_e, raw_row_json, original_address, normalized_address,
        alternate_address, manual_group_key, issue_codes_json, excluded, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.sourceImportId,
      row.sourceSheetName,
      row.sourceRowNumber,
      row.orderNumber,
      row.weightGrams,
      row.weightRaw,
      row.deliveryTimeFrom,
      row.deliveryTimeTo,
      row.deliveryTimeRaw,
      row.supplierPrefix,
      row.recipient,
      row.routeCode,
      row.rawColumnD,
      row.rawColumnE,
      JSON.stringify(row.rawRow),
      row.originalAddress,
      row.normalizedAddress,
      row.alternateAddress,
      row.manualGroupKey,
      JSON.stringify(row.issueCodes),
      row.excluded ? 1 : 0,
      now,
      now,
    );
  }
}

function mapRow(row: ExcelRowDb): ExcelSourceRow {
  return {
    id: row.id,
    sourceImportId: row.import_session_id,
    sourceSheetName: row.source_sheet_name,
    sourceRowNumber: row.source_row_number,
    orderNumber: row.order_number,
    weightGrams: row.weight_grams,
    weightRaw: row.weight_raw,
    deliveryTimeFrom: row.delivery_time_from,
    deliveryTimeTo: row.delivery_time_to,
    deliveryTimeRaw: row.delivery_time_raw,
    supplierPrefix: row.supplier_prefix,
    recipient: row.recipient,
    routeCode: row.route_code,
    rawColumnD: row.raw_column_d,
    rawColumnE: row.raw_column_e,
    rawRow: JSON.parse(row.raw_row_json) as ExcelSourceRow['rawRow'],
    originalAddress: row.original_address,
    normalizedAddress: row.normalized_address,
    alternateAddress: row.alternate_address,
    manualGroupKey: row.manual_group_key,
    issueCodes: JSON.parse(row.issue_codes_json) as ExcelSourceRow['issueCodes'],
    excluded: row.excluded === 1,
  };
}
