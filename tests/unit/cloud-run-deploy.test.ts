import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(resolve(import.meta.dirname, '../../.github/workflows/cloud-run-deploy.yml'), 'utf8');
const productionServer = readFileSync(resolve(import.meta.dirname, '../../server/production-server.ts'), 'utf8');
const employeeStore = readFileSync(resolve(import.meta.dirname, '../../server/employee-auth-store.ts'), 'utf8');
const script = resolve(import.meta.dirname, '../../scripts/prepare-cloud-run-revision.mjs');

describe('Cloud Run deploy', () => {
  it('deletes the stuck failed revision then deploys a unique image with an auto-generated name', () => {
    expect(workflow).toContain('gcloud builds submit');
    expect(workflow).toContain('--tag "$IMAGE"');
    expect(workflow).toContain('gcloud builds describe');
    expect(workflow).toContain('prepare-cloud-run-revision.mjs');
    expect(workflow).toContain('cloud-run-ready-status.mjs');
    expect(workflow).toContain('--revision-suffix="n${GIT_SHA}"');
    expect(workflow).toContain('--image "$IMAGE"');
    expect(workflow).not.toContain('--clear-revision-suffix');
    expect(workflow).not.toMatch(/gcloud run deploy[\s\S]*--source \./);
    expect(workflow).not.toContain('gcloud run services replace');
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
