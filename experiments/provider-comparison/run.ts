import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { RoutingEngine } from './optimizer';
import {
  GoogleTravelCostProvider,
  HereTravelCostProvider,
  MockTravelCostProvider,
} from './providers';
import { comparisonScenario } from './scenario';
import type { RouteOptimizationResult, TravelCostProvider } from './types';

export type ProviderComparisonReport = {
  experiment: string;
  generatedAt: string;
  scenarioId: string;
  realCallsRequested: boolean;
  results: RouteOptimizationResult[];
  warning: string;
};

export async function runComparison(
  useRealCalls = process.env.ROUTING_REAL_CALLS === '1',
): Promise<ProviderComparisonReport> {
  const providers: TravelCostProvider[] = [
    new MockTravelCostProvider(),
    new HereTravelCostProvider({
      useRealApi: useRealCalls,
      endpoint: process.env.HERE_MATRIX_GATEWAY_URL,
    }),
    new GoogleTravelCostProvider({
      useRealApi: useRealCalls,
      endpoint: process.env.GOOGLE_MATRIX_GATEWAY_URL,
    }),
  ];
  const results: RouteOptimizationResult[] = [];
  for (const provider of providers) {
    results.push(await new RoutingEngine(provider).optimize(comparisonScenario.request));
  }
  const realCount = results.filter((result) => result.executionMode === 'real').length;
  return {
    experiment: 'Routing Engine v0.1 provider comparison',
    generatedAt: new Date().toISOString(),
    scenarioId: comparisonScenario.id,
    realCallsRequested: useRealCalls,
    results,
    warning:
      realCount === 2
        ? 'HERE ir Google rezultatai gauti per sukonfigūruotus gateway.'
        : 'HERE / Google rezultatai yra aiškiai pažymėti stub; realių tiekėjų kokybės iš jų spręsti negalima.',
  };
}

async function main(): Promise<void> {
  const outputArgument = process.argv.find((argument) => argument.startsWith('--out='));
  const outputPath = resolve(
    outputArgument?.slice('--out='.length) ??
      'experiments/provider-comparison/report.json',
  );
  const report = await runComparison();
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.table(
    report.results.map((result) => ({
      provider: result.provider,
      mode: result.executionMode,
      feasible: result.feasibleRouteFound,
      minutes: result.recommended?.totalWorkMinutes,
      km: result.recommended?.totalDistanceKm,
      tonneKm: result.recommended?.tonneKilometers,
      score: result.recommended?.totalScore,
      order: result.recommended?.stopSequence.join(' → '),
    })),
  );
  console.log(report.warning);
  console.log(`JSON report: ${outputPath}`);
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
