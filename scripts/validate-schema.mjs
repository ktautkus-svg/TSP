import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const source = readFileSync(new URL('../src/database/migrations.ts', import.meta.url), 'utf8');
const tick = String.fromCharCode(96);

function extractMigration(name) {
  const match = source.match(
    new RegExp(`const ${name} = ${tick}([\\s\\S]*?)${tick};`),
  );
  if (!match) throw new Error(`Migration ${name} not found.`);
  return match[1];
}

const db = new DatabaseSync(':memory:');
const expectedVersion = Number(source.match(/SCHEMA_VERSION\s*=\s*(\d+)/)?.[1]);
if (!Number.isInteger(expectedVersion)) throw new Error('SCHEMA_VERSION not found.');
for (let version = 1; version <= expectedVersion; version += 1) {
  db.exec(extractMigration(`migrationV${version}`));
}

const { user_version: userVersion } = db.prepare('PRAGMA user_version').get();
const { count: tableCount } = db
  .prepare(`SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'`)
  .get();

if (userVersion !== expectedVersion) {
  throw new Error(`Expected schema version ${expectedVersion}, received ${userVersion}.`);
}

const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all();
if (foreignKeyViolations.length > 0) {
  throw new Error(`Foreign key violations: ${JSON.stringify(foreignKeyViolations)}`);
}

console.log(`SQLite schema OK: version ${userVersion}, ${tableCount} tables.`);
