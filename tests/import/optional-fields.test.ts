import { describe, expect, it } from 'vitest';

import { parseDeliveries } from '../../src/application/import/delivery-parser';
import { deliveriesToRoutePoints } from '../../src/application/import/route-import-mapper';
import { buildOptimizationRequestFromPoints } from '../../src/application/parsing/text-parser';
import { RoutingEngine } from '../../src/application/routing/routing-engine';
import type { ParsedDelivery } from '../../src/domain/import/models';
import { summarizeStopWeights } from '../../src/domain/routing/weights';
import { SyntheticTravelCostProvider } from '../../src/infrastructure/routing/providers/synthetic-travel-cost-provider';

const departureAt = '2099-08-03T05:00:00.000Z';
const startLocation = {
  normalizedAddress: 'Kirtimų g. 47, Vilnius',
  latitude: 54.62557,
  longitude: 25.147403,
  placeId: 'start',
  locationType: 'ROOFTOP',
  resultTypes: ['street_address'],
};

describe('optional import fields', () => {
  it('accepts an address with every optional field missing', () => {
    const delivery = confirmed(parseDeliveries('Gedimino pr. 9, Vilnius')[0], 0);
    expect(delivery.orderNumber.value).toBeNull();
    expect(delivery.weightKg.value).toBeNull();
    expect(delivery.deliveryTime.value).toBeNull();
    expect(delivery.phone.value).toBeNull();
    expect(delivery.recipient.value).toBeNull();
    expect(delivery.notes.value).toBeNull();
    expect(delivery.parserConfidence).toBeGreaterThan(0.7);
    expect(deliveriesToRoutePoints([delivery])).toHaveLength(1);
  });

  it('maps address plus weight without inventing a time window', () => {
    const delivery = confirmed(parseDeliveries('Gedimino pr. 9, Vilnius\n150 kg')[0], 0);
    const [point] = deliveriesToRoutePoints([delivery]);
    expect(point.weightKg).toBe(150);
    expect(point.timeWindow).toBeNull();
  });

  it('maps address plus time while preserving unknown weight as null', () => {
    const delivery = confirmed(parseDeliveries('Gedimino pr. 9, Vilnius\n08:00')[0], 0);
    const [point] = deliveriesToRoutePoints([delivery]);
    expect(point.weightKg).toBeNull();
    expect(point.timeWindow).toMatchObject({ from: '08:00', to: '08:00' });
  });

  it('maps address, weight and a delivery time window together', () => {
    const delivery = confirmed(
      parseDeliveries('Gedimino pr. 9, Vilnius\n150 kg\n08:00-10:00')[0],
      0,
    );
    const [point] = deliveriesToRoutePoints([delivery]);
    expect(point.weightKg).toBe(150);
    expect(point.timeWindow).toMatchObject({ from: '08:00', to: '10:00' });
  });

  it('applies time evaluation only to stops that have a time', () => {
    const deliveries = parseDeliveries(
      'Gedimino pr. 9, Vilnius\n08:00-10:00\n\nSavanorių pr. 1, Vilnius',
    ).map(confirmed);
    const request = buildOptimizationRequestFromPoints(deliveriesToRoutePoints(deliveries), {
      departureAt,
      startLocation,
    });
    expect(request.planningMode).toBe('with_time_windows');
    expect(request.stops[0].informationalTimeWindow).toBeDefined();
    expect(request.stops[1].informationalTimeWindow).toBeUndefined();
    expect(request.stops.every((stop) => stop.requiredTimeWindow === undefined)).toBe(true);
  });

  it('keeps partial weights distinct from explicit zero and totals only known weights', () => {
    const deliveries = parseDeliveries(
      'Gedimino pr. 9, Vilnius\n150 kg\n\nSavanorių pr. 1, Vilnius',
    ).map(confirmed);
    const request = buildOptimizationRequestFromPoints(deliveriesToRoutePoints(deliveries), {
      departureAt,
      startLocation,
    });
    expect(request.stops.map((stop) => stop.weightKg)).toEqual([150, null]);
    expect(summarizeStopWeights(request.stops)).toEqual({
      knownTotalKg: 150,
      unknownStopCount: 1,
      explicitZeroStopCount: 0,
    });
  });

  it('does not represent missing optional fields as low-confidence problems', () => {
    const [delivery] = parseDeliveries('Gedimino pr. 9, Vilnius');
    expect([
      delivery.orderNumber,
      delivery.weightKg,
      delivery.deliveryTime,
      delivery.phone,
      delivery.recipient,
      delivery.notes,
    ].every((field) => field.value === null && field.confidence === 0)).toBe(true);
  });

  it('rejects a delivery when its required address is missing', () => {
    const [delivery] = parseDeliveries('150 kg\n08:00');
    expect(delivery.address.value).toBeNull();
    expect(delivery.validationState).toBe('invalid');
    expect(() => deliveriesToRoutePoints([delivery])).toThrow(/neturi patvirtinto adreso/u);
  });

  it('optimizes mixed known and unknown weights without a synthetic replacement', async () => {
    const deliveries = parseDeliveries(
      'Gedimino pr. 9, Vilnius\n150 kg\n08:00\n\nSavanorių pr. 1, Vilnius',
    ).map(confirmed);
    const request = buildOptimizationRequestFromPoints(deliveriesToRoutePoints(deliveries), {
      departureAt,
      startLocation,
    });
    const result = await new RoutingEngine(
      new SyntheticTravelCostProvider('city_traffic'),
    ).optimize(request);
    expect(result.recommended).not.toBeNull();
    expect(result.recommended?.warnings).toContain(
      '1 taško(-ų) svoris nežinomas; svorio rodikliai skaičiuojami tik iš žinomų svorių.',
    );
  });
});

function confirmed(delivery: ParsedDelivery, index: number): ParsedDelivery {
  const selectedAddress = {
    normalizedAddress: `${delivery.address.value}, Lietuva`,
    latitude: 54.6872 + index * 0.01,
    longitude: 25.2797 + index * 0.01,
    placeId: `place-${index}`,
    confidence: 0.96,
  };
  return {
    ...delivery,
    addressCandidates: [selectedAddress],
    selectedAddress,
    addressConfidence: selectedAddress.confidence,
    validationState: 'valid',
  };
}
