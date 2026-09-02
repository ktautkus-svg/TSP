import { describe, expect, it } from 'vitest';

import { MemoryGatewayUsageGuard } from '../../gateway/usage-guard';

describe('gateway routing usage guard', () => {
  const config = {
    armed: true,
    dailyUnits: 10,
    weeklyUnits: 20,
    dailyBudgetCents: null,
    weeklyBudgetCents: null,
  };

  it('blocks real provider use while disarmed', async () => {
    const guard = new MemoryGatewayUsageGuard({ ...config, armed: false });
    await expect(guard.reserve(1, null)).rejects.toMatchObject({ code: 'REAL_PROVIDER_DISABLED' });
  });

  it('counts daily and weekly usage before the provider call', async () => {
    const guard = new MemoryGatewayUsageGuard(config);
    const now = new Date('2026-08-20T10:00:00Z');
    await guard.reserve(6, null, now);
    await expect(guard.reserve(5, null, now)).rejects.toMatchObject({ code: 'ROUTING_BUDGET_EXCEEDED' });
  });

  it('allows cache-hit callers to skip the guard entirely by contract', async () => {
    const guard = new MemoryGatewayUsageGuard({ ...config, dailyUnits: 1 });
    await guard.reserve(1, null, new Date('2026-08-20T10:00:00Z'));
    await expect(guard.reserve(1, null, new Date('2026-08-20T10:01:00Z'))).rejects.toMatchObject({ code: 'ROUTING_BUDGET_EXCEEDED' });
  });

  it('enforces configured money budgets when provider pricing is known', async () => {
    const guard = new MemoryGatewayUsageGuard({ ...config, dailyBudgetCents: 100 });
    await guard.reserve(1, 80, new Date('2026-08-20T10:00:00Z'));
    await expect(guard.reserve(1, 21, new Date('2026-08-20T10:01:00Z'))).rejects.toMatchObject({ code: 'ROUTING_BUDGET_EXCEEDED' });
  });

  it('does not let yesterday\'s matrix usage block address verification', async () => {
    const guard = new MemoryGatewayUsageGuard({ ...config, dailyUnits: 1 });
    const now = new Date('2026-08-20T10:00:00Z');
    await guard.reserve(1, null, now, 'routing');
    await expect(guard.reserve(1, null, now, 'geocoding')).resolves.toBeUndefined();
    await expect(guard.reserve(1, null, now, 'routing')).rejects.toMatchObject({
      code: 'ROUTING_BUDGET_EXCEEDED',
    });
  });

  it('resets the daily bucket at Lithuania midnight rather than UTC midnight', async () => {
    const guard = new MemoryGatewayUsageGuard({ ...config, dailyUnits: 1 });
    await guard.reserve(1, null, new Date('2026-08-20T20:59:00Z'));
    await expect(guard.reserve(1, null, new Date('2026-08-20T21:01:00Z'))).resolves.toBeUndefined();
  });
});
