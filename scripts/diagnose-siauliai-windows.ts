/**
 * Diagnostic for the real Šiauliai morning-window job the driver reported.
 * Run: npx tsx ./scripts/diagnose-siauliai-windows.ts
 */
import { RoutingEngine } from '../src/application/routing/routing-engine';
import { buildOptimizationRequestFromRoute } from '../src/application/routes/route-request-builder';
import type { DeliveryStop, Route } from '../src/domain/route';
import { serviceMinutesForWeight } from '../src/domain/service-time';
import { SyntheticTravelCostProvider } from '../src/infrastructure/routing/providers/synthetic-travel-cost-provider';

const DEPOT = { lat: 55.9333, lon: 23.3167, label: 'Šiaulių bazė' };

// Approximate street coords around Šiauliai + Panevėžys end stop.
const STOPS = [
  { name: 'Pakruojo 51', lat: 55.962, lon: 23.318, kg: 155.618, from: '06:00', to: '15:00' },
  { name: 'Greimo 60', lat: 55.945, lon: 23.355, kg: 90.37, from: '06:00', to: '09:00' },
  { name: 'Ežero 6A', lat: 55.938, lon: 23.325, kg: 10.8, from: '06:00', to: '08:00' },
  { name: 'Stoties 9C', lat: 55.928, lon: 23.315, kg: 27, from: '07:00', to: '08:00' },
  { name: 'Kudirkos 99', lat: 55.935, lon: 23.305, kg: 12, from: '06:00', to: '09:00' },
  { name: 'Kudirkos 22', lat: 55.933, lon: 23.312, kg: 28.1, from: '06:00', to: '10:00' },
  { name: 'Vilniaus 125', lat: 55.925, lon: 23.328, kg: 118.27, from: '07:00', to: '09:00' },
  { name: 'Vilniaus 297', lat: 55.918, lon: 23.340, kg: 21.6, from: '06:00', to: '10:00' },
  { name: 'Vilniaus 385', lat: 55.912, lon: 23.348, kg: 78.71, from: '06:00', to: '09:00' },
  { name: 'Lakūnų 3', lat: 55.905, lon: 23.365, kg: 11.996, from: '06:00', to: '15:00' },
  { name: 'Dainų 28', lat: 55.908, lon: 23.295, kg: 31.95, from: '07:00', to: '08:00' },
  { name: 'Dainų 11', lat: 55.910, lon: 23.292, kg: 112.09, from: '06:00', to: '10:00' },
  { name: 'Lieporių 4', lat: 55.915, lon: 23.280, kg: 66.52, from: '06:00', to: '10:00' },
  { name: 'Radviliškio 86', lat: 55.900, lon: 23.330, kg: 15.175, from: '07:00', to: '09:00' },
  { name: 'Saulės takas 7', lat: 55.888, lon: 23.270, kg: 51.3, from: '06:00', to: '09:00' },
  { name: 'Puzino 12 PN', lat: 55.733, lon: 24.350, kg: 951.386, from: '08:00', to: '16:00' },
] as const;

function departureAt(hour: number, minute = 0): string {
  const day = new Date();
  day.setDate(day.getDate() + 1);
  day.setHours(hour, minute, 0, 0);
  return day.toISOString();
}

function build(hour: number) {
  const now = new Date().toISOString();
  const endpoint = {
    originalAddress: DEPOT.label,
    geocodingQuery: null,
    normalizedAddress: DEPOT.label,
    latitude: DEPOT.lat,
    longitude: DEPOT.lon,
  };
  const route = {
    id: 'siauliai-job',
    vehicleId: null,
    date: new Date().toISOString().slice(0, 10),
    status: 'draft',
    planningMode: 'with_time_windows',
    estimatedDistanceKm: null,
    actualDistanceKm: null,
    totalWeightKg: STOPS.reduce((s, x) => s + x.kg, 0),
    remainingWeightKg: 0,
    totalStops: STOPS.length,
    remainingStops: STOPS.length,
    startOdometer: null,
    endOdometer: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    startLocation: endpoint,
    endLocation: endpoint,
    plannedDepartureAt: departureAt(hour),
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

  const stops = STOPS.map((seed, index) => ({
    id: `stop-${index + 1}`,
    sourceStopId: null,
    routeId: 'siauliai-job',
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
    requiredTimeWindow: true,
    serviceDurationMinutes: serviceMinutesForWeight(seed.kg),
    plannedArrivalAt: null,
    plannedDepartureAt: null,
    latestEstimatedArrivalAt: null,
    legDistanceKm: null,
    legDurationMinutes: null,
    etaUpdatedAt: null,
    etaApproximate: false,
    weightKg: seed.kg,
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

  return buildOptimizationRequestFromRoute(route, stops);
}

const clock = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
const nameOf = (id: string) => STOPS[Number(id.split('-')[1]) - 1]!.name;
const windowOf = (id: string) => {
  const s = STOPS[Number(id.split('-')[1]) - 1]!;
  return `${s.from}-${s.to}`;
};

async function run(label: string, hour: number) {
  const request = build(hour);
  const result = await new RoutingEngine(new SyntheticTravelCostProvider('city_traffic')).optimize(request);
  const c = result.recommended!;
  console.log(`\n=== ${label} (įvestas startas ${hour.toString().padStart(2, '0')}:00) ===`);
  console.log(`Efektyvus išvykimas ${clock(c.legs[0]!.departureAt)} · atstumas ${c.totalDistanceKm.toFixed(1)} km · laukimas ${Math.round(c.waitingMinutes)} min · vėlavimas ${Math.round(c.totalLateMinutes)} min`);
  c.schedules.forEach((s, i) => {
    const late = s.lateMinutes > 0 ? ` LATE+${Math.round(s.lateMinutes)}` : '';
    const wait = s.waitingMinutes > 0 ? ` wait ${Math.round(s.waitingMinutes)}` : '';
    console.log(`  ${String(i + 1).padStart(2)}. ${clock(s.serviceStartAt)}  ${windowOf(s.stopId).padEnd(11)}  ${nameOf(s.stopId)}${wait}${late}`);
  });
  const panevezysIndex = c.stopSequence.findIndex((id) => nameOf(id).includes('PN'));
  const earlyCloseLate = c.schedules.filter((s) => {
    const w = windowOf(s.stopId);
    return (w.endsWith('08:00') || w.endsWith('09:00')) && s.lateMinutes > 0;
  });
  console.log(`  Panevėžys pozicija: ${panevezysIndex + 1}/${c.stopSequence.length}`);
  console.log(`  Vėluojantys ankstyvi langai: ${earlyCloseLate.length}`);
}

async function main() {
  await run('Ankstyvas startas kaip 04:00', 4);
  await run('Startas 05:30', 5);
  await run('Startas 06:00', 6);
}

void main();
