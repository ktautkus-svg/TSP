import { describe, expect, it } from 'vitest';

import { assignmentHasDeliveryHistory } from '../../src/application/routes/assignment-retention';
import { calculateRouteMetrics } from '../../src/domain/metrics';
import {
  actualFuelCostEur,
  consumedLitersForSingleRoute,
  monthFuelPrice,
  predictFuelCostEur,
} from '../../src/application/routes/route-fuel-cost';
import {
  formatShare,
  minutesAfterDeadline,
  sharePercent,
  stopPunctuality,
  summarizeOperations,
  type WorkQualityStop,
} from '../../src/application/quality/work-quality-kpi';
import { vehicleDocumentLabel, vehicleDocumentState } from '../../src/domain/vehicle-document-status';

const WINDOW = { deliveryTimeFrom: '08:00', deliveryTimeTo: '12:00' };

describe('delivery punctuality', () => {
  it('treats 11:45 as on time and 12:15 as late against a 12:00 deadline', () => {
    expect(stopPunctuality(delivered('2026-08-12T08:45:00.000Z', WINDOW))).toBe('on_time');
    expect(stopPunctuality(delivered('2026-08-12T09:15:00.000Z', WINDOW))).toBe('late');
    expect(minutesAfterDeadline(delivered('2026-08-12T09:15:00.000Z', WINDOW))).toBe(15);
  });

  it('counts an early delivery as on time because it is not later than the window end', () => {
    expect(stopPunctuality(delivered('2026-08-12T04:30:00.000Z', {
      deliveryTimeFrom: '08:00',
      deliveryTimeTo: '09:00',
    }))).toBe('on_time');
  });

  it('uses the window end when both bounds exist', () => {
    expect(stopPunctuality(delivered('2026-08-12T05:30:00.000Z', {
      deliveryTimeFrom: '08:00',
      deliveryTimeTo: '09:00',
    }))).toBe('on_time');
    expect(stopPunctuality(delivered('2026-08-12T06:01:00.000Z', {
      deliveryTimeFrom: '08:00',
      deliveryTimeTo: '09:00',
    }))).toBe('late');
  });

  it('leaves a delivery without a deadline or without a Pristatyta time unscored', () => {
    expect(stopPunctuality(delivered('2026-08-12T09:15:00.000Z', {
      deliveryTimeFrom: null,
      deliveryTimeTo: null,
    }))).toBe('unscored');
    expect(stopPunctuality({
      status: 'delivered',
      deliveredAt: null,
      deliveryTimeFrom: '08:00',
      deliveryTimeTo: '12:00',
    })).toBe('unscored');
    expect(stopPunctuality({
      status: 'pending',
      deliveredAt: null,
      ...WINDOW,
    })).toBe('unscored');
  });

  it('does not read a route completion timestamp', () => {
    const stop = {
      ...delivered('2026-08-12T08:45:00.000Z', WINDOW),
      completedAt: '2026-08-12T18:00:00.000Z',
    };
    expect(stopPunctuality(stop)).toBe('on_time');
  });
});

describe('operations summary', () => {
  it('scores on-time and late only among delivered stops that have a deadline', () => {
    const summary = summarizeOperations([{
      totalWeightKg: 400,
      stops: [
        ...counted('delivered', '2026-08-12T08:45:00.000Z', 18),
        ...counted('delivered', '2026-08-12T09:15:00.000Z', 2),
        stop('pending', null, 100),
        stop('failed', null, 100),
        { status: 'delivered', deliveredAt: '2026-08-12T08:00:00.000Z', deliveryTimeFrom: null, deliveryTimeTo: null, weightKg: 50 },
      ],
    }]);
    expect(summary.onTimeStops).toBe(18);
    expect(summary.lateStops).toBe(2);
    expect(summary.scoredStops).toBe(20);
    expect(formatShare(summary.onTimeStops, summary.scoredStops)).toBe('18 / 20 (90 %)');
    expect(formatShare(summary.lateStops, summary.scoredStops)).toBe('2 / 20 (10 %)');
    expect(summary.pendingStops).toBe(1);
    expect(summary.failedStops).toBe(1);
  });

  it('says there is no punctuality data instead of 0% when nothing can be compared', () => {
    expect(sharePercent(0, 0)).toBeNull();
    expect(formatShare(0, 0)).toBe('Nėra duomenų');
    const summary = summarizeOperations([{
      stops: [{ status: 'delivered', deliveredAt: '2026-08-12T08:00:00.000Z', deliveryTimeFrom: null, deliveryTimeTo: null, weightKg: 10 }],
    }]);
    expect(summary.scoredStops).toBe(0);
    expect(formatShare(summary.onTimeStops, summary.scoredStops)).toBe('Nėra duomenų');
  });

  it('keeps a real zero when stops exist and none are delivered', () => {
    const summary = summarizeOperations([{
      totalWeightKg: 1441,
      stops: [
        stop('pending', null, null),
        stop('pending', null, null),
        stop('pending', null, null),
        stop('pending', null, null),
      ],
    }]);
    expect(summary.routeCount).toBe(1);
    expect(summary.stopCount).toBe(4);
    expect(summary.cargoWeightKg).toBe(1441);
    expect(summary.deliveredStops).toBe(0);
    expect(summary.deliveredWeightKg).toBe(0);
    expect(summary.remainingWeightKg).toBe(1441);
    expect(sharePercent(0, 4)).toBe(0);
  });

  it('uses the same delivered and remaining split as the driver weight counters', () => {
    const stops = [
      stop('delivered', '2026-08-12T08:45:00.000Z', 40),
      stop('failed', null, 60),
      stop('pending', null, 20),
    ];
    const metrics = calculateRouteMetrics(stops.map((item) => ({
      weightKg: item.weightKg ?? 0,
      deliveryStatus: item.status,
    })));
    const summary = summarizeOperations([{ stops }]);
    expect(summary.cargoWeightKg).toBe(metrics.totalWeightKg);
    expect(summary.deliveredWeightKg).toBe(metrics.deliveredWeightKg);
    expect(summary.remainingWeightKg).toBe(metrics.remainingWeightKg);
    expect(summary.deliveredWeightKg).toBe(40);
    expect(summary.remainingWeightKg).toBe(20);
  });

  it('sums several routes once and does not treat a refused stop as delivered', () => {
    const summary = summarizeOperations([
      {
        stops: [
          stop('delivered', '2026-08-12T08:45:00.000Z', 40),
          stop('failed', null, 60),
          stop('pending', null, 20),
        ],
      },
      {
        stops: [
          stop('delivered', '2026-08-12T05:30:00.000Z', 15),
          stop('pending', null, 35),
          stop('pending', null, 10),
        ],
      },
    ]);
    expect(summary.cargoWeightKg).toBe(180);
    expect(summary.deliveredWeightKg).toBe(55);
    expect(summary.remainingWeightKg).toBe(65);
    expect(summary.deliveredStops).toBe(2);
    expect(summary.pendingStops).toBe(3);
    expect(summary.failedStops).toBe(1);
  });

  it('shows a gap instead of inventing kilograms when a delivered stop has no weight', () => {
    const summary = summarizeOperations([{
      totalWeightKg: 1441,
      stops: [
        { status: 'delivered', deliveredAt: '2026-08-12T08:45:00.000Z', ...WINDOW, weightKg: null },
        stop('pending', null, 100),
        stop('failed', null, 60),
      ],
    }]);
    expect(summary.deliveredWeightKg).toBeNull();
    expect(summary.remainingWeightKg).toBe(100);
    expect(summary.cargoWeightKg).toBeNull();
  });
});

describe('route fuel cost', () => {
  it('estimates from kilometres, the norm and the litre price', () => {
    expect(predictFuelCostEur({
      distanceKm: 100,
      litersPer100Km: 13.2,
      pricePerLiter: 1.5,
      consumedLiters: null,
    })).toBe(19.8);
  });

  it('prices actual consumed litres separately and refuses to invent either figure', () => {
    const quote = {
      distanceKm: null,
      litersPer100Km: 13.2,
      pricePerLiter: 1.5,
      consumedLiters: 20,
    };
    expect(predictFuelCostEur(quote)).toBeNull();
    expect(actualFuelCostEur(quote)).toBe(30);
    expect(consumedLitersForSingleRoute({
      litersPer100Km: 10,
      odometerKm: 50,
      routeCountOnVehicleDay: 2,
    })).toBeNull();
    expect(consumedLitersForSingleRoute({
      litersPer100Km: 10,
      odometerKm: 50,
      routeCountOnVehicleDay: 1,
    })).toBe(5);
  });

  it('reads the month price that is already stored for the route date', () => {
    expect(monthFuelPrice('2026-08-12', [1, 1, 1, 1, 1, 1, 1, 1.13, 1, 1, 1, 1])).toBe(1.13);
  });
});

describe('vehicle document status', () => {
  const today = '2026-10-01';

  it('labels the 30 day boundary without inventing a date', () => {
    expect(vehicleDocumentState(null, today)).toBe('missing');
    expect(vehicleDocumentState('2026-09-30', today)).toBe('expired');
    expect(vehicleDocumentState('2026-10-01', today)).toBe('expired');
    expect(vehicleDocumentState('2026-10-31', today)).toBe('expiring');
    expect(vehicleDocumentState('2026-11-01', today)).toBe('valid');
    expect(vehicleDocumentLabel('expiring')).toBe('Baigiasi');
    expect(vehicleDocumentLabel('missing')).toBe('Nenurodyta');
  });
});

describe('assignment retention', () => {
  it('blocks deletion once a stop has been delivered or refused', () => {
    expect(assignmentHasDeliveryHistory('assigned', [])).toBe(false);
    expect(assignmentHasDeliveryHistory('in_progress', [{ delivery_status: 'pending' }])).toBe(false);
    expect(assignmentHasDeliveryHistory('in_progress', [{ delivery_status: 'delivered' }])).toBe(true);
    expect(assignmentHasDeliveryHistory('completed', [{ delivery_status: 'pending' }])).toBe(true);
  });
});

function delivered(deliveredAt: string, window: { deliveryTimeFrom: string | null; deliveryTimeTo: string | null }): WorkQualityStop {
  return { status: 'delivered', deliveredAt, ...window };
}

function stop(
  status: WorkQualityStop['status'],
  deliveredAt: string | null,
  weightKg: number | null,
): WorkQualityStop {
  return { status, deliveredAt, ...WINDOW, weightKg };
}

function counted(status: 'delivered', deliveredAt: string, count: number): WorkQualityStop[] {
  return Array.from({ length: count }, () => stop(status, deliveredAt, 1));
}
