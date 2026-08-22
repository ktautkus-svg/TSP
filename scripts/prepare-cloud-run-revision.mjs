#!/usr/bin/env node
/**
 * Cloud Run pins spec.template.metadata.name after a failed source deploy.
 * Drop that name so the next update auto-generates a revision, point the
 * container at the new image, and keep live traffic on the last healthy
 * revision.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const image = requiredEnv('IMAGE');
const appVersion = requiredEnv('APP_VERSION');
const gitSha = requiredEnv('GIT_SHA');
const service = JSON.parse(readFileSync(0, 'utf8'));

const spec = ensureObject(service, 'spec');
const template = ensureObject(spec, 'template');
const metadata = ensureObject(template, 'metadata');
const previousName = typeof metadata.name === 'string' ? metadata.name : null;
delete metadata.name;

const templateSpec = ensureObject(template, 'spec');
if (!Array.isArray(templateSpec.containers) || templateSpec.containers.length === 0) {
  templateSpec.containers = [{}];
}
templateSpec.containers[0].image = image;
upsertEnv(templateSpec.containers[0], 'GIT_SHA', gitSha);
upsertEnv(templateSpec.containers[0], 'APP_VERSION', appVersion);

const readyRevision = service.status?.latestReadyRevisionName;
const createdRevision = service.status?.latestCreatedRevisionName;
if (typeof readyRevision === 'string' && readyRevision) {
  spec.traffic = [{ revisionName: readyRevision, percent: 100 }];
}

delete service.status;

process.stderr.write(
  `Cleared pinned revision ${previousName ?? '(none)'}; last created ${createdRevision ?? '(none)'} -> image ${image}\n`,
);
writeFileSync(1, JSON.stringify(service));

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function ensureObject(parent, key) {
  const current = parent[key];
  if (current && typeof current === 'object' && !Array.isArray(current)) return current;
  parent[key] = {};
  return parent[key];
}

function upsertEnv(container, name, value) {
  if (!Array.isArray(container.env)) container.env = [];
  const existing = container.env.find((item) => item?.name === name);
  if (existing) {
    existing.value = value;
    delete existing.valueFrom;
    return;
  }
  container.env.push({ name, value });
}
