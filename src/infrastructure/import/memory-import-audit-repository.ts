import type { ImportAuditRepository } from '@/application/import/import-engine';
import type { ImportAuditRecord } from '@/domain/import/models';

const records = new Map<string, ImportAuditRecord>();

export class MemoryImportAuditRepository implements ImportAuditRepository {
  async save(record: ImportAuditRecord): Promise<void> {
    records.set(record.id, structuredClone(record));
  }

  async get(id: string): Promise<ImportAuditRecord | null> {
    const record = records.get(id);
    return record ? structuredClone(record) : null;
  }

  async list(): Promise<ImportAuditRecord[]> {
    return [...records.values()].map((record) => structuredClone(record));
  }
}
