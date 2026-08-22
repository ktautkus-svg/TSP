#!/usr/bin/env node
/**
 * Cloud Run ignores --revision-suffix when spec.template.metadata.name is a
 * full pinned revision (here: logistikos-pristatymai-00177-2n2). Rewrite the
 * service spec so replace creates a uniquely named revision of the new image
 * without sending traffic until the workflow's update-traffic step.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const serviceName = requiredEnv('CLOUD_RUN_SERVICE');
const gitSha = requiredEnv('GIT_SHA');
const image = requiredEnv('IMAGE');
const appVersion = requiredEnv('APP_VERSION');
const service = JSON.parse(readFileSync(0, 'utf8'));

const spec = ensureObject(service, 'spec');
const template = ensureObject(spec, 'template');
const metadata = ensureObject(template, 'metadata');
const previousName = typeof metadata.name === 'string' ? metadata.name : null;
metadata.name = `${serviceName}-s${gitSha}`;

const templateSpec = ensureObject(template, 'spec');
if (!Array.isArray(templateSpec.containers) || templateSpec.containers.length === 0) {
  templateSpec.containers = [{}];
}
templateSpec.containers[0].image = image;
upsertEnv(templateSpec.containers[0], 'GIT_SHA', gitSha);
upsertEnv(templateSpec.containers[0], 'APP_VERSION', appVersion);

const readyRevision = service.status?.latestReadyRevisionName;
if (typeof readyRevision === 'string' && readyRevision) {
  spec.traffic = [{ revisionName: readyRevision, percent: 100 }];
}

// Knative PUT rejects a status block. Keep resourceVersion for concurrency.
delete service.status;

process.stderr.write(
  `Pinned revision ${previousName ?? '(none)'} -> ${metadata.name} image ${image}\n`,
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
