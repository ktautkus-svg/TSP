import { DEFAULT_ROUTING_SCORING } from '../../src/domain/routing/defaults';
import type {
  OptimizationStop,
  RouteOptimizationRequest,
  RoutingLocation,
} from '../../src/domain/routing/models';

export const VILNIUS_TIME_ZONE = 'Europe/Vilnius' as const;
export const BENCHMARK_DATE = '2026-08-03';
export const BENCHMARK_DEPARTURES = [
  { id: 'morning', localTime: '07:30', iso: '2026-08-03T04:30:00.000Z' },
  { id: 'midday', localTime: '10:30', iso: '2026-08-03T07:30:00.000Z' },
  { id: 'evening_peak', localTime: '15:30', iso: '2026-08-03T12:30:00.000Z' },
  { id: 'late_evening', localTime: '19:00', iso: '2026-08-03T16:00:00.000Z' },
] as const;

type ScenarioDefinition = {
  id: string;
  name: string;
  start: RoutingLocation;
  end: RoutingLocation;
  points: Array<[string, number, number, number, number]>;
  requiredWindowIndexes?: number[];
  heavyIndex?: number;
};

const warehouse = loc('warehouse', 'Sandėlio zona, Kirtimai', 54.6382, 25.1742);
const warehouseEnd = loc(
  'warehouse-end',
  'Sandėlio zona, Kirtimai',
  54.6382,
  25.1742,
);
const northEnd = loc('north-end', 'Šiaurinė pabaigos zona', 54.7405, 25.247);
const westEnd = loc('west-end', 'Vakarinė pabaigos zona', 54.704, 25.163);

const DEFINITIONS: ScenarioDefinition[] = [
  {
    id: 'vilnius-center',
    name: 'Miesto centras, trumpos atkarpos',
    start: warehouse,
    end: warehouseEnd,
    points: [
      ['Senamiesčio zona', 54.6808, 25.285, 80, 8],
      ['Naujamiesčio zona', 54.6754, 25.2632, 110, 10],
      ['Žvėryno zona', 54.6925, 25.249, 65, 7],
      ['Šnipiškių zona', 54.7007, 25.2794, 480, 18],
      ['Užupio zona', 54.6815, 25.3058, 45, 6],
      ['Markučių zona', 54.6741, 25.3226, 95, 9],
    ],
    requiredWindowIndexes: [1],
    heavyIndex: 3,
  },
  {
    id: 'vilnius-east',
    name: 'Rytinė Vilniaus dalis',
    start: warehouse,
    end: northEnd,
    points: [
      ['Antakalnio zona', 54.7026, 25.3193, 120, 10],
      ['Valakampių zona', 54.7311, 25.3374, 70, 8],
      ['Dvarčionių zona', 54.736, 25.391, 160, 12],
      ['Naujosios Vilnios zona', 54.6928, 25.4142, 760, 20],
      ['Pavilnio zona', 54.6806, 25.365, 90, 9],
      ['Belmonto zona', 54.684, 25.347, 55, 6],
      ['Žirmūnų rytinė zona', 54.7192, 25.3037, 140, 11],
    ],
    heavyIndex: 3,
  },
  {
    id: 'vilnius-west',
    name: 'Vakarinė Vilniaus dalis',
    start: warehouse,
    end: westEnd,
    points: [
      ['Lazdynų zona', 54.6758, 25.2062, 180, 12],
      ['Karoliniškių zona', 54.691, 25.214, 85, 8],
      ['Pilaitės zona', 54.6998, 25.1834, 820, 20],
      ['Justiniškių zona', 54.715, 25.216, 130, 10],
      ['Viršuliškių zona', 54.706, 25.224, 55, 7],
      ['Gariūnų zona', 54.653, 25.17, 240, 14],
    ],
    requiredWindowIndexes: [4],
    heavyIndex: 2,
  },
  {
    id: 'vilnius-north',
    name: 'Šiaurinė miesto dalis',
    start: warehouse,
    end: northEnd,
    points: [
      ['Šeškinės zona', 54.714, 25.25, 90, 8],
      ['Fabijoniškių zona', 54.7338, 25.2394, 120, 10],
      ['Pašilaičių zona', 54.7278, 25.219, 600, 18],
      ['Jeruzalės zona', 54.751, 25.278, 75, 8],
      ['Verkių zona', 54.7521, 25.2948, 140, 12],
      ['Balsių zona', 54.787, 25.356, 200, 14],
      ['Santariškių zona', 54.755, 25.279, 60, 7],
    ],
    heavyIndex: 2,
  },
  {
    id: 'vilnius-south-industrial',
    name: 'Pietinė ir pramoninė dalis',
    start: warehouse,
    end: warehouseEnd,
    points: [
      ['Oro uosto zona', 54.6357, 25.2858, 90, 8],
      ['Naujininkų zona', 54.65, 25.273, 150, 10],
      ['Liepkalnio zona', 54.642, 25.313, 720, 20],
      ['Panerių zona', 54.6161, 25.1725, 280, 15],
      ['Aukštųjų Panerių zona', 54.601, 25.165, 110, 9],
      ['Kirtimų rytinė zona', 54.623, 25.225, 200, 13],
    ],
    requiredWindowIndexes: [2],
    heavyIndex: 2,
  },
  {
    id: 'vilnius-lentvaris-grigiskes',
    name: 'Lentvario ir Grigiškių kryptis',
    start: warehouse,
    end: westEnd,
    points: [
      ['Žemųjų Panerių zona', 54.648, 25.193, 100, 8],
      ['Gariūnų vakarinė zona', 54.656, 25.151, 230, 13],
      ['Grigiškių zona', 54.6704, 25.0914, 650, 18],
      ['Lentvario rytinė zona', 54.648, 25.055, 140, 11],
      ['Lentvario vakarinė zona', 54.643, 25.035, 75, 8],
      ['Trakų Vokės zona', 54.607, 25.113, 190, 12],
    ],
    heavyIndex: 2,
  },
  {
    id: 'vilnius-avizieniai',
    name: 'Avižienių kryptis',
    start: warehouse,
    end: northEnd,
    points: [
      ['Buivydiškių zona', 54.721, 25.184, 90, 8],
      ['Zujūnų zona', 54.728, 25.158, 110, 9],
      ['Avižienių zona', 54.769, 25.183, 780, 20],
      ['Bendorių zona', 54.794, 25.176, 130, 11],
      ['Tarandės zona', 54.755, 25.206, 65, 7],
      ['Perkūnkiemio zona', 54.742, 25.218, 170, 12],
      ['Ukmergės plento zona', 54.735, 25.225, 55, 6],
    ],
    requiredWindowIndexes: [1],
    heavyIndex: 2,
  },
  {
    id: 'vilnius-mixed',
    name: 'Mišrus miesto ir užmiesčio maršrutas',
    start: warehouse,
    end: northEnd,
    points: [
      ['Oro uosto zona', 54.6357, 25.2858, 150, 10],
      ['Centro zona', 54.686, 25.285, 95, 8],
      ['Pilaitės zona', 54.6998, 25.1834, 560, 18],
      ['Naujosios Vilnios zona', 54.6928, 25.4142, 80, 9],
      ['Avižienių zona', 54.769, 25.183, 210, 13],
      ['Balsių zona', 54.787, 25.356, 120, 11],
      ['Grigiškių zona', 54.6704, 25.0914, 70, 7],
      ['Žirmūnų zona', 54.7192, 25.3037, 180, 12],
    ],
    requiredWindowIndexes: [3],
    heavyIndex: 2,
  },
];

export type VilniusBenchmarkScenario = {
  id: string;
  name: string;
  request: RouteOptimizationRequest;
  heavyStopId: string;
};

export function createVilniusBenchmarkScenarios(
  departureAt: string,
): VilniusBenchmarkScenario[] {
  return DEFINITIONS.map((definition) => {
    const stops = definition.points.map(
      ([label, latitude, longitude, weightKg, serviceDurationMinutes], index) =>
        createStop(
          `${definition.id}-stop-${index + 1}`,
          label,
          latitude,
          longitude,
          weightKg,
          serviceDurationMinutes,
          definition.requiredWindowIndexes?.includes(index)
            ? relativeWindow(departureAt, 45, 150)
            : undefined,
        ),
    );
    const initialLoadKg = stops.reduce((sum, stop) => sum + (stop.weightKg ?? 0), 0);
    return {
      id: definition.id,
      name: definition.name,
      heavyStopId:
        stops[definition.heavyIndex ?? indexOfHeaviest(stops)].id,
      request: {
        routeId: `${definition.id}-${departureAt}`,
        startLocation: definition.start,
        endLocation: definition.end,
        plannedDepartureAt: departureAt,
        vehicle: {
          id: 'benchmark-truck',
          type: 'truck',
          maximumPayloadKg: 6_000,
          heightM: 3.1,
          widthM: 2.3,
          lengthM: 7,
          grossWeightKg: 7_500,
          useRoadRestrictions: true,
          startLocation: definition.start,
          defaultEndLocation: definition.end,
        },
        stops,
        initialLoadKg,
        planningMode: 'with_time_windows',
        scoring: structuredClone(DEFAULT_ROUTING_SCORING),
        trafficMode: 'live',
        workdayEndAt: new Date(
          Date.parse(departureAt) + 12 * 60 * 60_000,
        ).toISOString(),
        maxIterations: 2,
        maxCalculationMs: 1_000,
        randomSeeds: [7, 42, 2026],
      },
    };
  });
}

function createStop(
  id: string,
  label: string,
  latitude: number,
  longitude: number,
  weightKg: number,
  serviceDurationMinutes: number,
  requiredTimeWindow?: { from: string; to: string },
): OptimizationStop {
  return {
    id,
    location: loc(id, label, latitude, longitude),
    weightKg,
    serviceDurationMinutes,
    requiredTimeWindow,
    priority: 0,
    lockedPosition: undefined,
    deliverBeforeStopIds: [],
    deliverAfterStopIds: [],
    preferEarly: false,
    preferLate: false,
    mustBeFirst: false,
    mustBeLast: false,
  };
}

function loc(
  id: string,
  label: string,
  latitude: number,
  longitude: number,
): RoutingLocation {
  return { id, label, latitude, longitude };
}

function relativeWindow(departureAt: string, from: number, to: number) {
  const start = Date.parse(departureAt);
  return {
    from: new Date(start + from * 60_000).toISOString(),
    to: new Date(start + to * 60_000).toISOString(),
  };
}

function indexOfHeaviest(stops: OptimizationStop[]): number {
  return stops.reduce(
    (best, stop, index) =>
      (stop.weightKg ?? 0) > (stops[best].weightKg ?? 0) ? index : best,
    0,
  );
}
