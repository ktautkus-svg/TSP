import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflowsDir = resolve(import.meta.dirname, '../../.github/workflows');
const ciWorkflowPath = resolve(workflowsDir, 'ci.yml');
const deployWorkflowPath = resolve(workflowsDir, 'cloud-run.yml');
const retiredDispatchPath = resolve(workflowsDir, 'cloud-run-deploy.yml');
const ciWorkflow = readFileSync(ciWorkflowPath, 'utf8');
const deployWorkflow = readFileSync(deployWorkflowPath, 'utf8');
const productionServer = readFileSync(resolve(import.meta.dirname, '../../server/production-server.ts'), 'utf8');
const employeeStore = readFileSync(resolve(import.meta.dirname, '../../server/employee-auth-store.ts'), 'utf8');
const gatewayConfig = readFileSync(resolve(import.meta.dirname, '../../gateway/config.ts'), 'utf8');
const script = resolve(import.meta.dirname, '../../scripts/prepare-cloud-run-revision.mjs');

describe('GitHub Actions workflows', () => {
  it('keeps pull-request CI separate from a single Cloud Run deploy workflow', () => {
    const files = readdirSync(workflowsDir).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml')).sort();
    expect(files).toEqual(['ci.yml', 'cloud-run.yml']);
    expect(existsSync(retiredDispatchPath)).toBe(false);

    const names = [ciWorkflow, deployWorkflow].map((body) => body.match(/^name:\s*(.+)$/m)?.[1]?.trim());
    expect(names).toEqual(['CI', 'Deploy to Cloud Run']);
    expect(ciWorkflow).toMatch(/^\s*pull_request:\s*$/m);
    expect(ciWorkflow).toMatch(/^\s*push:\s*$/m);
    expect(deployWorkflow).toContain('branches: [main]');
    expect(deployWorkflow).toContain('workflow_dispatch');
  });

  it('runs the same Node 24 quality gate as the Cloud Run image', () => {
    for (const body of [ciWorkflow, deployWorkflow]) {
      expect(body).toContain('node-version: 24');
      expect(body).not.toContain('node-version: 22');
      expect(body).toContain('npm run typecheck');
      expect(body).toContain('npm run lint');
      expect(body).toContain('npm test');
      expect(body).toContain('npm run validate:schema');
      expect(body).toContain('npm run pwa:build');
      expect(body).toContain('npm run pwa:test');
    }
  });

  it('lets CI cancel overlapping checks but never cancels an in-flight production deploy', () => {
    expect(ciWorkflow).toMatch(/cancel-in-progress:\s*true/);
    expect(deployWorkflow).toContain('group: cloud-run-production');
    expect(deployWorkflow).toMatch(/cancel-in-progress:\s*false/);
    expect(deployWorkflow).not.toMatch(/cancel-in-progress:\s*true/);
  });
});

describe('Cloud Run deploy', () => {
  it('reuses existing Secret Manager versions instead of adding a new one on every deploy', () => {
    expect(deployWorkflow).toContain('Bind existing Secret Manager values');
    expect(deployWorkflow).toContain('gcloud secrets describe "$name"');
    expect(deployWorkflow).toContain('${name}=${name}:latest');
    expect(deployWorkflow).not.toContain('gcloud secrets versions add');
    expect(deployWorkflow).not.toContain('gcloud secrets create');
    expect(deployWorkflow).toContain('GATEWAY_DEVICE_SECRET missing in Secret Manager');
    expect(deployWorkflow).toContain('TSP_INITIAL_ADMIN_PIN missing in Secret Manager');
    expect(deployWorkflow).toContain('GOOGLE_ROUTES_API_KEY, GOOGLE_API_KEY, or GOOGLE_MAPS_API_KEY');
    expect(deployWorkflow).toContain('googleRoutesKeyConfigured');
    expect(deployWorkflow).toContain("tr -d '[:space:]'");
  });

  it('keeps the VPC-SC async Cloud Build poll, unpin workaround, and Ready wait-loop', () => {
    expect(deployWorkflow).toContain('gcloud builds submit');
    expect(deployWorkflow).toContain('--tag="$image"');
    expect(deployWorkflow).toContain('--async');
    expect(deployWorkflow).toContain('--suppress-logs');
    expect(deployWorkflow).toContain('gcloud builds describe');
    expect(deployWorkflow).toContain('prepare-cloud-run-revision.mjs');
    expect(deployWorkflow).toContain('cloud-run-ready-status.mjs');
    expect(deployWorkflow).toContain('--revision-suffix="n${git_sha}"');
    expect(deployWorkflow).toContain('--image="${{ steps.image.outputs.name }}"');
    expect(deployWorkflow).toContain('--no-traffic');
    expect(deployWorkflow).toContain('gcloud run services update-traffic');
    expect(deployWorkflow).toContain("gcloud builds describe \"$build_id\"");
    expect(deployWorkflow).toContain('for _ in $(seq 1 120)');
    expect(deployWorkflow).toContain('sleep 10');
    expect(deployWorkflow).toContain('FAILURE|TIMEOUT|CANCELLED|EXPIRED|INTERNAL_ERROR');
    expect(deployWorkflow).toMatch(/if \[ "\$status" != SUCCESS \]/);
    expect(deployWorkflow).toContain('Grant Cloud Run access to secrets');
    expect(deployWorkflow).toContain('roles/secretmanager.secretAccessor');
    expect(deployWorkflow).toContain('compute@developer.gserviceaccount.com');
    expect(deployWorkflow).toContain('GCP_PROJECT_NUMBER');
    expect(deployWorkflow).not.toContain('gcloud projects describe "$GCP_PROJECT_ID"');
    expect(deployWorkflow).not.toContain('--clear-revision-suffix');
    expect(deployWorkflow).not.toMatch(/gcloud run deploy[\s\S]*--source \./);
    expect(deployWorkflow).not.toContain('gcloud run services replace');
  });

  it('keeps GATEWAY_REAL_PROVIDER_ARMED fail-closed and leaves the service public', () => {
    expect(deployWorkflow).toContain("vars.GATEWAY_REAL_PROVIDER_ARMED || '0'");
    expect(deployWorkflow).toContain('--allow-unauthenticated');
    expect(gatewayConfig).toContain("(env.GATEWAY_REAL_PROVIDER_ARMED ?? '').trim() === '1'");
  });

  it('clears a pinned failed revision name and keeps traffic on the last healthy revision', () => {
    const input = {
      spec: {
        template: {
          metadata: { name: 'logistikos-pristatymai-00177-2n2' },
          spec: {
            containers: [{
              image: 'europe-north1-docker.pkg.dev/logistika-504113/cloud-run-source-deploy/logistikos-pristatymai:old',
              env: [{ name: 'GIT_SHA', value: 'old' }, { name: 'GATEWAY_ENV', valueFrom: { secretKeyRef: { name: 'x' } } }],
            }],
          },
        },
        traffic: [{ latestRevision: true, percent: 100 }],
      },
      status: {
        latestReadyRevisionName: 'logistikos-pristatymai-00042-abc',
        latestCreatedRevisionName: 'logistikos-pristatymai-00177-2n2',
      },
    };
    const result = spawnSync(process.execPath, [script], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      env: {
        ...process.env,
        CLOUD_RUN_SERVICE: 'logistikos-pristatymai',
        GIT_SHA: '77e385c',
        IMAGE: 'europe-north1-docker.pkg.dev/logistika-504113/cloud-run-source-deploy/logistikos-pristatymai:sha77e385c',
        APP_VERSION: '1.0.0',
      },
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('logistikos-pristatymai-00177-2n2');
    const service = JSON.parse(result.stdout);
    expect(service.spec.template.metadata.name).toBeUndefined();
    expect(service.spec.template.spec.containers[0].image).toContain(':sha77e385c');
    expect(service.spec.template.spec.containers[0].env).toEqual([
      { name: 'GIT_SHA', value: '77e385c' },
      { name: 'GATEWAY_ENV', valueFrom: { secretKeyRef: { name: 'x' } } },
      { name: 'APP_VERSION', value: '1.0.0' },
    ]);
    expect(service.spec.traffic).toEqual([{ revisionName: 'logistikos-pristatymai-00042-abc', percent: 100 }]);
    expect(service.status).toBeUndefined();
  });

  it('reads Ready from a Cloud Run revision status document', () => {
    const readyScript = resolve(import.meta.dirname, '../../scripts/cloud-run-ready-status.mjs');
    const result = spawnSync(process.execPath, [readyScript], {
      input: JSON.stringify({
        status: {
          conditions: [
            { type: 'Active', status: 'Unknown' },
            { type: 'Ready', status: 'True' },
          ],
        },
      }),
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('True');
  });

  it('opens PORT 8080 before importing the internal gateway', () => {
    expect(productionServer.indexOf('server.listen(publicPort')).toBeLessThan(
      productionServer.indexOf("await import('../gateway/server.js')"),
    );
    expect(productionServer).toContain("pathname === '/health'");
    expect(productionServer).toContain('routingReadiness');
    expect(productionServer).toContain('routing');
  });

  it('keeps NLL182 odometer catalog on a relative import in the server graph', () => {
    expect(employeeStore).toContain("from '../src/domain/nll182-odometer-log.js'");
    expect(employeeStore).not.toContain("@/domain/nll182-odometer-log");
  });

  it('keeps Excel fuel catalog on a relative import in the server graph', () => {
    expect(employeeStore).toContain("from '../src/domain/excel-fuel-log.js'");
    expect(employeeStore).not.toContain("@/domain/excel-fuel-log");
  });
});
