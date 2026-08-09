import { describe, expect, it } from 'vitest';

import { getRouteCreationBlockers } from '../../src/application/import/route-creation-readiness';
import type { ImportResult, ParsedDelivery } from '../../src/domain/import/models';
import type { RouteEndpoint } from '../../src/domain/route';

const endpoint: RouteEndpoint = {
  originalAddress: 'Tilžės g. 1, Šiauliai',
  geocodingQuery: 'Tilžės g. 1, Šiauliai',
  normalizedAddress: 'Tilžės g. 1, Šiauliai',
  latitude: 55.93,
  longitude: 23.31,
};

const candidate = {
  normalizedAddress: 'Tilžės g. 1, Šiauliai',
  latitude: 55.93,
  longitude: 23.31,
  placeId: null,
  confidence: 1,
};

const delivery: ParsedDelivery = {
  id: 'delivery-1', sourcePage: null, rawText: 'Tilžės g. 1',
  address: { value: endpoint.originalAddress, confidence: 1, evidence: null, manuallyCorrected: false },
  addressQuery: endpoint.originalAddress,
  orderNumber: { value: null, confidence: 0, evidence: null, manuallyCorrected: false },
  weightKg: { value: null, confidence: 0, evidence: null, manuallyCorrected: false },
  deliveryTime: { value: null, confidence: 0, evidence: null, manuallyCorrected: false },
  phone: { value: null, confidence: 0, evidence: null, manuallyCorrected: false },
  recipient: { value: null, confidence: 0, evidence: null, manuallyCorrected: false },
  notes: { value: null, confidence: 0, evidence: null, manuallyCorrected: false },
  parserConfidence: 1, addressConfidence: 1, importConfidence: 1,
  addressCandidates: [candidate],
  selectedAddress: candidate,
  validationState: 'valid',
};

const result = { deliveries: [delivery] } as ImportResult;

describe('route creation readiness', () => {
  it('does not invent a hidden blocker when delivery and endpoints are valid', () => {
    expect(getRouteCreationBlockers({
      result, excelPreview: null, planningMode: 'ignore_time_windows',
      warehouseEndpoint: endpoint, homeEndpoint: endpoint, endMode: 'home',
    })).toEqual([]);
  });

  it('reports the real missing saved-location blocker instead of blaming marked stops', () => {
    expect(getRouteCreationBlockers({
      result, excelPreview: null, planningMode: 'ignore_time_windows',
      warehouseEndpoint: { ...endpoint, latitude: null, longitude: null }, homeEndpoint: endpoint, endMode: 'warehouse',
    })).toEqual(['Sandėlio adresui trūksta patvirtintų koordinačių.']);
  });

  it('names the exact unconfirmed delivery', () => {
    expect(getRouteCreationBlockers({
      result: { ...result, deliveries: [{ ...delivery, selectedAddress: null, validationState: 'pending' }] },
      excelPreview: null, planningMode: 'ignore_time_windows',
      warehouseEndpoint: endpoint, homeEndpoint: null, endMode: 'warehouse',
    })).toEqual(['Pristatymo taškas 1: adresas dar nepatvirtintas.']);
  });
});
