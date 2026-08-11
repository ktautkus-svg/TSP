import type { SQLiteDatabase } from 'expo-sqlite';

import { SCHEMA_VERSION } from '@/database/migrations';
import { LOCAL_ACCESS_PREFERENCE_PREFIX } from '@/application/auth/local-access';

export const BACKUP_FORMAT = 'logistikos-pristatymai-backup';
export const BACKUP_FORMAT_VERSION = 1;

// `sync_accounts`, `sync_cursors` and `route_sync_deferrals` are deliberately
// absent: they describe *this device's* relationship with the cloud (which
// account claimed which local routes, how far each account has pulled, what is
// waiting to be applied). Restoring another device's copy of them would make an
// account skip data it never received. Routes themselves carry
// `owner_employee_id` and are backed up normally.
const tables = [
  'vehicles',
  'routes',
  'delivery_stops',
  'import_sources',
  'delivery_attempts',
  'action_journal',
  'route_order_snapshots',
  'trip_sheets',
  'trip_sheet_routes',
  'fuel_entries',
  'route_optimization_results',
  'route_optimization_stops',
  'route_stop_constraints',
  'manual_route_edits',
  'trip_time_entries',
  'location_preferences',
  'routing_engine_runs',
  'routing_engine_candidates',
  'routing_recalculations',
  'import_audits',
  'saved_locations',
  'route_creation_commands',
  'excel_import_sessions',
  'excel_import_rows',
  'excel_import_corrections',
  'shipment_lines',
  'app_preferences',
] as const;

type BackupTable = typeof tables[number];
type BackupRow = Record<string, string | number | null>;

export type PwaBackup = {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  tables: Record<BackupTable, BackupRow[]>;
};

export type BackupSummary = {
  routeCount: number;
  stopCount: number;
  shipmentLineCount: number;
  tableCount: number;
  exportedAt: string;
};

export async function createPwaBackup(
  db: SQLiteDatabase,
  appVersion: string,
  now = new Date(),
): Promise<PwaBackup> {
  const userVersion = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if (userVersion?.user_version !== SCHEMA_VERSION) {
    throw new Error(`Nepalaikoma SQLite schema: ${userVersion?.user_version ?? 'nežinoma'}.`);
  }
  const data = {} as Record<BackupTable, BackupRow[]>;
  for (const table of tables) {
    data[table] = await db.getAllAsync<BackupRow>(`SELECT * FROM ${table}`);
    if (table === 'app_preferences') {
      data[table] = data[table].filter((row) =>
        typeof row.key !== 'string' || !row.key.startsWith(LOCAL_ACCESS_PREFERENCE_PREFIX),
      );
    }
  }
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    appVersion,
    exportedAt: now.toISOString(),
    tables: data,
  };
}

export function parsePwaBackup(raw: string): PwaBackup {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Pasirinktas failas nėra tinkamas JSON.');
  }
  if (!value || typeof value !== 'object') throw new Error('Atsarginės kopijos struktūra netinkama.');
  const candidate = value as Partial<PwaBackup>;
  if (candidate.format !== BACKUP_FORMAT || candidate.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error('Tai nėra palaikoma „Logistikos pristatymų“ atsarginė kopija.');
  }
  if (candidate.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Atsarginės kopijos schema ${candidate.schemaVersion ?? 'nežinoma'} nesuderinama su ${SCHEMA_VERSION}.`);
  }
  if (!candidate.tables || typeof candidate.tables !== 'object') {
    throw new Error('Atsarginėje kopijoje nėra duomenų lentelių.');
  }
  for (const table of tables) {
    if (!Array.isArray(candidate.tables[table])) {
      throw new Error(`Atsarginėje kopijoje trūksta lentelės „${table}“ duomenų.`);
    }
    for (const row of candidate.tables[table]) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error(`Lentelėje „${table}“ rastas netinkamas įrašas.`);
      }
    }
  }
  return candidate as PwaBackup;
}

export function summarizePwaBackup(backup: PwaBackup): BackupSummary {
  return {
    routeCount: backup.tables.routes.length,
    stopCount: backup.tables.delivery_stops.length,
    shipmentLineCount: backup.tables.shipment_lines.length,
    tableCount: tables.length,
    exportedAt: backup.exportedAt,
  };
}

export async function restorePwaBackup(db: SQLiteDatabase, backup: PwaBackup): Promise<void> {
  const parsed = parsePwaBackup(JSON.stringify(backup));
  const localAccessRows = await db.getAllAsync<BackupRow>(
    'SELECT * FROM app_preferences WHERE key LIKE ?',
    `${LOCAL_ACCESS_PREFERENCE_PREFIX}%`,
  );
  await db.withTransactionAsync(async () => {
    await db.execAsync('PRAGMA defer_foreign_keys = ON;');
    for (const table of [...tables].reverse()) {
      await db.runAsync(`DELETE FROM ${table}`);
    }
    for (const table of tables) {
      const allowedColumns = new Set(
        (await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`)).map((column) => column.name),
      );
      const rows = table === 'app_preferences'
        ? parsed.tables[table].filter((row) => typeof row.key !== 'string' || !row.key.startsWith(LOCAL_ACCESS_PREFERENCE_PREFIX))
        : parsed.tables[table];
      for (const row of rows) {
        const columns = Object.keys(row);
        if (!columns.length || columns.some((column) => !allowedColumns.has(column))) {
          throw new Error(`Lentelės „${table}“ laukai nesuderinami su dabartine schema.`);
        }
        const placeholders = columns.map(() => '?').join(', ');
        await db.runAsync(
          `INSERT INTO ${table} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${placeholders})`,
          ...columns.map((column) => row[column]),
        );
      }
    }
    for (const row of localAccessRows) {
      const columns = Object.keys(row);
      const placeholders = columns.map(() => '?').join(', ');
      await db.runAsync(
        `INSERT INTO app_preferences (${columns.map(quoteIdentifier).join(', ')}) VALUES (${placeholders})`,
        ...columns.map((column) => row[column]),
      );
    }
    await db.runAsync(
      `INSERT INTO app_preferences (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      'last_pwa_restore_at',
      new Date().toISOString(),
      new Date().toISOString(),
    );
  });
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
