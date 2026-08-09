/**
 * Side-by-side diagnostic for the two planning modes.
 *
 * Builds one set of stops, runs it through the real production request builder
 * and routing engine twice - once honouring delivery windows and once ignoring
 * them - and prints where the two answers diverge. Run with:
 *
 *   npm run diagnose:planning-modes
 */
import { RoutingEngine } from '../src/application/routing/routing-engine';
import { buildOptimizationRequestFromRoute } from '../src/application/routes/route-request-builder';
import { evaluateCandidate } from '../src/domain/routing/evaluation/candidate-evaluator';
import { cappedObjective } from '../src/domain/routing/scoring/scoring';
import type { RouteCandidate, RouteOptimizationRequest } from '../src/domain/routing/models';
import type { DeliveryStop, Route } from '../src/domain/route';
import { serviceMinutesForWeight } from '../src/domain/service-time';
import { SyntheticTravelCostProvider } from '../src/infrastructure/routing/providers/synthetic-travel-cost-provider';

/** A town-sized job: a depot plus stops spread over three districts. */
const DEPOT = { lat: 55.9333, lon: 23.3167, label: 'Bazė' };

type SeedStop = {
  name: string;
  lat: number;
  lon: number;
  weightKg: number;
  from: string | null;
  to: string | null;
};

const NORTH = { lat: 55.975, lon: 23.345 };
const SOUTH_WEST = { lat: 55.885, lon: 23.225 };
const EAST = { lat: 55.928, lon: 23.42 };

function district(anchor: { lat: number; lon: number }, index: number) {
  return { lat: anchor.lat + index * 0.006, lon: anchor.lon + index * 0.009 };
}

// Windows mirror the reported job: the first stop opens at 06:00 and the rest
// share broad daytime windows, which is where the ordering went wrong.
const SEED_STOPS: SeedStop[] = [
  { name: 'Šiaurė 1', ...district(NORTH, 0), weightKg: 180, from: '06:00', to: '10:00' },
  { name: 'Šiaurė 2', ...district(NORTH, 1), weightKg: 140, from: '08:00', to: '16:00' },
  { name: 'Šiaurė 3', ...district(NORTH, 2), weightKg: 120, from: '08:00', to: '16:00' },
  { name: 'Šiaurė 4', ...district(NORTH, 3), weightKg: 90, from: '10:00', to: '14:00' },
  { name: 'Pietvakariai 1', ...district(SOUTH_WEST, 0), weightKg: 200, from: '08:00', to: '16:00' },
  { name: 'Pietvakariai 2', ...district(SOUTH_WEST, 1), weightKg: 160, from: '08:00', to: '16:00' },
  { name: 'Pietvakariai 3', ...district(SOUTH_WEST, 2), weightKg: 110, from: '09:00', to: '15:00' },
  { name: 'Pietvakariai 4', ...district(SOUTH_WEST, 3), weightKg: 130, from: '08:00', to: '16:00' },
  { name: 'Rytai 1', ...district(EAST, 0), weightKg: 150, from: '08:00', to: '16:00' },
  { name: 'Rytai 2', ...district(EAST, 1), weightKg: 170, from: '11:00', to: '15:00' },
  { name: 'Rytai 3', ...district(EAST, 2), weightKg: 100, from: '08:00', to: '16:00' },
  { name: 'Rytai 4', ...district(EAST, 3), weightKg: 145, from: '08:00', to: '16:00' },
  { name: 'Centras', lat: 55.936, lon: 23.318, weightKg: 88, from: '08:00', to: '16:00' },
];

function districtOf(stop: SeedStop): string {
  if (stop.name.startsWith('Šiaurė')) return 'Š';
  if (stop.name.startsWith('Pietvakariai')) return 'PV';
  if (stop.name.startsWith('Rytai')) return 'R';
  return 'C';
}

function departureIso(): string {
  const day = new Date();
  day.setDate(day.getDate() + 1);
  day.setHours(6, 0, 0, 0);
  return day.toISOString();
}

function buildStops(): DeliveryStop[] {
  const now = new Date().toISOString();
  return SEED_STOPS.map((seed, index) => ({
    id: `stop-${index + 1}`,
    sourceStopId: null,
    routeId: 'diagnostic-route',
    originalOrder: index + 1,
    optimizedOrder: null,
    activeOrder: null,
    orderNumber: `${index + 1}`,
    recipient: seed.name,
    address: seed.name,
    originalAddress: seed.name,
    geocodingQuery: null,
    normalizedAddress: seed.name,
    addressValidationState: 'auto_confirmed',
    geocodingError: null,
    latitude: seed.lat,
    longitude: seed.lon,
    deliveryTimeFrom: seed.from,
    deliveryTimeTo: seed.to,
    requiredTimeWindow: Boolean(seed.from && seed.to),
    serviceDurationMinutes: serviceMinutesForWeight(seed.weightKg),
    plannedArrivalAt: null,
    plannedDepartureAt: null,
    latestEstimatedArrivalAt: null,
    legDistanceKm: null,
    legDurationMinutes: null,
    etaUpdatedAt: null,
    etaApproximate: false,
    weightKg: seed.weightKg,
    priorityFirst: false,
    phone: null,
    notes: null,
    loadingStatus: 'pending',
    deliveryStatus: 'pending',
    failureReason: null,
    failureComment: null,
    loadedAt: null,
    deliveredAt: null,
    failedAt: null,
    createdAt: now,
    updatedAt: now,
  })) as DeliveryStop[];
}

function buildRoute(planningMode: Route['planningMode']): Route {
  const now = new Date().toISOString();
  const endpoint = {
    originalAddress: DEPOT.label,
    geocodingQuery: null,
    normalizedAddress: DEPOT.label,
    latitude: DEPOT.lat,
    longitude: DEPOT.lon,
  };
  return {
    id: 'diagnostic-route',
    vehicleId: null,
    date: new Date().toISOString().slice(0, 10),
    status: 'draft',
    planningMode,
    estimatedDistanceKm: null,
    actualDistanceKm: null,
    totalWeightKg: SEED_STOPS.reduce((sum, stop) => sum + stop.weightKg, 0),
    remainingWeightKg: 0,
    totalStops: SEED_STOPS.length,
    remainingStops: SEED_STOPS.length,
    startOdometer: null,
    endOdometer: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    startLocation: endpoint,
    endLocation: endpoint,
    plannedDepartureAt: departureIso(),
    selectedRunId: null,
    selectedCandidateId: null,
    estimatedDurationMinutes: null,
    sourceImportAuditId: null,
    unknownWeightStops: 0,
    remainingUnknownWeightStops: 0,
    cancelledAt: null,
    startOdometerRecordedAt: null,
    startOdometerSkippedAt: null,
    endOdometerRecordedAt: null,
    activeSequenceSnapshotAt: null,
    completionStartedAt: null,
    completionEndOdometerDraft: null,
    completionSummary: null,
  } as Route;
}

const clock = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
const nameOf = (id: string) => SEED_STOPS[Number(id.split('-')[1]) - 1]!.name;
const tagOf = (id: string) => districtOf(SEED_STOPS[Number(id.split('-')[1]) - 1]!);

function districtHops(sequence: string[]): number {
  return sequence.reduce(
    (count, id, index) => (index > 0 && tagOf(id) !== tagOf(sequence[index - 1]!) ? count + 1 : count),
    0,
  );
}

function printRoute(title: string, request: RouteOptimizationRequest, candidate: RouteCandidate) {
  console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);
  console.log(`Startas ${clock(request.plannedDepartureAt)} · laimėjo euristika: ${candidate.generatedBy.join(', ')}`);
  console.log('');
  console.log('  #  rajonas  taškas             langas       atvyko  laukė  vėlavo');
  console.log('  ' + '-'.repeat(70));
  candidate.schedules.forEach((schedule, index) => {
    const seed = SEED_STOPS[Number(schedule.stopId.split('-')[1]) - 1]!;
    const window = seed.from ? `${seed.from}-${seed.to}` : '—';
    console.log(
      `  ${String(index + 1).padStart(2)}  ${tagOf(schedule.stopId).padEnd(7)}  ${nameOf(schedule.stopId).padEnd(17)}  ${window.padEnd(11)}  ${clock(schedule.arrivalAt)}   ${String(Math.round(schedule.waitingMinutes)).padStart(4)}   ${String(Math.round(schedule.lateMinutes)).padStart(5)}`,
    );
  });
  console.log('');
  console.log(`  Atstumas ................ ${candidate.totalDistanceKm.toFixed(1)} km`);
  console.log(`  Vairavimas .............. ${Math.round(candidate.drivingMinutes)} min`);
  console.log(`  Laukimas ................ ${Math.round(candidate.waitingMinutes)} min`);
  console.log(`  Viso darbo .............. ${Math.round(candidate.totalWorkMinutes)} min`);
  console.log(`  Vėlavimas ............... ${Math.round(candidate.totalLateMinutes)} min`);
  console.log(`  Kryptingumo bauda ....... ${candidate.directionalityPenalty.toFixed(1)}`);
  console.log(`  Info lango neatitikimas . ${Math.round(candidate.rawScoreComponents.informationalTimeMismatch)} min`);
  console.log(`  Šuoliai tarp rajonų ..... ${districtHops(candidate.stopSequence)}`);
  console.log(`  Bendras balas ........... ${candidate.totalScore?.toFixed(4) ?? '—'}`);
}

async function planWith(planningMode: Route['planningMode']) {
  const request = buildOptimizationRequestFromRoute(buildRoute(planningMode), buildStops());
  const result = await new RoutingEngine(new SyntheticTravelCostProvider('city_traffic')).optimize(request);
  return { request, result };
}

async function main() {
  const timed = await planWith('with_time_windows');
  const plain = await planWith('ignore_time_windows');
  const withWindows = timed.result.recommended!;
  const withoutWindows = plain.result.recommended!;

  printRoute('ATSIŽVELGIANT Į LAIKO LANGUS', timed.request, withWindows);
  printRoute('NEATSIŽVELGIANT Į LAIKO LANGUS', plain.request, withoutWindows);

  console.log(`\n${'='.repeat(78)}\nSKIRTUMAS\n${'='.repeat(78)}`);
  console.log(`  Su langais:  ${withWindows.stopSequence.map(tagOf).join(' → ')}`);
  console.log(`  Be langų:    ${withoutWindows.stopSequence.map(tagOf).join(' → ')}`);
  console.log('');
  const deltaKm = withWindows.totalDistanceKm - withoutWindows.totalDistanceKm;
  console.log(`  Atstumo skirtumas ....... ${deltaKm >= 0 ? '+' : ''}${deltaKm.toFixed(1)} km`);
  console.log(`  Šuolių skirtumas ........ ${districtHops(withWindows.stopSequence)} vs ${districtHops(withoutWindows.stopSequence)}`);
  console.log(`  Laukimo skirtumas ....... ${Math.round(withWindows.waitingMinutes - withoutWindows.waitingMinutes)} min`);

  // Score the geographically sane order under time-window rules to see whether
  // the engine rejected it or simply never generated it.
  const generated = timed.result.candidates.some(
    (candidate) => candidate.stopSequence.join('|') === withoutWindows.stopSequence.join('|'),
  );
  const matrix = await new SyntheticTravelCostProvider('city_traffic').getMatrix({
    locations: [
      timed.request.startLocation,
      ...timed.request.stops.map((stop) => stop.location),
      timed.request.endLocation,
    ],
    vehicle: timed.request.vehicle,
    departureAt: timed.request.plannedDepartureAt,
    trafficMode: timed.request.trafficMode,
    timeoutMs: 5_000,
  });
  const forced = evaluateCandidate({
    stopSequence: withoutWindows.stopSequence,
    generatedBy: ['cross_check'],
    request: timed.request,
    matrix,
  });
  const winnerObjective = cappedObjective(withWindows.rawScoreComponents, timed.request.scoring);
  const forcedObjective = cappedObjective(forced.rawScoreComponents, timed.request.scoring);
  console.log('');
  console.log(`  Geografiškai tvarkingas maršrutas ${generated ? 'buvo' : 'NEBUVO'} tarp kandidatų.`);
  console.log('  Jį įvertinus pagal laiko langų taisykles:');
  console.log(`    tikslo funkcija ${forcedObjective.toFixed(4)} vs laimėtojo ${winnerObjective.toFixed(4)}`);
  console.log(`    atstumas ${forced.totalDistanceKm.toFixed(1)} km, laukimas ${Math.round(forced.waitingMinutes)} min, vėlavimas ${Math.round(forced.totalLateMinutes)} min`);
  console.log(
    forcedObjective < winnerObjective
      ? '    IŠVADA: geresnis maršrutas egzistuoja, bet paieška jo nerado (generavimo spraga).'
      : '    IŠVADA: laimėtojas tikrai geresnis pagal dabartinius svorius (vertinimo klausimas).',
  );

  console.log('\n  Balo dedamosios (žalias = kur laimėtojas prastesnis):');
  const keys = Object.keys(withWindows.rawScoreComponents) as (keyof typeof withWindows.rawScoreComponents)[];
  for (const key of keys) {
    const timedValue = withWindows.rawScoreComponents[key];
    const plainValue = withoutWindows.rawScoreComponents[key];
    const delta = timedValue - plainValue;
    if (Math.abs(delta) < 0.01) continue;
    console.log(
      `    ${key.padEnd(26)} su langais ${timedValue.toFixed(1).padStart(9)}   be langų ${plainValue.toFixed(1).padStart(9)}   Δ ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`,
    );
  }
  console.log('');
}

void main();
