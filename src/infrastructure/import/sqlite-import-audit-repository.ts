import { Directory, File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { ImportAuditRepository } from '@/application/import/import-engine';
import type { ImportAuditRecord } from '@/domain/import/models';

export class SQLiteImportAuditRepository implements ImportAuditRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async save(record: ImportAuditRecord): Promise<void> {
    const originalFileUri = await preserveOriginalFile(record);
    await this.db.runAsync(
      `INSERT OR REPLACE INTO import_audits (
        id, source_kind, original_file_uri, document_json, preprocessing_json,
        ocr_json, parser_result_json, duplicates_json, corrections_json,
        final_route_id, quality_json, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.id,
      record.document.kind,
      originalFileUri,
      JSON.stringify(record.document),
      JSON.stringify(record.preprocessing),
      JSON.stringify(record.ocr),
      JSON.stringify(record.deliveries),
      JSON.stringify(record.duplicates),
      JSON.stringify(record.corrections),
      record.finalRouteId,
      JSON.stringify(record.quality),
      record.createdAt,
      record.completedAt,
    );
  }

  async get(id: string): Promise<ImportAuditRecord | null> {
    const row = await this.db.getFirstAsync<AuditRow>(
      'SELECT * FROM import_audits WHERE id = ?',
      id,
    );
    return row ? fromRow(row) : null;
  }
}

type AuditRow = {
  id: string;
  source_kind: ImportAuditRecord['document']['kind'];
  original_file_uri: string | null;
  document_json: string;
  preprocessing_json: string;
  ocr_json: string;
  parser_result_json: string;
  duplicates_json: string;
  corrections_json: string;
  final_route_id: string | null;
  quality_json: string;
  created_at: string;
  completed_at: string | null;
};

async function preserveOriginalFile(record: ImportAuditRecord): Promise<string | null> {
  if (!record.document.uri || ['clipboard', 'text'].includes(record.document.kind)) return null;
  const directory = new Directory(Paths.document, 'import-audit', record.id);
  directory.create({ intermediates: true, idempotent: true });
  const safeName = record.document.fileName.replace(/[^\p{L}\p{N}._-]/gu, '_') || 'original.bin';
  const target = new File(directory, safeName);
  await new File(record.document.uri).copy(target);
  for (const [index, uri] of (record.document.pageUris ?? []).entries()) {
    if (uri === record.document.uri) continue;
    const pageTarget = new File(directory, `page-${index + 1}${new File(uri).extension || '.jpg'}`);
    await new File(uri).copy(pageTarget);
  }
  return target.uri;
}

function fromRow(row: AuditRow): ImportAuditRecord {
  return {
    id: row.id,
    document: JSON.parse(row.document_json) as ImportAuditRecord['document'],
    originalFileUri: row.original_file_uri,
    preprocessing: JSON.parse(row.preprocessing_json) as ImportAuditRecord['preprocessing'],
    ocr: JSON.parse(row.ocr_json) as ImportAuditRecord['ocr'],
    deliveries: JSON.parse(row.parser_result_json) as ImportAuditRecord['deliveries'],
    duplicates: JSON.parse(row.duplicates_json) as ImportAuditRecord['duplicates'],
    corrections: JSON.parse(row.corrections_json) as ImportAuditRecord['corrections'],
    finalRouteId: row.final_route_id,
    quality: JSON.parse(row.quality_json) as ImportAuditRecord['quality'],
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}
