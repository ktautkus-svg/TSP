import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { buildWagePrintDocument } from '../../src/application/finance/wage-document';
import { aggregateWageDays, summarizeWageDays } from '../../src/application/finance/wage-report';
import { buildWageWorkbook } from '../../src/application/finance/wage-workbook';
import { formatDateKey } from '../../src/application/reporting/period-range';
import type { ServerTripSheet } from '../../src/infrastructure/auth/employee-session';

function sheet(overrides: Partial<ServerTripSheet> = {}): ServerTripSheet {
  return {
    id: 'sheet-1', assignmentId: 'assignment-1', routeId: 'route-1', routeNumbers: [], status: 'completed',
    date: '2026-08-24', driverId: 'driver-1', driverName: 'Karolis Tautkus', vehicle: null,
    fuelNormLitersPer100Km: null, startOdometer: null, endOdometer: null, actualDistanceKm: 363,
    plannedDistanceKm: null, startedAt: null, completedAt: null, durationMinutes: null, totalStops: 0,
    deliveredStops: 0, totalWeightKg: 0, deliveredWeightKg: 0, startAddress: '', endAddress: '',
    compensation: {
      rates: { type: 'variable', fixedDailyNetEur: 23, perKmEur: 0.05, perKgEur: 0.006, perStopEur: 0.65 },
      distanceKm: 20, distanceSource: 'odometer', weightKg: 100, stops: 2, fixedAmountEur: 23,
      distanceAmountEur: 1, weightAmountEur: 0.6, stopsAmountEur: 1.3, totalNetEur: 25.9,
      preliminary: false,
    },
    fuelEntries: [],
    ...overrides,
  };
}

describe('wage export', () => {
  const days = aggregateWageDays([
    sheet({ id: 'newer', date: '2026-08-20', compensation: { ...sheet().compensation!, distanceKm: 5, totalNetEur: 10, fixedAmountEur: 10, distanceAmountEur: 0, weightAmountEur: 0, stopsAmountEur: 0 } }),
    sheet({ id: 'older', date: '2026-08-02' }),
  ]);
  const totals = summarizeWageDays(days);
  const periodLabel = '2026-08-01 – 2026-08-31';

  it('exports the selected employee and period with numeric euro cells, oldest day first', () => {
    const bytes = buildWageWorkbook({
      companyName: 'FiRo',
      employeeName: 'Karolis Tautkus',
      periodLabel,
      days,
    });
    const sheetXml = strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']!);
    const styles = strFromU8(unzipSync(bytes)['xl/styles.xml']!);
    expect(sheetXml).toContain('FiRo');
    expect(sheetXml).toContain('Karolis Tautkus');
    expect(sheetXml).toContain(periodLabel);
    expect(sheetXml).not.toContain('Kitas Vairuotojas');
    expect(sheetXml.indexOf('2026-08-02')).toBeLessThan(sheetXml.indexOf('2026-08-20'));
    expect(sheetXml).toMatch(/<c r="J5"[^>]*><v>25.9<\/v><\/c>/);
    expect(sheetXml).not.toMatch(/<c r="J5"[^>]*t="inlineStr"/);
    expect(sheetXml).toContain(`<v>${totals.wageEur}</v>`);
    expect(sheetXml).toContain(`<v>${totals.totalEur}</v>`);
    expect(styles).toContain('formatCode="#,##0.00 &quot;€&quot;"');
    expect(styles).toContain('formatCode="#,##0.0 &quot;km&quot;"');
    expect(styles).toContain('formatCode="#,##0.0 &quot;kg&quot;"');
    expect(styles).toContain('formatCode="0"');
  });

  it('prints the same employee, period, order and wage total', () => {
    const html = buildWagePrintDocument({
      companyName: 'FiRo',
      employeeName: 'Karolis Tautkus',
      periodLabel,
      days,
    });
    expect(html).toContain('Darbuotojas: Karolis Tautkus');
    expect(html).toContain(`Laikotarpis: ${periodLabel}`);
    expect(html.indexOf(formatDateKey('2026-08-02'))).toBeLessThan(html.indexOf(formatDateKey('2026-08-20')));
    expect(html).toContain('Bazė €');
    expect(html).toContain('Dienos suma €');
    expect(html).not.toMatch(/bonus|priedas/i);
    expect(html).toContain('thead { display: table-header-group; }');
    expect(html).toContain('counter(page)');
    expect(html).not.toMatch(/https?:\/\//);
    const printedWage = new Intl.NumberFormat('lt-LT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(totals.wageEur);
    expect(html).toContain(printedWage);
  });
});
