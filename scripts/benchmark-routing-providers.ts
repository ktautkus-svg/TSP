import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { RoutingEngine } from '../src/application/routing/routing-engine';
import type {
  MatrixRequest,
  RouteOptimizationResult,
  TravelCostProvider,
  TravelMatrix,
} from '../src/domain/routing/models';
import { SyntheticTravelCostProvider } from '../src/infrastructure/routing/providers/synthetic-travel-cost-provider';
import {
  BENCHMARK_DATE,
  BENCHMARK_DEPARTURES,
  createVilniusBenchmarkScenarios,
  VILNIUS_TIME_ZONE,
} from '../gateway/benchmark/vilnius-scenarios';
import {
  compareMatrices,
  compareSequences,
} from '../gateway/benchmark/analysis';
import { FileMatrixResultCache } from '../gateway/cache/file-matrix-cache';
import {
  loadGatewayConfig,
  requireRealProviderKeys,
} from '../gateway/config';
import { GatewayError } from '../gateway/errors';
import { HereMatrixAdapter } from '../gateway/providers/here-matrix-adapter';
import { GoogleMatrixAdapter } from '../gateway/providers/google-matrix-adapter';
import { OptimizationGatewayService } from '../gateway/service';
import type {
  GatewayMatrixRequest,
  GatewayMatrixResponse,
  GatewayProvider,
  GatewayRunMode,
} from '../gateway/types';

type ProviderRun = {
  scenarioId: string;
  scenarioName: string;
  timeSlot: string;
  localDeparture: string;
  departureAt: string;
  timeZone: string;
  provider: string;
  executionMode: string;
  status: 'success' | 'error';
  errorCode: string | null;
  errorMessage: string | null;
  matrixCompleteness: number | null;
  matrixResponseMs: number | null;
  optimizationMs: number | null;
  cacheHit: boolean;
  externalRequestCount: number;
  matrixElementsBilled: number;
  estimatedCost: number | null;
  currency: string | null;
  recommendedOrder: string[];
  totalWorkMinutes: number | null;
  drivingMinutes: number | null;
  distanceKm: number | null;
  tonneKilometers: number | null;
  lateMinutes: number | null;
  waitingMinutes: number | null;
  directionalityPenalty: number | null;
  score: number | null;
  warnings: string[];
  matrix?: TravelMatrix;
};

type PairResult = {
  scenarioId: string;
  timeSlot: string;
  leftProvider: string;
  rightProvider: string;
  matrix: ReturnType<typeof compareMatrices> | null;
  sequence: ReturnType<typeof compareSequences> | null;
};

const mode = readMode(process.argv);
const config = loadGatewayConfig();

async function main(): Promise<void> {
  if (mode === 'real' || mode === 'refresh') requireRealProviderKeys(config);

  const auditEvents: unknown[] = [];
  const service = new OptimizationGatewayService(
    config,
    {
      here: new HereMatrixAdapter(config.hereApiKey ?? ''),
      google: new GoogleMatrixAdapter(config.googleApiKey ?? ''),
    },
    new FileMatrixResultCache(config.cacheDirectory),
    (event) => auditEvents.push(event),
  );

  const runs: ProviderRun[] = [];
  const pairs: PairResult[] = [];
  for (const departure of BENCHMARK_DEPARTURES) {
    for (const scenario of createVilniusBenchmarkScenarios(departure.iso)) {
      const scenarioRuns: ProviderRun[] = [];
      if (mode === 'synthetic') {
        for (const syntheticMode of ['city_traffic', 'asymmetric'] as const) {
          scenarioRuns.push(
            await executeSynthetic(
              scenario,
              departure,
              new SyntheticTravelCostProvider(syntheticMode),
            ),
          );
        }
      } else {
        for (const provider of ['here', 'google'] as const) {
          if (
            (provider === 'here' && !config.hereApiKey) ||
            (provider === 'google' && !config.googleApiKey)
          ) {
            continue;
          }
          scenarioRuns.push(
            await executeGateway(
              scenario,
              departure,
              provider,
              service,
              mode,
            ),
          );
        }
      }
      runs.push(...scenarioRuns);
      if (scenarioRuns.length >= 2) {
        const [left, right] = scenarioRuns;
        pairs.push({
          scenarioId: scenario.id,
          timeSlot: departure.id,
          leftProvider: left.provider,
          rightProvider: right.provider,
          matrix:
            left.matrix && right.matrix
              ? compareMatrices(left.matrix, right.matrix)
              : null,
          sequence:
            left.status === 'success' && right.status === 'success'
              ? compareSequences(
                  candidateFromRun(left),
                  candidateFromRun(right),
                  scenario.heavyStopId,
                )
              : null,
        });
      }
    }
  }

  const report = {
    benchmark: 'Vilnius routing provider comparison',
    generatedAt: new Date().toISOString(),
    benchmarkDate: BENCHMARK_DATE,
    timeZone: VILNIUS_TIME_ZONE,
    mode,
    dataQuality:
      mode === 'synthetic'
        ? 'SYNTHETIC ONLY: šie du modeliai nėra HERE ar Google ir negali būti naudojami tiekėjui pasirinkti.'
        : mode === 'cache-only'
          ? 'Tik anksčiau išsaugotos realios matricos; jokia išorinė užklausa nevykdoma.'
          : 'Realūs providerio duomenys. Stub ar sintetinis fallback draudžiamas.',
    scenarioCount: 8,
    departureCount: 4,
    expectedProviderRuns: 64,
    aggregates: aggregate(runs, pairs),
    pairComparisons: pairs,
    runs,
    auditEvents,
  };
  const directory = resolve('reports/provider-comparison');
  await mkdir(directory, { recursive: true });
  const base = resolve(directory, `comparison-${mode}`);
  await Promise.all([
    writeFile(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    writeFile(`${base}.csv`, toCsv(runs), 'utf8'),
    writeFile(`${base}.md`, toMarkdown(report), 'utf8'),
  ]);
  console.table(report.aggregates.byProvider);
  console.log(
    `${mode}: ${runs.length} paleidimų, ${report.aggregates.externalRequests} realių išorinių užklausų, ${report.aggregates.cacheHits} cache hit.`,
  );
  console.log(`Ataskaitos: ${base}.{json,csv,md}`);
}

async function executeSynthetic(
  scenario: ReturnType<typeof createVilniusBenchmarkScenarios>[number],
  departure: (typeof BENCHMARK_DEPARTURES)[number],
  provider: SyntheticTravelCostProvider,
): Promise<ProviderRun> {
  const matrixRequest = toMatrixRequest(scenario.request);
  const matrixStarted = performance.now();
  const matrix = await provider.getMatrix(matrixRequest);
  const matrixResponseMs = performance.now() - matrixStarted;
  return optimizeAndMap({
    scenario,
    departure,
    matrix,
    matrixResponseMs,
    cacheHit: false,
    externalRequestCount: 0,
    elements: 0,
    estimatedCost: null,
    currency: null,
  });
}

async function executeGateway(
  scenario: ReturnType<typeof createVilniusBenchmarkScenarios>[number],
  departure: (typeof BENCHMARK_DEPARTURES)[number],
  provider: GatewayProvider,
  service: OptimizationGatewayService,
  runMode: Exclude<GatewayRunMode, 'synthetic'>,
): Promise<ProviderRun> {
  try {
    const response = await service.getMatrix(
      toGatewayRequest(scenario.request, provider, departure.id),
      runMode,
    );
    return optimizeAndMap({
      scenario,
      departure,
      matrix: response,
      matrixResponseMs: response.gatewayMetadata.totalResponseMs,
      cacheHit: response.gatewayMetadata.cacheHit,
      externalRequestCount:
        response.gatewayMetadata.usage.externalRequestCount,
      elements: response.gatewayMetadata.usage.units,
      estimatedCost: response.gatewayMetadata.usage.estimatedCost,
      currency: response.gatewayMetadata.usage.currency,
      gateway: response,
    });
  } catch (error) {
    const safe =
      error instanceof GatewayError
        ? error
        : new GatewayError(
            'PROVIDER_NETWORK_ERROR',
            error instanceof Error ? error.message : 'Nežinoma klaida.',
            500,
            true,
          );
    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      timeSlot: departure.id,
      localDeparture: departure.localTime,
      departureAt: departure.iso,
      timeZone: VILNIUS_TIME_ZONE,
      provider,
      executionMode: runMode,
      status: 'error',
      errorCode: safe.code,
      errorMessage: safe.message,
      matrixCompleteness: null,
      matrixResponseMs: null,
      optimizationMs: null,
      cacheHit: false,
      externalRequestCount: 0,
      matrixElementsBilled: 0,
      estimatedCost: null,
      currency: null,
      recommendedOrder: [],
      totalWorkMinutes: null,
      drivingMinutes: null,
      distanceKm: null,
      tonneKilometers: null,
      lateMinutes: null,
      waitingMinutes: null,
      directionalityPenalty: null,
      score: null,
      warnings: [],
    };
  }
}

async function optimizeAndMap(input: {
  scenario: ReturnType<typeof createVilniusBenchmarkScenarios>[number];
  departure: (typeof BENCHMARK_DEPARTURES)[number];
  matrix: TravelMatrix;
  matrixResponseMs: number;
  cacheHit: boolean;
  externalRequestCount: number;
  elements: number;
  estimatedCost: number | null;
  currency: string | null;
  gateway?: GatewayMatrixResponse;
}): Promise<ProviderRun> {
  const started = performance.now();
  const result = await new RoutingEngine(
    new StaticMatrixProvider(input.matrix),
  ).optimize(input.scenario.request);
  const optimizationMs = performance.now() - started;
  const candidate = result.recommended;
  const run: ProviderRun = {
    scenarioId: input.scenario.id,
    scenarioName: input.scenario.name,
    timeSlot: input.departure.id,
    localDeparture: input.departure.localTime,
    departureAt: input.departure.iso,
    timeZone: VILNIUS_TIME_ZONE,
    provider: input.matrix.provider,
    executionMode: input.matrix.executionMode,
    status: 'success',
    errorCode: null,
    errorMessage: null,
    matrixCompleteness:
      input.gateway?.gatewayMetadata.completenessRatio ??
      completeRatio(input.matrix),
    matrixResponseMs: round(input.matrixResponseMs),
    optimizationMs: round(optimizationMs),
    cacheHit: input.cacheHit,
    externalRequestCount: input.externalRequestCount,
    matrixElementsBilled: input.elements,
    estimatedCost: input.estimatedCost,
    currency: input.currency,
    recommendedOrder: candidate?.stopSequence ?? [],
    totalWorkMinutes: nullable(candidate?.totalWorkMinutes),
    drivingMinutes: nullable(candidate?.drivingMinutes),
    distanceKm: nullable(candidate?.totalDistanceKm),
    tonneKilometers: nullable(candidate?.tonneKilometers),
    lateMinutes: nullable(candidate?.totalLateMinutes),
    waitingMinutes: nullable(candidate?.waitingMinutes),
    directionalityPenalty: nullable(candidate?.directionalityPenalty),
    score: nullable(candidate?.totalScore),
    warnings: result.warnings,
    matrix: input.matrix,
  };
  Object.defineProperty(run, '__optimizationResult', {
    value: result,
    enumerable: false,
  });
  return run;
}

function candidateFromRun(run: ProviderRun) {
  const result = (run as ProviderRun & {
    __optimizationResult?: RouteOptimizationResult;
  }).__optimizationResult;
  return result?.recommended ?? null;
}

class StaticMatrixProvider implements TravelCostProvider {
  readonly name: string;
  constructor(private readonly matrix: TravelMatrix) {
    this.name = matrix.provider;
  }
  async getMatrix(): Promise<TravelMatrix> {
    return this.matrix;
  }
}

function toGatewayRequest(
  request: ReturnType<typeof createVilniusBenchmarkScenarios>[number]['request'],
  provider: GatewayProvider,
  slot: string,
): GatewayMatrixRequest {
  return {
    schemaVersion: '1',
    provider,
    matrixId: `${request.routeId}-${slot}-${provider}`,
    startLocation: request.startLocation,
    stops: request.stops.map(({ location }) => location),
    endLocation: request.endLocation,
    departureAt: request.plannedDepartureAt,
    trafficMode: request.trafficMode === 'none' ? 'none' : 'live',
    vehicle: request.vehicle,
    language: 'lt-LT',
    regionCode: 'LT',
  };
}

function toMatrixRequest(
  request: ReturnType<typeof createVilniusBenchmarkScenarios>[number]['request'],
): MatrixRequest {
  return {
    locations: [
      request.startLocation,
      ...request.stops.map(({ location }) => location),
      request.endLocation,
    ],
    vehicle: request.vehicle,
    departureAt: request.plannedDepartureAt,
    trafficMode: request.trafficMode,
    timeoutMs: 15_000,
  };
}

function aggregate(runs: ProviderRun[], pairs: PairResult[]) {
  const providers = [...new Set(runs.map(({ provider }) => provider))];
  return {
    externalRequests: sum(runs.map(({ externalRequestCount }) => externalRequestCount)),
    cacheHits: runs.filter(({ cacheHit }) => cacheHit).length,
    matrixElementsBilled: sum(runs.map(({ matrixElementsBilled }) => matrixElementsBilled)),
    estimatedCost:
      runs.some(({ estimatedCost }) => estimatedCost !== null)
        ? round(sum(runs.map(({ estimatedCost }) => estimatedCost ?? 0)))
        : null,
    successfulRuns: runs.filter(({ status }) => status === 'success').length,
    failedRuns: runs.filter(({ status }) => status === 'error').length,
    byProvider: providers.map((provider) => {
      const subset = runs.filter((run) => run.provider === provider);
      const completed = subset.filter((run) => run.status === 'success');
      return {
        provider,
        runs: subset.length,
        successes: completed.length,
        averageResponseMs: average(
          completed.flatMap(({ matrixResponseMs }) =>
            matrixResponseMs === null ? [] : [matrixResponseMs],
          ),
        ),
        averageCompleteness: average(
          completed.flatMap(({ matrixCompleteness }) =>
            matrixCompleteness === null ? [] : [matrixCompleteness],
          ),
        ),
      };
    }),
    identicalSequences: pairs.filter(
      ({ sequence }) => sequence?.classification === 'identical',
    ).length,
    minorSequenceDifferences: pairs.filter(
      ({ sequence }) => sequence?.classification === 'minor',
    ).length,
    significantSequenceDifferences: pairs.filter(
      ({ sequence }) => sequence?.classification === 'significant',
    ).length,
    firstStopChanges: pairs.filter(({ sequence }) => sequence?.firstChanged).length,
    lastStopChanges: pairs.filter(({ sequence }) => sequence?.lastChanged).length,
    medianDurationDifferencePercent: median(
      pairs.flatMap(({ matrix }) =>
        matrix?.medianDurationDifferencePercent === null || !matrix
          ? []
          : [matrix.medianDurationDifferencePercent],
      ),
    ),
    p90DurationDifferencePercent: median(
      pairs.flatMap(({ matrix }) =>
        matrix?.p90DurationDifferencePercent === null || !matrix
          ? []
          : [matrix.p90DurationDifferencePercent],
      ),
    ),
  };
}

function toCsv(runs: ProviderRun[]): string {
  const columns: Array<keyof ProviderRun> = [
    'scenarioId', 'scenarioName', 'timeSlot', 'localDeparture', 'departureAt',
    'timeZone', 'provider', 'executionMode', 'status', 'errorCode',
    'matrixCompleteness', 'matrixResponseMs', 'optimizationMs', 'cacheHit',
    'externalRequestCount', 'matrixElementsBilled', 'estimatedCost', 'currency',
    'recommendedOrder', 'totalWorkMinutes', 'drivingMinutes', 'distanceKm',
    'tonneKilometers', 'lateMinutes', 'waitingMinutes', 'directionalityPenalty',
    'score', 'warnings',
  ];
  return [
    columns.join(','),
    ...runs.map((run) =>
      columns.map((column) => csv(run[column])).join(','),
    ),
  ].join('\n');
}

function toMarkdown(report: {
  generatedAt: string;
  mode: GatewayRunMode;
  dataQuality: string;
  scenarioCount: number;
  departureCount: number;
  aggregates: ReturnType<typeof aggregate>;
  pairComparisons: PairResult[];
  runs: ProviderRun[];
}): string {
  const recommendation =
    report.mode === 'synthetic'
      ? 'Tiekėjo pasirinkti negalima: paleisti tik sintetiniai modeliai.'
      : report.aggregates.successfulRuns < 64
        ? 'Tiekėjo pasirinkimui dar nepakanka pilnų realių duomenų.'
        : 'Vertinti pagal pilnumą, atsako laiką, sekų logiškumą, truck apribojimų naudą ir sukonfigūruotą kainą; vien ETA neužtenka.';
  return `# Vilniaus maršrutų tiekėjų palyginimas

Sugeneruota: ${report.generatedAt}

> ${report.dataQuality}

## Santrauka

- Režimas: **${report.mode}**
- Scenarijai: ${report.scenarioCount}; laikai: ${report.departureCount}; providerio paleidimai: ${report.runs.length}
- Realios išorinės užklausos: ${report.aggregates.externalRequests}
- Cache hit: ${report.aggregates.cacheHits}
- Sėkmingi / klaidingi paleidimai: ${report.aggregates.successfulRuns} / ${report.aggregates.failedRuns}
- Apskaitos vienetai (matricos elementai): ${report.aggregates.matrixElementsBilled}
- Preliminari kaina: ${report.aggregates.estimatedCost === null ? 'nesukonfigūruota' : report.aggregates.estimatedCost}
- Identiškos / nežymiai / reikšmingai skirtingos sekos: ${report.aggregates.identicalSequences} / ${report.aggregates.minorSequenceDifferences} / ${report.aggregates.significantSequenceDifferences}
- Pirmo / paskutinio taško pokyčiai: ${report.aggregates.firstStopChanges} / ${report.aggregates.lastStopChanges}
- Scenarijų medianinių trukmės skirtumų mediana: ${report.aggregates.medianDurationDifferencePercent ?? 'n/a'} %
- Scenarijų p90 trukmės skirtumų mediana: ${report.aggregates.p90DurationDifferencePercent ?? 'n/a'} %

| Duomenų šaltinis | Paleidimai | Sėkmingi | Vid. atsakas, ms | Vid. pilnumas |
|---|---:|---:|---:|---:|
${report.aggregates.byProvider.map((row) => `| ${row.provider} | ${row.runs} | ${row.successes} | ${row.averageResponseMs} | ${row.averageCompleteness} |`).join('\n')}

## Rekomendacija

${recommendation}

Manevrų metaduomenys šiame HERE ir Google matricos palyginime nėra tiesiogiai palyginami, todėl jiems neišgalvota papildoma bauda. Google adapteris taip pat nedeklaruoja sunkvežimio matmenų ar kelių apribojimų palaikymo; HERE juos perduoda, kai profilis yra truck.
`;
}

function readMode(argv: string[]): GatewayRunMode {
  const raw = argv.find((argument) => argument.startsWith('--mode='))?.split('=')[1];
  if (
    raw !== 'real' &&
    raw !== 'cache-only' &&
    raw !== 'refresh' &&
    raw !== 'synthetic'
  ) {
    throw new Error('Naudokite --mode=real|cache-only|refresh|synthetic.');
  }
  return raw;
}

function completeRatio(matrix: TravelMatrix): number {
  const cells = matrix.cells.flat();
  return cells.filter(({ reachable }) => reachable).length / cells.length;
}

function nullable(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : round(value);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]): number {
  return values.length ? round(sum(values) / values.length) : 0;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return round(
    sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2,
  );
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function csv(value: unknown): string {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (
    (mode === 'real' || mode === 'refresh') &&
    error instanceof GatewayError &&
    error.code === 'CONFIGURATION_ERROR'
  ) {
    const directory = resolve('reports/provider-comparison');
    await mkdir(directory, { recursive: true });
    const failure = {
      benchmark: 'Vilnius routing provider comparison',
      generatedAt: new Date().toISOString(),
      mode,
      status: 'not_run',
      reason: message,
      realExternalRequests: 0,
      cacheHits: 0,
      hereResults: null,
      googleResults: null,
      recommendation: 'Dar nepakanka duomenų tiekėjui pasirinkti.',
    };
    await Promise.all([
      writeFile(
        resolve(directory, `comparison-${mode}-unavailable.json`),
        `${JSON.stringify(failure, null, 2)}\n`,
        'utf8',
      ),
      writeFile(
        resolve(directory, `comparison-${mode}-unavailable.md`),
        `# Realus benchmark neįvykdytas\n\n- Būsena: **not_run**\n- Priežastis: ${message}\n- Realios išorinės užklausos: 0\n- Cache hit: 0\n- HERE / Google palyginimo rezultatai: nėra\n- Rekomendacija: dar nepakanka duomenų tiekėjui pasirinkti.\n`,
        'utf8',
      ),
    ]);
  }
  console.error(message);
  process.exitCode = 1;
});
