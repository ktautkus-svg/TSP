import { describe, expect, it } from 'vitest';

import { evaluateDepartureReadiness } from '../../src/domain/departure-readiness';
import { isUsablePhone, normalizePhone, telUrl } from '../../src/domain/phone';

const now = '2026-08-22T12:00:00.000Z';

function vehicle(overrides: Partial<{
  registrationNumber: string;
  technicalInspectionDueOn: string | null;
  roadTaxDueOn: string | null;
  nextServiceDueOn: string | null;
}> = {}) {
  return {
    id: 'vehicle-primary',
    registrationNumber: 'ABC123',
    technicalInspectionDueOn: null as string | null,
    roadTaxDueOn: null as string | null,
    nextServiceDueOn: null as string | null,
    ...overrides,
  };
}

describe('departure readiness', () => {
  it('lets the driver work when maintenance and contacts are still empty', () => {
    const readiness = evaluateDepartureReadiness({ vehicle: null, now });
    expect(readiness.canDepart).toBe(true);
    expect(readiness.canBeginLoading).toBe(true);
    expect(readiness.blockers).toEqual([]);
  });

  it('does not block on a placeholder registration or missing dates', () => {
    const readiness = evaluateDepartureReadiness({
      vehicle: vehicle({ registrationNumber: 'NENURODYTA' }),
      now,
    });
    expect(readiness.canDepart).toBe(true);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.warnings).toEqual([]);
  });

  it('blocks only after a saved deadline has expired', () => {
    const readiness = evaluateDepartureReadiness({
      vehicle: vehicle({
        technicalInspectionDueOn: '2026-08-01',
        roadTaxDueOn: '2026-12-31',
        nextServiceDueOn: '2027-01-01',
      }),
      now,
    });
    expect(readiness.canDepart).toBe(false);
    expect(readiness.blockers.map((issue) => issue.code)).toEqual(['INSPECTION_EXPIRED']);
  });

  it('warns about an approaching deadline without stopping work', () => {
    const readiness = evaluateDepartureReadiness({
      vehicle: vehicle({ roadTaxDueOn: '2026-08-30' }),
      now,
    });
    expect(readiness.canDepart).toBe(true);
    expect(readiness.warnings.map((issue) => issue.code)).toEqual(['ROAD_TAX_DUE_SOON']);
  });

  it('never treats a non-urgent fault as a driving block', () => {
    const readiness = evaluateDepartureReadiness({
      vehicle: vehicle({ technicalInspectionDueOn: '2027-01-01' }),
      faults: [{ id: 'fault-1', comment: 'Tylus ūžesys', notifiedAt: null }],
      now,
    });
    expect(readiness.canDepart).toBe(true);
    expect(readiness.warnings[0]?.code).toBe('OPEN_NON_URGENT_FAULT');
  });
});

describe('phone helpers', () => {
  it('normalizes Lithuanian numbers for click-to-call', () => {
    expect(normalizePhone('860012345')).toBe('+37060012345');
    expect(normalizePhone('+370 600 12345')).toBe('+37060012345');
    expect(isUsablePhone('860012345')).toBe(true);
    expect(isUsablePhone('')).toBe(false);
    expect(telUrl('860012345')).toBe('tel:+37060012345');
  });
});
