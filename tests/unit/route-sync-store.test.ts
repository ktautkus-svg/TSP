import { describe, expect, it } from 'vitest';

import { decidePushOutcome, type PushDecisionInput } from '../../server/route-sync-store';

const owner: PushDecisionInput = { ownerEmployeeId: 'employee-1', status: 'in_progress', updatedAt: '2026-08-11T08:00:00.000Z' };

describe('route sync push conflict decision', () => {
  it('applies the first push when no route exists yet', () => {
    expect(decidePushOutcome(null, owner)).toBe('applied');
  });

  it('rejects a push from a different owner than the stored route', () => {
    const existing: PushDecisionInput = { ...owner, ownerEmployeeId: 'employee-1' };
    const incoming: PushDecisionInput = { ...owner, ownerEmployeeId: 'employee-2', updatedAt: '2026-08-11T09:00:00.000Z' };
    expect(decidePushOutcome(existing, incoming)).toBe('forbidden');
  });

  it('applies a strictly newer write from the same owner', () => {
    const existing: PushDecisionInput = { ...owner, updatedAt: '2026-08-11T08:00:00.000Z' };
    const incoming: PushDecisionInput = { ...owner, updatedAt: '2026-08-11T08:05:00.000Z' };
    expect(decidePushOutcome(existing, incoming)).toBe('applied');
  });

  it('rejects a stale write that is not newer than what is already stored', () => {
    const existing: PushDecisionInput = { ...owner, updatedAt: '2026-08-11T08:05:00.000Z' };
    const incoming: PushDecisionInput = { ...owner, updatedAt: '2026-08-11T08:00:00.000Z' };
    expect(decidePushOutcome(existing, incoming)).toBe('conflict');

    const sameTimestamp: PushDecisionInput = { ...owner, updatedAt: '2026-08-11T08:05:00.000Z' };
    expect(decidePushOutcome(existing, sameTimestamp)).toBe('conflict');
  });

  it('never lets a stale write move a completed route away from completed', () => {
    const existing: PushDecisionInput = { ...owner, status: 'completed', updatedAt: '2026-08-11T10:00:00.000Z' };
    const staleInProgress: PushDecisionInput = { ...owner, status: 'in_progress', updatedAt: '2026-08-11T11:00:00.000Z' };
    expect(decidePushOutcome(existing, staleInProgress)).toBe('conflict');
  });

  it('never lets a stale write resurrect a cancelled route', () => {
    const existing: PushDecisionInput = { ...owner, status: 'cancelled', updatedAt: '2026-08-11T10:00:00.000Z' };
    const staleDraft: PushDecisionInput = { ...owner, status: 'draft', updatedAt: '2026-08-11T12:00:00.000Z' };
    expect(decidePushOutcome(existing, staleDraft)).toBe('conflict');
  });

  it('still allows a newer correction that keeps the same terminal status', () => {
    const existing: PushDecisionInput = { ...owner, status: 'completed', updatedAt: '2026-08-11T10:00:00.000Z' };
    const laterCorrection: PushDecisionInput = { ...owner, status: 'completed', updatedAt: '2026-08-11T10:05:00.000Z' };
    expect(decidePushOutcome(existing, laterCorrection)).toBe('applied');
  });
});
