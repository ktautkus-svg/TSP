import { describe, expect, it, vi } from 'vitest';

import { GoogleMatrixAdapter } from '../../gateway/providers/google-matrix-adapter';
import {
  GOOGLE_MATRIX_MAX_ELEMENTS_PER_REQUEST,
  MATRIX_CHUNK_SIZE,
  MAX_MATRIX_ELEMENTS_PER_PLAN,
  MAX_STOPS_IN_SINGLE_REQUEST,
  MAX_STOPS_PER_PLAN,
  planMatrixRequests,
} from '../../src/domain/routing/matrix-limits';
import type { GatewayMatrixRequest } from '../../gateway/types';
import type { RoutingLocation } from '../../src/domain/routing/models';

function location(id: string, index: number): RoutingLocation {
  return { id, label: id, latitude: 54.6 + index * 0.01, longitude: 25.2 + index * 0.01 };
}

function request(stopCount: number): GatewayMatrixRequest {
  return {
    schemaVersion: '1',
    provider: 'google',
    matrixId: `m-${stopCount}`,
    startLocation: location('start', 0),
    stops: Array.from({ length: stopCount }, (_, index) => location(`s${index}`, index + 1)),
    endLocation: location('end', stopCount + 1),
    departureAt: '2026-06-15T07:00:00.000Z',
    trafficMode: 'live',
    vehicle: {
      id: 'v1', type: 'van', maximumPayloadKg: 1200, useRoadRestrictions: false,
      startLocation: location('start', 0), defaultEndLocation: location('end', stopCount + 1),
    },
    language: 'lt-LT',
    regionCode: 'LT',
  };
}

/** Answers every chunk with a complete element grid for that chunk. */
function chunkFetcher() {
  const bodies: { origins: number; destinations: number }[] = [];
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { origins: unknown[]; destinations: unknown[] };
    bodies.push({ origins: body.origins.length, destinations: body.destinations.length });
    const elements = body.origins.flatMap((_, originIndex) =>
      body.destinations.map((__, destinationIndex) => ({
        originIndex,
        destinationIndex,
        status: {},
        condition: 'ROUTE_EXISTS',
        distanceMeters: 1_000,
        duration: '600s',
      })),
    );
    return new Response(JSON.stringify(elements), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { fetcher, bodies };
}

describe('Google 625 elementų riba', () => {
  it('planMatrixRequests sutampa su tikrove', () => {
    expect(GOOGLE_MATRIX_MAX_ELEMENTS_PER_REQUEST).toBe(625);
    expect(MATRIX_CHUNK_SIZE ** 2).toBe(GOOGLE_MATRIX_MAX_ELEMENTS_PER_REQUEST);
    expect(MAX_STOPS_IN_SINGLE_REQUEST).toBe(23);

    expect(planMatrixRequests(25)).toMatchObject({ httpRequests: 1, billableElements: 625, singleRequest: true });
    expect(planMatrixRequests(26)).toMatchObject({ httpRequests: 4, billableElements: 676, singleRequest: false });
    expect(planMatrixRequests(27)).toMatchObject({ httpRequests: 4, billableElements: 729, singleRequest: false });
  });

  // 23 stops + start + end = 25 nodes = 625 elements = the ceiling exactly.
  it.each([
    [10, 1, 144],
    [15, 1, 289],
    [20, 1, 484],
    [23, 1, 625],
  ])('%i taškų – %i tikra HTTP užklausa, %i elementų', async (stops, expectedRequests, expectedElements) => {
    const { fetcher, bodies } = chunkFetcher();
    const result = await new GoogleMatrixAdapter('key', fetcher as unknown as typeof fetch, MATRIX_CHUNK_SIZE)
      .fetchMatrix(request(stops), new AbortController().signal);

    expect(fetcher).toHaveBeenCalledTimes(expectedRequests);
    expect(result.billableElementCount).toBe(expectedElements);
    expect(bodies.every((body) => body.origins * body.destinations <= GOOGLE_MATRIX_MAX_ELEMENTS_PER_REQUEST)).toBe(true);
  });

  it('24 ir 25 taškai netyliai virsta keliomis mokamomis užklausomis', async () => {
    for (const [stops, expectedRequests, expectedElements] of [[24, 4, 676], [25, 4, 729]] as const) {
      const { fetcher, bodies } = chunkFetcher();
      const result = await new GoogleMatrixAdapter('key', fetcher as unknown as typeof fetch, MATRIX_CHUNK_SIZE)
        .fetchMatrix(request(stops), new AbortController().signal);

      // Tai ir yra tai, ką ankstesnė ataskaita pražiūrėjo: viena "matrica" – kelios sąskaitos.
      expect(fetcher).toHaveBeenCalledTimes(expectedRequests);
      expect(result.billableElementCount).toBe(expectedElements);
      // Bet nė viena atskira užklausa neperžengia Google ribos.
      for (const body of bodies) {
        expect(body.origins * body.destinations).toBeLessThanOrEqual(GOOGLE_MATRIX_MAX_ELEMENTS_PER_REQUEST);
      }
    }
  });

  it('kiekvienas gabalas telpa į 625 ir prie didžiausio leidžiamo maršruto', async () => {
    const { fetcher, bodies } = chunkFetcher();
    // 25 taškai = 27 mazgai: didžiausias, kurį riba dar praleidžia.
    await new GoogleMatrixAdapter('key', fetcher as unknown as typeof fetch, MATRIX_CHUNK_SIZE)
      .fetchMatrix(request(MAX_STOPS_PER_PLAN), new AbortController().signal);

    expect(fetcher).toHaveBeenCalledTimes(4);
    for (const body of bodies) {
      expect(body.origins).toBeLessThanOrEqual(MATRIX_CHUNK_SIZE);
      expect(body.destinations).toBeLessThanOrEqual(MATRIX_CHUNK_SIZE);
      expect(body.origins * body.destinations).toBeLessThanOrEqual(GOOGLE_MATRIX_MAX_ELEMENTS_PER_REQUEST);
    }
  });

  // Riba uždėta ties 729 = 27x27 = 25 pristatymo taškai + startas + pabaiga.
  // Google ima UŽ ELEMENTĄ, tad 24 taškai (4 užklausos, 676 elementai) kainuoja
  // apie 8 % daugiau nei 23 taškai (1 užklausa, 625), o ne keturis kartus.
  it.each([
    [23, 625, 1],
    [24, 676, 4],
    [25, 729, 4],
  ])('%i taškų leidžiama: %i elementų per %i užklausą(-as)', async (stops, elements, requests) => {
    const { fetcher } = chunkFetcher();
    const result = await new GoogleMatrixAdapter('key', fetcher as unknown as typeof fetch, MATRIX_CHUNK_SIZE)
      .fetchMatrix(request(stops), new AbortController().signal);

    expect(result.billableElementCount).toBe(elements);
    expect(fetcher).toHaveBeenCalledTimes(requests);
    expect(elements).toBeLessThanOrEqual(MAX_MATRIX_ELEMENTS_PER_PLAN);
  });

  it('26 taškai blokuojami dar prieš bet kokią Google užklausą', async () => {
    const { fetcher } = chunkFetcher();
    // 26 + startas + pabaiga = 28 mazgai = 784 elementai > 729.
    expect(planMatrixRequests(28).billableElements).toBe(784);
    expect(planMatrixRequests(28).withinPlanLimit).toBe(false);

    await expect(
      new GoogleMatrixAdapter('key', fetcher as unknown as typeof fetch, MATRIX_CHUNK_SIZE)
        .fetchMatrix(request(26), new AbortController().signal),
    ).rejects.toThrow(/limitas viršytas/i);

    // Svarbiausia: nė viena mokama užklausa neišėjo.
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('riba atitinka pilną 25 taškų maršrutą', () => {
    expect(MAX_MATRIX_ELEMENTS_PER_PLAN).toBe(729);
    expect(MAX_STOPS_PER_PLAN).toBe(25);
    expect(planMatrixRequests(27).billableElements).toBe(MAX_MATRIX_ELEMENTS_PER_PLAN);
    expect(planMatrixRequests(27).withinPlanLimit).toBe(true);
  });
});
