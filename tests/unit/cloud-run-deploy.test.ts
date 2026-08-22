import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(resolve(import.meta.dirname, '../../.github/workflows/cloud-run-deploy.yml'), 'utf8');
const productionServer = readFileSync(resolve(import.meta.dirname, '../../server/production-server.ts'), 'utf8');
const employeeStore = readFileSync(resolve(import.meta.dirname, '../../server/employee-auth-store.ts'), 'utf8');

describe('Cloud Run deploy', () => {
  it('builds a unique image then deploys it instead of reusing a failed source revision', () => {
    expect(workflow).toContain('gcloud builds submit');
    expect(workflow).toContain('--tag "$IMAGE"');
    expect(workflow).toContain('--async');
    expect(workflow).toContain('gcloud builds describe');
    expect(workflow).toContain('--image "$IMAGE"');
    expect(workflow).toContain('--revision-suffix="s${GIT_SHA}"');
    expect(workflow).toContain('--no-traffic');
    expect(workflow).not.toMatch(/gcloud run deploy[\s\S]*--source \./);
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
});
