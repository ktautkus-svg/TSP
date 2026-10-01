import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  buildRouteCompletionFuelRequest,
  persistRouteCompletionFuel,
  routeCompletionFuelFieldError,
} from '../../src/application/routes/route-completion-form';
import { isEmployeePath } from '../../server/employee-api';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const productionServer = readFileSync(resolve(root, 'server/production-server.ts'), 'utf8');

describe('route completion fuel path', () => {
  it('sends a fuel save to the employee API and leaves the polyline route on the gateway', () => {
    expect(isEmployeePath('/api/routes/route-1/fuel-entries')).toBe(true);
    expect(isEmployeePath('/api/routes/route%201/fuel-entries')).toBe(true);
    expect(isEmployeePath('/api/routes')).toBe(false);
    expect(isEmployeePath('/api/routes/')).toBe(false);
    expect(productionServer).toContain("'/api/routes': '/v1/polyline'");
  });

  it('names the missing fuel choice and the missing liters before any save', () => {
    expect(routeCompletionFuelFieldError(null, '')).toBe('Pasirinkite, ar buvo pilti degalai.');
    expect(routeCompletionFuelFieldError('yes', '')).toBe('Įveskite įpilto kuro kiekį litrais.');
    expect(routeCompletionFuelFieldError('yes', '0')).toContain('litr');
    expect(routeCompletionFuelFieldError('no', '')).toBeNull();
  });

  it('builds a fuel-filled request and skips the save when fuel was not filled', async () => {
    expect(buildRouteCompletionFuelRequest({
      choice: 'yes',
      filledAt: '2026-09-29T14:00:00.000Z',
      odometer: 182400,
      litersText: '46,5',
      receiptNumber: ' DEMO-1 ',
    })).toEqual({
      filledAt: '2026-09-29T14:00:00.000Z',
      odometer: 182400,
      liters: 46.5,
      receiptNumber: 'DEMO-1',
    });
    const save = viSave();
    await expect(persistRouteCompletionFuel(null, false, save.fn)).resolves.toBe(false);
    expect(save.calls).toBe(0);
  });

  it('saves filled fuel once and still completes when the same submission is retried', async () => {
    const request = buildRouteCompletionFuelRequest({
      choice: 'yes',
      filledAt: '2026-09-29T14:00:00.000Z',
      odometer: 182400,
      litersText: '40',
      receiptNumber: '',
    });
    const save = viSave();
    await expect(persistRouteCompletionFuel(request, false, save.fn)).resolves.toBe(true);
    await expect(persistRouteCompletionFuel(request, true, save.fn)).resolves.toBe(true);
    expect(save.calls).toBe(1);
  });
});

function viSave() {
  const state = { calls: 0, fn: async () => { state.calls += 1; } };
  return state;
}
