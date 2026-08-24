import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { RoutingEngine } from '@/application/routing/routing-engine';
import { buildRouteAlternatives } from '@/application/routing/route-alternative-modes';
import { createBaseRequest } from '@/domain/routing/scenarios';
import { SyntheticTravelCostProvider } from '@/infrastructure/routing/providers/synthetic-travel-cost-provider';
import {
  MAX_MATRIX_CALLS_PER_PLAN,
  PlanningRunTravelCostProvider,
  collapseDuplicates,
  type PlanningRunStats,
} from '@/infrastructure/routing/providers/planning-run-travel-cost-provider';
import { planMatrixRequests } from '@/domain/routing/matrix-limits';
import type { MatrixRequest, TravelCostProvider } from '@/domain/routing/models';

/** Counts what the provider underneath would actually be billed for. */
function countingProvider() {
  const inner = new SyntheticTravelCostProvider('linear');
  const calls: MatrixRequest[] = [];
  const provider: TravelCostProvider = {
    name: 'counting',
    async getMatrix(request) {
      calls.push(request);
      return inner.getMatrix(request);
    },
  };
  return { provider, calls };
}

describe('A · matrica visada Essentials', () => {
  const adapter = readFileSync(resolve(__dirname, '../../gateway/providers/google-matrix-adapter.ts'), 'utf8');

  it('siunčia TRAFFIC_UNAWARE ir niekada TRAFFIC_AWARE', () => {
    expect(adapter).toContain("routingPreference: 'TRAFFIC_UNAWARE'");
    expect(adapter).not.toContain("'TRAFFIC_AWARE'");
    expect(adapter).not.toContain('TRAFFIC_AWARE_OPTIMAL');
  });

  it('nesiunčia departureTime, kuris vėl įtrauktų eismą', () => {
    // Su dvitaškiu, kad pagautų tik tikrą užklausos lauką, o ne komentarą apie jį.
    expect(adapter).not.toContain('departureTime:');
  });

  it('neturi Pro SKU keliančių waypoint modifikatorių', () => {
    for (const trigger of ['sideOfRoad', 'vehicleStopover', 'heading']) {
      expect(adapter).not.toContain(trigger);
    }
  });
});

describe('B · viena matrica vienam planavimui', () => {
  it('abu variklio paleidimai dalijasi ta pačia matrica', async () => {
    const { provider, calls } = countingProvider();
    const planning = new PlanningRunTravelCostProvider(provider, 'plan-test', () => {});
    const request = createBaseRequest(8);

    // buildRouteAlternatives paleidžia variklį du kartus lygiagrečiai.
    const result = await buildRouteAlternatives(new RoutingEngine(planning), request);

    expect(calls).toHaveLength(1);
    expect(planning.getStats().matrixCalls).toBe(MAX_MATRIX_CALLS_PER_PLAN);
    expect(result.labeled.length).toBeGreaterThan(0);
  });

  it('lygiagretūs kvietimai nesukuria antros užklausos', async () => {
    const { provider, calls } = countingProvider();
    const planning = new PlanningRunTravelCostProvider(provider, 'plan-race', () => {});
    const request = createBaseRequest(6);
    const matrixRequest: MatrixRequest = {
      locations: [request.startLocation, ...request.stops.map((stop) => stop.location), request.endLocation],
      vehicle: request.vehicle,
      departureAt: request.plannedDepartureAt,
      trafficMode: 'none',
      timeoutMs: 5_000,
    };

    const [first, second, third] = await Promise.all([
      planning.getMatrix(matrixRequest),
      planning.getMatrix(matrixRequest),
      planning.getMatrix(matrixRequest),
    ]);

    expect(calls).toHaveLength(1);
    expect(first.nodeIds).toEqual(second.nodeIds);
    expect(second.nodeIds).toEqual(third.nodeIds);
  });

  it('visi variantai lieka pilnaverčiai maršrutai', async () => {
    const { provider } = countingProvider();
    const planning = new PlanningRunTravelCostProvider(provider, 'plan-valid', () => {});
    const request = createBaseRequest(10);
    const result = await buildRouteAlternatives(new RoutingEngine(planning), request);

    for (const item of result.labeled) {
      expect(item.candidate.stopSequence).toHaveLength(request.stops.length);
      expect(new Set(item.candidate.stopSequence).size).toBe(request.stops.length);
      expect(item.candidate.totalDistanceKm).toBeGreaterThan(0);
    }
  });
});

describe('C · dubliuoti adresai mažina matricą', () => {
  it('tas pats fizinis taškas į Google keliauja vieną kartą', async () => {
    const { provider, calls } = countingProvider();
    const planning = new PlanningRunTravelCostProvider(provider, 'plan-dupes', () => {});
    const base = createBaseRequest(6);
    // Šeši užsakymai, bet trys adresai: 1=2, 3=4, 5=6.
    const stops = base.stops.map((stop, index) => ({
      ...stop,
      location: {
        ...base.stops[Math.floor(index / 2) * 2]!.location,
        id: stop.id,
      },
    }));
    const locations = [base.startLocation, ...stops.map((stop) => stop.location), base.endLocation];

    const matrix = await planning.getMatrix({
      locations,
      vehicle: base.vehicle,
      departureAt: base.plannedDepartureAt,
      trafficMode: 'none',
      timeoutMs: 5_000,
    });

    // 8 mazgai (startas + 6 + pabaiga) suspaudžiami iki 5 unikalių vietų.
    expect(locations).toHaveLength(8);
    expect(calls[0]!.locations).toHaveLength(5);
    expect(planning.getStats().billedElements).toBe(25);
    expect(planning.getStats().savedElements).toBe(64 - 25);

    // Bet skambintojas vis tiek gauna visus aštuonis mazgus.
    expect(matrix.nodeIds).toEqual(locations.map((location) => location.id));
    expect(matrix.cells).toHaveLength(8);
    expect(matrix.cells[0]).toHaveLength(8);
    // Du užsakymai tuo pačiu adresu: kelias tarp jų nulinis.
    expect(matrix.cells[1]![2]!.distanceKm).toBe(0);
    expect(matrix.cells[1]![2]!.reachable).toBe(true);
  });

  it('collapseDuplicates palieka po vieną vietą kiekvienoms koordinatėms', () => {
    const at = (id: string, latitude: number, longitude: number) => ({ id, label: id, latitude, longitude });
    const collapsed = collapseDuplicates([
      at('a', 54.68, 25.28),
      at('b', 54.68, 25.28),
      at('c', 54.70, 25.30),
    ]);
    expect(collapsed.locations).toHaveLength(2);
    expect(collapsed.representativeById.get('b')).toBe('a');
    expect(collapsed.representativeById.get('c')).toBe('c');
  });
});

describe('D · kietos sąnaudų apsaugos', () => {
  it('antras skirtingų taškų rinkinys nebeperka naujos matricos', async () => {
    const { provider, calls } = countingProvider();
    const planning = new PlanningRunTravelCostProvider(provider, 'plan-guard', () => {});
    const base = createBaseRequest(4);
    const request: MatrixRequest = {
      locations: [base.startLocation, ...base.stops.map((stop) => stop.location), base.endLocation],
      vehicle: base.vehicle,
      departureAt: base.plannedDepartureAt,
      trafficMode: 'none',
      timeoutMs: 5_000,
    };
    await planning.getMatrix(request);
    await planning.getMatrix({
      ...request,
      locations: [...request.locations, { id: 'extra', label: 'Papildomas', latitude: 55.1, longitude: 24.9 }],
    });

    expect(calls).toHaveLength(1);
    expect(planning.getStats().blockedCalls).toBe(1);
  });

  it('rašo sąnaudų telemetriją be adresų', async () => {
    const { provider } = countingProvider();
    const seen: Record<string, unknown>[] = [];
    const planning = new PlanningRunTravelCostProvider(provider, 'plan-log', (stats) => seen.push({ ...stats }));
    const base = createBaseRequest(3);
    await planning.getMatrix({
      locations: [base.startLocation, ...base.stops.map((stop) => stop.location), base.endLocation],
      vehicle: base.vehicle,
      departureAt: base.plannedDepartureAt,
      trafficMode: 'none',
      timeoutMs: 5_000,
    });

    // Du įrašai: vienas prieš perkant (kad kaina būtų žinoma iš anksto),
    // vienas po to su rezultatu.
    expect(seen).toHaveLength(2);
    for (const entry of seen) {
      expect(entry).toMatchObject({
        planningRunId: 'plan-log',
        matrixCalls: 1,
        uniqueLocations: 5,
        billedElements: 25,
        httpRequests: 1,
      });
      expect(JSON.stringify(entry)).not.toMatch(/latitude|longitude|address|apiKey/i);
    }
  });

  it('nepavykusi užklausa neužrakina planavimo amžinai', async () => {
    let attempts = 0;
    const inner = new SyntheticTravelCostProvider('linear');
    const flaky: TravelCostProvider = {
      name: 'flaky',
      async getMatrix(request) {
        attempts += 1;
        if (attempts === 1) throw new Error('tinklo klaida');
        return inner.getMatrix(request);
      },
    };
    const planning = new PlanningRunTravelCostProvider(flaky, 'plan-retry', () => {});
    const base = createBaseRequest(3);
    const request: MatrixRequest = {
      locations: [base.startLocation, ...base.stops.map((stop) => stop.location), base.endLocation],
      vehicle: base.vehicle,
      departureAt: base.plannedDepartureAt,
      trafficMode: 'none',
      timeoutMs: 5_000,
    };

    await expect(planning.getMatrix(request)).rejects.toThrow('tinklo klaida');
    await expect(planning.getMatrix(request)).resolves.toBeDefined();
    expect(attempts).toBe(2);
  });
});

describe('D2 · realios HTTP užklausos, ne tik loginis kvietimas', () => {
  const matrixRequestFor = (base: ReturnType<typeof createBaseRequest>): MatrixRequest => ({
    locations: [base.startLocation, ...base.stops.map((stop) => stop.location), base.endLocation],
    vehicle: base.vehicle,
    departureAt: base.plannedDepartureAt,
    trafficMode: 'none',
    timeoutMs: 5_000,
  });

  it('praneša, kiek tikrų Google užklausų kainuos planavimas', async () => {
    const { provider } = countingProvider();
    const seen: PlanningRunStats[] = [];
    const planning = new PlanningRunTravelCostProvider(provider, 'plan-http', (stats) => seen.push({ ...stats }));
    // 23 taškai + startas + pabaiga = 25 mazgai = 625 elementai = riba tiksliai.
    await planning.getMatrix(matrixRequestFor(createBaseRequest(23)));

    expect(planning.getStats().uniqueLocations).toBe(25);
    expect(planning.getStats().billedElements).toBe(625);
    expect(planning.getStats().httpRequests).toBe(1);
    // Kaina žinoma DAR PRIEŠ užklausą.
    expect(seen[0]!.httpRequests).toBe(1);
  });

  it('24 ir 25 taškai atvirai pažymimi kaip keturios užklausos', async () => {
    for (const [stops, expectedRequests, expectedElements] of [[24, 4, 676], [25, 4, 729]] as const) {
      const { provider } = countingProvider();
      const planning = new PlanningRunTravelCostProvider(provider, `plan-${stops}`, () => {});
      await planning.getMatrix(matrixRequestFor(createBaseRequest(stops)));

      expect(planning.getStats().httpRequests).toBe(expectedRequests);
      expect(planning.getStats().billedElements).toBe(expectedElements);
      expect(planMatrixRequests(planning.getStats().uniqueLocations).singleRequest).toBe(false);
    }
  });

  it('26 taškai atmetami nepirkus nė vienos matricos', async () => {
    const { provider, calls } = countingProvider();
    const planning = new PlanningRunTravelCostProvider(provider, 'plan-toobig', () => {});
    // 26 taškai + startas + pabaiga = 28 mazgai = 784 elementai > 729.
    await expect(planning.getMatrix(matrixRequestFor(createBaseRequest(26))))
      .rejects.toThrow(/leidžiama 729/i);
    expect(calls).toHaveLength(0);
    expect(planning.getStats().matrixCalls).toBe(0);
  });

  it('25 taškai – pilnas įprastas maršrutas – vis dar praleidžiami', async () => {
    const { provider, calls } = countingProvider();
    const planning = new PlanningRunTravelCostProvider(provider, 'plan-max', () => {});
    await planning.getMatrix(matrixRequestFor(createBaseRequest(25)));

    expect(calls).toHaveLength(1);
    expect(planning.getStats().uniqueLocations).toBe(27);
    expect(planning.getStats().billedElements).toBe(729);
  });

  it('dubliuoti adresai gali sugrąžinti maršrutą į vieną užklausą', async () => {
    const { provider, calls } = countingProvider();
    const planning = new PlanningRunTravelCostProvider(provider, 'plan-collapse', () => {});
    const base = createBaseRequest(30);
    // 30 užsakymų, bet tik 15 adresų: 32 mazgai suspaudžiami iki 17.
    const stops = base.stops.map((stop, index) => ({
      ...stop,
      location: { ...base.stops[Math.floor(index / 2) * 2]!.location, id: stop.id },
    }));
    await planning.getMatrix({
      ...matrixRequestFor(base),
      locations: [base.startLocation, ...stops.map((stop) => stop.location), base.endLocation],
    });

    expect(planning.getStats().uniqueLocations).toBe(17);
    expect(planning.getStats().httpRequests).toBe(1);
    expect(planning.getStats().billedElements).toBe(289);
    expect(calls[0]!.locations).toHaveLength(17);
  });
});

describe('E · eismas tik galutiniam maršrutui', () => {
  it('planavimo ekranas naudoja vienos eigos tiekėją', () => {
    const screen = readFileSync(resolve(__dirname, '../../src/app/route/[id]/alternatives.tsx'), 'utf8');
    expect(screen).toContain('createPlanningTravelProvider');
    const recalculation = readFileSync(resolve(__dirname, '../../src/application/routes/route-recalculation.ts'), 'utf8');
    expect(recalculation).toContain('createPlanningTravelProvider');
    const factory = readFileSync(resolve(__dirname, '../../src/application/routing/planning-travel-provider.ts'), 'utf8');
    expect(factory).toContain('PlanningRunTravelCostProvider');
  });

  it('polyline tiekėjas eismą vis dar naudoja - tik pasirinktam maršrutui', () => {
    const routes = readFileSync(resolve(__dirname, '../../gateway/providers/google-routes-adapter.ts'), 'utf8');
    expect(routes).toContain('TRAFFIC_AWARE');
    expect(routes).toContain('computeRoutes');
  });
});

describe('F · esami algoritmai vis dar duoda tvarkingą maršrutą', () => {
  it('vienas variklio paleidimas grąžina pilną seką', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { provider, calls } = countingProvider();
      const planning = new PlanningRunTravelCostProvider(provider, 'plan-engine');
      const request = createBaseRequest(9);
      const result = await new RoutingEngine(planning).optimize(request);

      expect(calls).toHaveLength(1);
      expect(result.recommended).not.toBeNull();
      expect(result.recommended!.stopSequence).toHaveLength(9);
      expect(result.recommended!.totalDistanceKm).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  });
});
