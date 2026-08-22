#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const raw = readFileSync(0, 'utf8').trim();
if (!raw) {
  console.log('missing');
  process.exit(0);
}
try {
  const body = JSON.parse(raw);
  const conditions = body.status?.conditions;
  if (!Array.isArray(conditions)) {
    console.log('missing');
    process.exit(0);
  }
  const ready = conditions.find((item) => item?.type === 'Ready');
  console.log(typeof ready?.status === 'string' && ready.status ? ready.status : 'missing');
} catch {
  console.log('missing');
}
