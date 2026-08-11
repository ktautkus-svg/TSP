import { access } from 'node:fs/promises';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareMatrices, compareSequences } from '../../gateway/benchmark/analysis';
import { normalizeGoogleMatrix } from '../../gateway/providers/google-matrix-adapter';
import { normalizeHereMatrix } from '../../gateway/providers/here-matrix-adapter';
import { gatewayRequest } from './helpers';

describe('provider comparison', () => {
  it('compares identical scenario matrices and sequence changes', async () => {
    const here = normalizeHereMatrix(
      JSON.parse(await readFile(resolve('gateway/fixtures/here-matrix-success.json'), 'utf8')),
      gatewayRequest('here'),
      1,
    ).matrix;
    const google = normalizeGoogleMatrix(
      JSON.parse(await readFile(resolve('gateway/fixtures/google-matrix-success.json'), 'utf8')),
      gatewayRequest('google'),
      1,
    ).matrix;
    const matrix = compareMatrices(here, google);
    expect(matrix.comparablePairs).toBe(6);
    expect(matrix.medianDurationDifferencePercent).toBeGreaterThan(0);

    const base = { stopSequence: ['a', 'b', 'c'] };
    const changed = { stopSequence: ['b', 'a', 'c'] };
    const comparison = compareSequences(
      base as never,
      changed as never,
      'b',
    );
    expect(comparison.classification).toBe('significant');
    expect(comparison.firstChanged).toBe(true);
  });
});

describe('client secret boundary', () => {
  it('keeps server API key variable names outside Expo src and production dist', async () => {
    const forbidden = ['HERE_API_KEY', 'GOOGLE_ROUTES_API_KEY'];
    const directories = ['src'];
    // dist/ exists only after `npm run pwa:build`; skip it when absent so unit
    // runs stay green without a production bundle artifact.
    if (await exists(resolve('dist'))) directories.push('dist');
    for (const directory of directories) {
      for (const file of await files(resolve(directory))) {
        const content = await readFile(file, 'utf8').catch(() => '');
        for (const token of forbidden) expect(content).not.toContain(token);
      }
    }
  });
});

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function files(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else result.push(path);
  }
  return result;
}

