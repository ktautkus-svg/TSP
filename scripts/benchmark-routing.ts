import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { RoutingEngine } from '../src/application/routing/routing-engine';
import {
  createPerformanceScenario,
  routingScenarios,
} from '../src/domain/routing/scenarios';
import {
  SyntheticTravelCostProvider,
  type SyntheticMatrixMode,
} from '../src/infrastructure/routing/providers/synthetic-travel-cost-provider';

type BenchmarkRun = {
  scenarioId: string;
  category: string;
  provider: string;
  executionMode: string;
  elapsedMs: number;
  memoryDeltaKb: number;
  candidateCount: number;
  feasibleCandidateCount: number;
  feasibleRouteFound: boolean;
  recommendedOrder: string[];
  generatedBy: string[];
  totalScore: number | null;
  totalWorkMinutes: number | null;
  distanceKm: number | null;
  tonneKilometers: number | null;
  lateMinutes: number | null;
  directionalityPenalty: number | null;
  localSearchImprovementPercent: number | null;
  violations: string[];
};

type CandidateBenchmarkRow = {
  scenarioId: string;
  provider: string;
  executionMode: string;
  rank: number;
  algorithms: string[];
  initialSequence: string[];
  finalSequence: string[];
  feasible: boolean;
  violations: string[];
  totalWorkMinutes: number;
  drivingMinutes: number;
  serviceMinutes: number;
  waitingMinutes: number;
  distanceKm: number;
  tonneKilometers: number;
  directionalityPenalty: number;
  maneuverPenalty: number;
  lateMinutes: number;
  rawScoreComponents: string;
  normalizedScoreComponents: string;
  totalScore: number | null;
  iterations: number;
  elapsedMs: number;
  explanations: string;
  warnings: string;
};

const providerModes: SyntheticMatrixMode[] = ['linear', 'city_traffic', 'asymmetric'];
const performanceScenarios = [5, 10, 15, 20, 30].map(createPerformanceScenario);

async function main(): Promise<void> {
  const runs: BenchmarkRun[] = [];
  const candidateRows: CandidateBenchmarkRow[] = [];
  for (const scenario of [...routingScenarios, ...performanceScenarios]) {
    for (const mode of providerModes) {
      const engine = new RoutingEngine(new SyntheticTravelCostProvider(mode));
      const memoryBefore = process.memoryUsage().heapUsed;
      const startedAt = performance.now();
      const result = await engine.optimize(scenario.request);
      const elapsedMs = performance.now() - startedAt;
      const memoryDeltaKb = (process.memoryUsage().heapUsed - memoryBefore) / 1024;
      const recommended = result.recommended;
      runs.push({
        scenarioId: scenario.id,
        category: scenario.category,
        provider: result.provider,
        executionMode: result.executionMode,
        elapsedMs: round(elapsedMs),
        memoryDeltaKb: round(memoryDeltaKb),
        candidateCount: result.candidates.length,
        feasibleCandidateCount: result.candidates.filter((candidate) => candidate.feasible).length,
        feasibleRouteFound: result.feasibleRouteFound,
        recommendedOrder: recommended?.stopSequence ?? [],
        generatedBy: recommended?.generatedBy ?? [],
        totalScore: nullableRound(recommended?.totalScore),
        totalWorkMinutes: nullableRound(recommended?.totalWorkMinutes),
        distanceKm: nullableRound(recommended?.totalDistanceKm),
        tonneKilometers: nullableRound(recommended?.tonneKilometers),
        lateMinutes: nullableRound(recommended?.totalLateMinutes),
        directionalityPenalty: nullableRound(recommended?.directionalityPenalty),
        localSearchImprovementPercent: nullableRound(
          recommended?.localSearch.improvementPercent,
        ),
        violations: result.conflictingConstraints.map(
          (violation) => `${violation.code}:${violation.stopId ?? '-'}`,
        ),
      });
      result.candidates.forEach((candidate, index) => {
        candidateRows.push({
          scenarioId: scenario.id,
          provider: result.provider,
          executionMode: result.executionMode,
          rank: index + 1,
          algorithms: candidate.generatedBy,
          initialSequence: candidate.localSearch.initialSequence,
          finalSequence: candidate.stopSequence,
          feasible: candidate.feasible,
          violations: candidate.violations.map(
            (violation) => `${violation.code}:${violation.stopId ?? '-'}`,
          ),
          totalWorkMinutes: round(candidate.totalWorkMinutes),
          drivingMinutes: round(candidate.drivingMinutes),
          serviceMinutes: round(candidate.serviceMinutes),
          waitingMinutes: round(candidate.waitingMinutes),
          distanceKm: round(candidate.totalDistanceKm),
          tonneKilometers: round(candidate.tonneKilometers),
          directionalityPenalty: round(candidate.directionalityPenalty),
          maneuverPenalty: round(candidate.maneuverPenalty),
          lateMinutes: round(candidate.totalLateMinutes),
          rawScoreComponents: JSON.stringify(candidate.rawScoreComponents),
          normalizedScoreComponents: JSON.stringify(candidate.normalizedScoreComponents),
          totalScore: nullableRound(candidate.totalScore),
          iterations: candidate.localSearch.iterations,
          elapsedMs: round(elapsedMs),
          explanations: JSON.stringify(candidate.explanations),
          warnings: JSON.stringify(candidate.warnings),
        });
      });
    }
  }

  const report = {
    benchmark: 'Routing Engine v0.1',
    generatedAt: new Date().toISOString(),
    dataQuality:
      'Visi šio benchmark duomenys sintetiniai. Jie skirti algoritmo invariantams ir tiekėjo skirtumų pipeline tikrinti, ne HERE ar Google kokybei vertinti.',
    scenarioCount: routingScenarios.length,
    providerModes,
    runCount: runs.length,
    aggregates: aggregate(runs),
    runs,
    candidateRows,
  };
  const outputDirectory = resolve('reports/routing');
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      resolve(outputDirectory, 'benchmark.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    ),
    writeFile(resolve(outputDirectory, 'benchmark.csv'), toCsv(candidateRows), 'utf8'),
    writeFile(resolve(outputDirectory, 'benchmark.md'), toMarkdown(report), 'utf8'),
  ]);
  console.table(report.aggregates.byProvider);
  console.log(
    `Benchmark: ${report.runCount} paleidimų, ${report.scenarioCount} bazinių scenarijų.`,
  );
  console.log(`Ataskaitos: ${outputDirectory}`);
}

function aggregate(runs: BenchmarkRun[]) {
  const byProvider = providerModes.map((mode) => {
    const subset = runs.filter((run) => run.provider === `synthetic:${mode}`);
    return {
      provider: `synthetic:${mode}`,
      runs: subset.length,
      feasibleRuns: subset.filter((run) => run.feasibleRouteFound).length,
      averageElapsedMs: round(average(subset.map((run) => run.elapsedMs))),
      averageCandidates: round(average(subset.map((run) => run.candidateCount))),
      averageLocalImprovementPercent: round(
        average(
          subset
            .map((run) => run.localSearchImprovementPercent)
            .filter((value): value is number => value !== null),
        ),
      ),
    };
  });
  const scenarioGroups = new Map<string, BenchmarkRun[]>();
  for (const run of runs) {
    scenarioGroups.set(run.scenarioId, [
      ...(scenarioGroups.get(run.scenarioId) ?? []),
      run,
    ]);
  }
  const providerOrderDifferences = [...scenarioGroups.values()].filter(
    (group) => new Set(group.map((run) => run.recommendedOrder.join('>'))).size > 1,
  ).length;
  const heuristicWins = new Map<string, number>();
  for (const run of runs.filter((item) => item.feasibleRouteFound)) {
    for (const heuristic of run.generatedBy) {
      heuristicWins.set(heuristic, (heuristicWins.get(heuristic) ?? 0) + 1);
    }
  }
  return {
    byProvider,
    providerOrderDifferences,
    scenariosComparedAcrossProviders: scenarioGroups.size,
    heuristicWins: [...heuristicWins.entries()]
      .map(([heuristic, wins]) => ({ heuristic, wins }))
      .sort((left, right) => right.wins - left.wins || left.heuristic.localeCompare(right.heuristic)),
    infeasibleRuns: runs
      .filter((run) => !run.feasibleRouteFound)
      .map((run) => ({ scenarioId: run.scenarioId, provider: run.provider, violations: run.violations })),
  };
}

function toCsv(rows: CandidateBenchmarkRow[]): string {
  const headers = [
    'scenarioId',
    'provider',
    'executionMode',
    'rank',
    'algorithms',
    'initialSequence',
    'finalSequence',
    'feasible',
    'violations',
    'totalWorkMinutes',
    'drivingMinutes',
    'serviceMinutes',
    'waitingMinutes',
    'distanceKm',
    'tonneKilometers',
    'directionalityPenalty',
    'maneuverPenalty',
    'lateMinutes',
    'rawScoreComponents',
    'normalizedScoreComponents',
    'totalScore',
    'iterations',
    'elapsedMs',
    'explanations',
    'warnings',
  ];
  return [
    headers.join(','),
    ...rows.map((row) =>
      headers
        .map((header) => csvCell(row[header as keyof CandidateBenchmarkRow]))
        .join(','),
    ),
  ].join('\n');
}

function toMarkdown(report: {
  generatedAt: string;
  dataQuality: string;
  scenarioCount: number;
  runCount: number;
  aggregates: ReturnType<typeof aggregate>;
  runs: BenchmarkRun[];
}): string {
  const performance = report.runs.filter((run) => run.scenarioId.startsWith('performance-'));
  return `# Routing Engine v0.1 benchmark

Sugeneruota: ${report.generatedAt}

> ${report.dataQuality}

## Santrauka

- Bazinių scenarijų: ${report.scenarioCount}
- Visų paleidimų: ${report.runCount}
- Scenarijų, kuriuose skirtingi sintetiniai tiekėjai parinko kitą seką: ${report.aggregates.providerOrderDifferences} iš ${report.aggregates.scenariosComparedAcrossProviders}
- Neįvykdomų paleidimų: ${report.aggregates.infeasibleRuns.length}

| Tiekėjas | Paleidimai | Įvykdomi | Vid. trukmė, ms | Vid. kandidatai | Vid. local-search pagerėjimas |
|---|---:|---:|---:|---:|---:|
${report.aggregates.byProvider
  .map(
    (row) =>
      `| ${row.provider} | ${row.runs} | ${row.feasibleRuns} | ${row.averageElapsedMs} | ${row.averageCandidates} | ${row.averageLocalImprovementPercent}% |`,
  )
  .join('\n')}

## Heuristikų laimėjimai

${report.aggregates.heuristicWins
  .map((row) => `- ${row.heuristic}: ${row.wins}`)
  .join('\n')}

## Scenarijų signalai

- Svorio scenarijai: ${report.runs.filter((run) => run.scenarioId.includes('heavy') || run.scenarioId.includes('weight')).map((run) => `${run.scenarioId}/${run.provider}: ${run.recommendedOrder.join('→')}`).join('; ')}
- Laiko langų scenarijai: ${report.runs.filter((run) => run.scenarioId.includes('window') || run.scenarioId.includes('early')).map((run) => `${run.scenarioId}/${run.provider}: ${run.feasibleRouteFound ? 'įvykdomas' : 'neįvykdomas'}`).join('; ')}
- Neįvykdomi: ${report.aggregates.infeasibleRuns.map((run) => `${run.scenarioId}/${run.provider} (${run.violations.join(', ')})`).join('; ') || 'nėra'}

## Našumo scenarijai

| Scenarijus | Tiekėjas | Trukmė, ms | Kandidatai | Įvykdomas |
|---|---|---:|---:|---|
${performance
  .map(
    (run) =>
      `| ${run.scenarioId} | ${run.provider} | ${run.elapsedMs} | ${run.candidateCount} | ${run.feasibleRouteFound ? 'taip' : 'ne'} |`,
  )
  .join('\n')}

## Interpretavimo riba

Šis paleidimas patvirtina bendrą pipeline, deterministinius scenarijus, hard apribojimų auditą ir tai, kad skirtingos matricos gali pakeisti rekomendaciją. Jis **nepalygina realių HERE ir Google duomenų**, nes API raktai ir gateway šiame paleidime nenaudoti.
`;
}

function average(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function nullableRound(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : round(value);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
