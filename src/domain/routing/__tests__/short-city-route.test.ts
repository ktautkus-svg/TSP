import { expect, it } from 'vitest';
import { RoutingEngine } from '@/application/routing/routing-engine';
import { createBaseRequest } from '../scenarios';
import type { MatrixCell, RouteOptimizationRequest, RoutingLocation, TravelMatrix } from '../models';
import { haversineKm } from '../evaluation/geo';
import { requestForObjective } from '@/application/routing/route-alternative-modes';

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }
function loc(id: string, lat: number, lng: number): RoutingLocation { return { id, label: id, latitude: lat, longitude: lng }; }

function build(seed: number, n: number, windows: boolean): { req: RouteOptimizationRequest; matrix: TravelMatrix } {
  const r = rng(seed);
  const req = createBaseRequest(1);
  const start = loc('start', 54.6382, 25.1742);
  const end = loc('end', 54.6383, 25.1743);
  const base = req.stops[0];
  req.stops = Array.from({ length: n }, (_, i) => ({ ...base, id: `p${i}`, location: loc(`p${i}`, 55.90 + r() * 0.06, 23.25 + r() * 0.12), requiredTimeWindow: undefined, informationalTimeWindow: undefined, preferEarly: false, preferLate: false, priority: 1, weightKg: 50 }));
  if (windows) req.stops.forEach((s, i) => { if (i % 3 === 0) s.requiredTimeWindow = { from: '2026-06-15T05:00:00.000Z', to: '2026-06-15T13:00:00.000Z' }; });
  req.planningMode = windows ? 'with_time_windows' : 'ignore_time_windows';
  req.startLocation = start; req.endLocation = end; req.vehicle.startLocation = start; req.vehicle.defaultEndLocation = end;
  const perSeed = Math.min(2500, Math.max(1200, n * 150));
  req.maxIterations = Math.min(15, Math.max(6, Math.round(n * 0.5)));
  req.maxCalculationMs = perSeed; req.maxTotalCalculationMs = Math.max(perSeed, Math.min(4000, n * 120));
  req.randomSeeds = [7, 42, 2026, 101, 512];
  const nodes = [start, ...req.stops.map((s) => s.location), end];
  const cells = nodes.map((a) => nodes.map((b): MatrixCell => { const d = haversineKm(a, b) * 1.3; return { distanceKm: d, durationMinutes: d / (d > 30 ? 75 : 35) * 60, reachable: true, maneuverPenalty: 0, restrictionWarnings: [] }; }));
  return { req, matrix: { provider: 't', executionMode: 'synthetic', nodeIds: nodes.map((x) => x.id), cells, fetchedAt: '', trafficMode: 'none', departureAt: req.plannedDepartureAt, warnings: [], version: 't' } as TravelMatrix };
}

// Simple reference: best of nearest-neighbour + exhaustive 2-opt/or-opt on distance only
function reference(matrix: TravelMatrix): number {
  const n = matrix.nodeIds.length; const d = (a: number, b: number) => matrix.cells[a][b].distanceKm!;
  let seq = Array.from({ length: n - 2 }, (_, i) => i + 1);
  const cost = (s: number[]) => { let c = d(0, s[0]); for (let i = 1; i < s.length; i++) c += d(s[i - 1], s[i]); return c + d(s.at(-1)!, n - 1); };
  let best = cost(seq), imp = true;
  while (imp) { imp = false;
    for (let i = 0; i < seq.length; i++) for (let j = i + 1; j < seq.length; j++) { const t = [...seq.slice(0, i), ...seq.slice(i, j + 1).reverse(), ...seq.slice(j + 1)]; const c = cost(t); if (c < best - 1e-9) { best = c; seq = t; imp = true; } }
    for (let L = 1; L <= 3; L++) for (let i = 0; i + L <= seq.length; i++) for (let k = 0; k <= seq.length - L; k++) { if (k === i) continue; const seg = seq.slice(i, i + L); const rest = [...seq.slice(0, i), ...seq.slice(i + L)]; const t = [...rest.slice(0, k), ...seg, ...rest.slice(k)]; const c = cost(t); if (c < best - 1e-9) { best = c; seq = t; imp = true; } }
  }
  return best;
}

// Regression: on a phone the "trumpiausias" variant gets only a few hundred
// milliseconds, and before distance polishing it came back looping around the
// city (+60–150 % in-city km). With a deliberately tiny budget the engine must
// stay within a few percent of a plain 2-opt/Or-opt distance reference.
it('keeps city routes untangled even with a tiny time budget', async () => {
  for (const n of [20, 28]) {
    for (const seed of [1, 2, 3]) {
      const { req, matrix } = build(seed * 97 + n, n, false);
      const rq = requestForObjective({ ...req, maxCalculationMs: 50, maxTotalCalculationMs: 50 }, 'shortest');
      const res = await new RoutingEngine({ getMatrix: async () => matrix } as never).optimize(rq, matrix);
      const c = res.recommended ?? res.candidates[0];
      expect(c.totalDistanceKm).toBeLessThan(reference(matrix) * 1.03);
    }
  }
}, 120000);
