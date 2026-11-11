import type { SQLiteDatabase } from 'expo-sqlite';

import { createPwaBackup, parsePwaBackup, restorePwaBackup, type PwaBackup } from './pwa-backup';

// A single "test snapshot" of the whole local database (routes, stops and
// everything else the PWA backup covers), kept in the browser's IndexedDB so it
// survives a database restore. Used to run a full end-to-end test and then put
// the database back exactly as it was.
const DB_NAME = 'pristatymai-test-snapshot';
const STORE = 'snapshot';
const KEY = 'current';

export type TestSnapshotInfo = { savedAt: string; routeCount: number; stopCount: number };

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Ši naršyklė nepalaiko vietinės kopijos.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Nepavyko atidaryti saugyklos.'));
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openStore();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(database.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Saugyklos klaida.'));
    });
  } finally {
    database.close();
  }
}

export async function saveTestSnapshot(db: SQLiteDatabase, appVersion: string): Promise<TestSnapshotInfo> {
  const backup = await createPwaBackup(db, appVersion);
  await run('readwrite', (store) => store.put(JSON.stringify(backup), KEY));
  return {
    savedAt: backup.exportedAt,
    routeCount: backup.tables.routes.length,
    stopCount: backup.tables.delivery_stops.length,
  };
}

export async function readTestSnapshotInfo(): Promise<TestSnapshotInfo | null> {
  const raw = await run<unknown>('readonly', (store) => store.get(KEY));
  if (typeof raw !== 'string') return null;
  const backup: PwaBackup = parsePwaBackup(raw);
  return {
    savedAt: backup.exportedAt,
    routeCount: backup.tables.routes.length,
    stopCount: backup.tables.delivery_stops.length,
  };
}

export async function restoreTestSnapshot(db: SQLiteDatabase): Promise<TestSnapshotInfo> {
  const raw = await run<unknown>('readonly', (store) => store.get(KEY));
  if (typeof raw !== 'string') throw new Error('Bandymo kopijos dar nėra. Pirmiausia ją išsaugokite.');
  const backup = parsePwaBackup(raw);
  await restorePwaBackup(db, backup);
  return {
    savedAt: backup.exportedAt,
    routeCount: backup.tables.routes.length,
    stopCount: backup.tables.delivery_stops.length,
  };
}
