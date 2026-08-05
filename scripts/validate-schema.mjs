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
db.exec(extractMigration('migrationV1'));
db.exec(extractMigration('migrationV2'));
db.exec(extractMigration('migrationV3'));
db.exec(extractMigration('migrationV4'));
db.exec(extractMigration('migrationV5'));
db.exec(extractMigration('migrationV6'));
db.exec(extractMigration('migrationV7'));
db.exec(extractMigration('migrationV8'));
db.exec(extractMigration('migrationV9'));
db.exec(extractMigration('migrationV10'));
db.exec(extractMigration('migrationV11'));

const { user_version: userVersion } = db.prepare('PRAGMA user_version').get();
const { count: tableCount } = db
  .prepare(`SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'`)
  .get();

if (userVersion !== 11) {
  throw new Error(`Expected schema version 11, received ${userVersion}.`);
}

const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all();
if (foreignKeyViolations.length > 0) {
  throw new Error(`Foreign key violations: ${JSON.stringify(foreignKeyViolations)}`);
}

console.log(`SQLite schema OK: version ${userVersion}, ${tableCount} tables.`);
