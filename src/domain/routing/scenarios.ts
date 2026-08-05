import { DEFAULT_ROUTING_SCORING } from './defaults';
import type {
  OptimizationStop,
  RouteOptimizationRequest,
  RoutingLocation,
} from './models';

export type RoutingScenario = {
  id: string;
  description: string;
  category: 'constraint' | 'objective' | 'recalculation' | 'accounting' | 'vilnius';
  request: RouteOptimizationRequest;
  expectedDirectionComment?: string;
};

const warehouse = location('warehouse', 'Sandėlis, Kirtimų g.', 54.6382, 25.1742);
const home = location('home', 'Namai, Fabijoniškės', 54.7338, 25.2394);

const vilniusPoints = [
  location('s1', 'Naujamiestis', 54.6754, 25.2632),
  location('s2', 'Antakalnis', 54.7026, 25.3193),
  location('s3', 'Pilaitė', 54.6998, 25.1834),
  location('s4', 'Naujoji Vilnia', 54.6928, 25.4142),
  location('s5', 'Lazdynai', 54.6758, 25.2062),
  location('s6', 'Žirmūnai', 54.7192, 25.3037),
  location('s7', 'Paneriai', 54.6161, 25.1725),
  location('s8', 'Balsiai', 54.787, 25.356),
  location('s9', 'Grigiškės', 54.6704, 25.0914),
  location('s10', 'Oro uostas', 54.6357, 25.2858),
  location('s11', 'Šnipiškės', 54.7007, 25.2794),
  location('s12', 'Pašilaičiai', 54.7278, 25.219),
  location('s13', 'Markučiai', 54.6741, 25.3226),
  location('s14', 'Verkiai', 54.7521, 25.2948),
  location('s15', 'Valakampiai', 54.7311, 25.3374),
];

export const routingScenarios: RoutingScenario[] = [
  scenario('basic-two-stops', 'Du baziniai pristatymo taškai.', mutateStops(2)),
  scenario('six-close-stops', 'Šeši geografiškai artimi taškai.', mutateStops(6, (stops) => {
    stops.forEach((stop, index) => {
      stop.location.latitude = 54.6872 + index * 0.001;
      stop.location.longitude = 25.2797 + index * 0.001;
    });
  })),
  scenario('equal-distance-stops', 'Keli taškai vienodu atstumu nuo starto.', mutateStops(4, (stops) => {
    const offsets = [[0.02, 0], [-0.02, 0], [0, 0.02], [0, -0.02]];
    stops.forEach((stop, index) => {
      stop.location.latitude = warehouse.latitude + offsets[index][0];
      stop.location.longitude = warehouse.longitude + offsets[index][1];
    });
  })),
  scenario('different-start-end', 'Pradžios ir pabaigos vietos skiriasi.', undefined, home),
  scenario('heavy-near', 'Sunkiausias krovinys yra arčiausiai sandėlio.', mutateStops(8, (stops) => setWeight(stops, 0, 900))),
  scenario('heavy-far', 'Sunkiausias krovinys yra toliausiai nuo sandėlio.', mutateStops(8, (stops) => setWeight(stops, 7, 900))),
  scenario('heavy-middle', 'Sunkiausias krovinys yra geografinėje maršruto vidurio zonoje.', mutateStops(8, (stops) => setWeight(stops, 3, 900))),
  scenario('equal-heavy-loads', 'Keli kroviniai yra vienodai sunkūs.', mutateStops(8, (stops) => {
    setWeight(stops, 1, 650);
    setWeight(stops, 5, 650);
  })),
  scenario('weight-distance-conflict', 'Svorio prioritetas konfliktuoja su trumpiausia seka.', mutateStops(8, (stops) => {
    setWeight(stops, 7, 1_100);
    stops[7].location.latitude += 0.08;
  })),
  scenario('over-capacity', 'Pradinis krovinys viršija transporto priemonės ribą.', mutateStops(8, (stops) => {
    stops.forEach((stop) => {
      stop.weightKg = 600;
    });
  }), home, 'constraint'),
  scenario('heavy-late-window', 'Sunkiausias krovinys turi vėlyvą laiko langą.', mutateStops(8, (stops) => {
    setWeight(stops, 0, 900);
    stops[0].requiredTimeWindow = windowAt(12, 0, 13, 0);
  })),
  scenario('light-early-required', 'Lengvas krovinys turi ankstyvą privalomą langą.', mutateStops(8, (stops) => {
    setWeight(stops, 6, 10);
    stops[6].requiredTimeWindow = windowAt(7, 45, 8, 30);
  })),
  scenario('two-conflicting-windows', 'Du privalomi laiko langai konfliktuoja.', mutateStops(8, (stops) => {
    stops[0].requiredTimeWindow = windowAt(7, 5, 7, 10);
    stops[7].requiredTimeWindow = windowAt(7, 5, 7, 10);
  }), home, 'constraint'),
  scenario('informational-window', 'Informacinis pristatymo laikas nėra hard apribojimas.', mutateStops(8, (stops) => {
    stops[4].informationalTimeWindow = windowAt(7, 0, 7, 5);
  })),
  scenario('end-home', 'Maršrutas baigiamas prie namų.', undefined, home),
  scenario('end-warehouse', 'Maršrutas baigiamas sandėlyje.', undefined, warehouse),
  scenario('far-first-shorter', 'Tolimiausias pirmas gali sumažinti grįžimą.', reverseLocations(8), home),
  scenario('far-first-longer', 'Tolimiausias pirmas gali pailginti maršrutą.', undefined, warehouse),
  scenario('zigzag-penalty', 'Zigzaginė rytų–vakarų seka turi būti nubausta.', mutateStops(8, (stops) => {
    stops.forEach((stop, index) => {
      stop.location.latitude = 54.69 + index * 0.003;
      stop.location.longitude = index % 2 === 0 ? 25.12 : 25.42;
    });
  })),
  scenario('shorter-but-slower', 'Trumpesnis kelias gali būti lėtesnis dėl eismo.'),
  scenario('longer-avoids-traffic', 'Ilgesnė seka gali išvengti spūsties.'),
  scenario('left-turn-worth-it', 'Manevras vertas didelio laiko sutaupymo.'),
  scenario('left-turn-not-worth-it', 'Mažas sutaupymas neatsveria manevro baudos.'),
  scenario('manual-reorder', 'Naudotojas pakeičia taškų eilę.'),
  scenario('locked-position', 'Vieno taško pozicija užrakinta.', mutateStops(8, (stops) => {
    stops[3].lockedPosition = 4;
  })),
  scenario('deliver-before', 'Vienas taškas privalo būti pristatytas prieš kitą.', mutateStops(8, (stops) => {
    stops[6].deliverBeforeStopIds = [stops[1].id];
  }), home, 'constraint'),
  scenario('deliver-after', 'Vienas taškas privalo būti pristatytas po kito.', mutateStops(8, (stops) => {
    stops[1].deliverAfterStopIds = [stops[6].id];
  }), home, 'constraint'),
  scenario('failed-stop-recalculation', 'Nepavykęs pristatymas inicijuoja likučio perskaičiavimą.', undefined, home, 'recalculation'),
  scenario('added-stop-recalculation', 'Maršruto metu pridedamas naujas taškas.', undefined, home, 'recalculation'),
  scenario('skipped-stop-recalculation', 'Praleidus tašką perskaičiuojamas likutis.', undefined, home, 'recalculation'),
  scenario('delay-recalculation', 'Po didelio vėlavimo perskaičiuojamas likutis.', undefined, home, 'recalculation'),
  scenario('traffic-recalculation', 'Pasikeitus eismui perskaičiuojamas likutis.', undefined, home, 'recalculation'),
  scenario('same-address', 'Keli pristatymai tuo pačiu adresu.', mutateStops(8, (stops) => {
    stops[2].location = { ...stops[1].location, id: stops[2].id };
  })),
  scenario('impossible-window', 'Nurodytas neįmanomas pristatymo intervalas.', mutateStops(8, (stops) => {
    stops[7].requiredTimeWindow = windowAt(7, 0, 7, 1);
  }), home, 'constraint'),
  scenario('workday-overrun', 'Maršrutas netelpa į darbo laiką.', mutateStops(12, (stops) => {
    stops.forEach((stop) => {
      stop.serviceDurationMinutes = 40;
    });
  }), home, 'constraint', '2026-06-15T09:00:00.000Z'),
  scenario('odometer-invalid', 'Galutinis odometras mažesnis už pradinį.', undefined, home, 'accounting'),
  scenario('partial-fuel', 'Degalų pylimas nėra pilnas.', undefined, home, 'accounting'),
  scenario('full-tank-interval', 'Tarp pilnų bakų yra keli daliniai pylimai.', undefined, home, 'accounting'),
  scenario('multiple-routes-day', 'Vieną dieną vykdomi keli maršrutai.', undefined, home, 'accounting'),
  scenario('actual-faster', 'Faktinė trukmė trumpesnė už planuotą.', undefined, home, 'accounting'),
  scenario('actual-slower', 'Faktinė trukmė ilgesnė už planuotą.', undefined, home, 'accounting'),
  scenario('morning-evening-traffic', 'Rytinis ir vakarinis eismo modeliai duoda skirtingus laikus.'),
  scenario('asymmetric-pairs', 'A → B laikas skiriasi nuo B → A.'),
  scenario('unreachable-leg', 'Viena kelio matricos atkarpa yra nepasiekiama.', undefined, home, 'constraint'),
  scenario('stale-incomplete-traffic', 'Eismo duomenys pasenę arba nepilni.', undefined, home, 'constraint'),
  vilniusWorkday('vilnius-workday-1', 6, 0, home),
  vilniusWorkday('vilnius-workday-2', 8, 2, warehouse),
  vilniusWorkday('vilnius-workday-3', 10, 4, home),
  vilniusWorkday('vilnius-workday-4', 12, 1, warehouse),
  vilniusWorkday('vilnius-workday-5', 15, 0, home),
];

export function createPerformanceScenario(stopCount: number): RoutingScenario {
  const performanceScenario = scenario(
    `performance-${stopCount}`,
    `${stopCount} taškų našumo scenarijus.`,
    mutateStops(stopCount),
    home,
    'objective',
  );
  performanceScenario.request.vehicle.maximumPayloadKg = 20_000;
  performanceScenario.request.workdayEndAt = '2026-06-16T17:00:00.000Z';
  return performanceScenario;
}

export function createBaseRequest(stopCount = 8): RouteOptimizationRequest {
  const stops = Array.from({ length: stopCount }, (_, index) =>
    stopFromLocation(
      index < vilniusPoints.length
        ? vilniusPoints[index]
        : generatedLocation(index),
      index,
    ),
  );
  return {
    routeId: `route-${stopCount}`,
    startLocation: warehouse,
    endLocation: home,
    plannedDepartureAt: '2026-06-15T07:00:00.000Z',
    vehicle: {
      id: 'vehicle-1',
      type: 'truck',
      maximumPayloadKg: 3_500,
      heightM: 3.1,
      widthM: 2.3,
      lengthM: 7,
      grossWeightKg: 7_500,
      useRoadRestrictions: true,
      startLocation: warehouse,
      defaultEndLocation: home,
    },
    stops,
    planningMode: 'with_time_windows',
    scoring: structuredClone(DEFAULT_ROUTING_SCORING),
    trafficMode: 'synthetic',
    workdayEndAt: '2026-06-15T17:00:00.000Z',
    maxIterations: 2,
    maxCalculationMs: 1_000,
    randomSeeds: [7, 42, 2026],
  };
}

function scenario(
  id: string,
  description: string,
  mutation?: (request: RouteOptimizationRequest) => void,
  endLocation = home,
  category: RoutingScenario['category'] = 'objective',
  workdayEndAt?: string,
): RoutingScenario {
  const request = createBaseRequest(id === 'workday-overrun' ? 12 : 8);
  request.routeId = id;
  request.endLocation = distinctEndLocation(request.startLocation, endLocation);
  request.vehicle.defaultEndLocation = request.endLocation;
  if (workdayEndAt) request.workdayEndAt = workdayEndAt;
  mutation?.(request);
  return { id, description, category, request };
}

function vilniusWorkday(
  id: string,
  count: number,
  offset: number,
  endLocation: RoutingLocation,
): RoutingScenario {
  const request = createBaseRequest(count);
  request.routeId = id;
  request.endLocation = distinctEndLocation(request.startLocation, endLocation);
  request.vehicle.defaultEndLocation = request.endLocation;
  request.vehicle.maximumPayloadKg = 6_000;
  request.stops = Array.from({ length: count }, (_, index) =>
    stopFromLocation(vilniusPoints[(index + offset) % vilniusPoints.length], index),
  );
  request.stops[1].weightKg = 720;
  request.stops[Math.min(3, count - 1)].requiredTimeWindow = windowAt(9, 0, 11, 0);
  return {
    id,
    description: `Sintetinė Vilniaus darbo diena: ${count} pristatymo taškų.`,
    category: 'vilnius',
    request,
    expectedDirectionComment:
      endLocation.id === 'home'
        ? 'Tikėtina gera kryptis – negrįžti per pietinį sandėlį ir paskutinę zoną rinktis arčiau namų.'
        : 'Tikėtina gera kryptis – tolimas zonas sujungti į lanką ir paskutinę atkarpą nukreipti į sandėlį.',
  };
}

function mutateStops(
  count: number,
  mutation?: (stops: OptimizationStop[]) => void,
): (request: RouteOptimizationRequest) => void {
  return (request) => {
    request.stops = createBaseRequest(count).stops;
    mutation?.(request.stops);
  };
}

function reverseLocations(count: number): (request: RouteOptimizationRequest) => void {
  return mutateStops(count, (stops) => {
    stops.reverse();
  });
}

function setWeight(stops: OptimizationStop[], index: number, weightKg: number): void {
  stops[index].weightKg = weightKg;
}

function stopFromLocation(source: RoutingLocation, index: number): OptimizationStop {
  const id = `stop-${index + 1}`;
  return {
    id,
    location: { ...source, id },
    weightKg: 80 + ((index * 73) % 260),
    serviceDurationMinutes: 5 + (index % 4) * 5,
    priority: index % 3,
    lockedPosition: undefined,
    deliverBeforeStopIds: [],
    deliverAfterStopIds: [],
    preferEarly: false,
    preferLate: false,
    mustBeFirst: false,
    mustBeLast: false,
  };
}

function generatedLocation(index: number): RoutingLocation {
  const angle = (index * 137.508 * Math.PI) / 180;
  const radius = 0.025 + (index % 8) * 0.008;
  return location(
    `generated-${index}`,
    `Sintetinis Vilniaus taškas ${index + 1}`,
    54.6872 + Math.sin(angle) * radius,
    25.2797 + Math.cos(angle) * radius,
  );
}

function location(
  id: string,
  label: string,
  latitude: number,
  longitude: number,
): RoutingLocation {
  return { id, label, address: label, latitude, longitude };
}

function distinctEndLocation(
  startLocation: RoutingLocation,
  requestedEndLocation: RoutingLocation,
): RoutingLocation {
  if (requestedEndLocation.id !== startLocation.id) {
    return { ...requestedEndLocation };
  }
  return {
    ...requestedEndLocation,
    id: `${requestedEndLocation.id}-end`,
    label: `${requestedEndLocation.label} (pabaiga)`,
  };
}

function windowAt(fromHour: number, fromMinute: number, toHour: number, toMinute: number) {
  const at = (hour: number, minute: number) =>
    `2026-06-15T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
  return { from: at(fromHour, fromMinute), to: at(toHour, toMinute) };
}
