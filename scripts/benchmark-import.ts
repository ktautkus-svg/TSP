import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { parseDeliveries } from '../src/application/import/delivery-parser';
import { PdfImportPipeline, PassthroughPdfPageExtractor } from '../src/application/import/pdf-import';
import type { ImportDocument } from '../src/domain/import/models';
import { MockOcrProvider } from '../src/infrastructure/import/ocr/mock-ocr-provider';

type Measurement = {
  scenario: string;
  units: number;
  durationMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  rssBeforeMb: number;
  rssAfterMb: number;
  heapBeforeMb: number;
  heapAfterMb: number;
  outputCount: number;
};

async function main() {
  const measurements: Measurement[] = [];
  for (const pages of [1, 5, 10]) {
    measurements.push(await measure(`mock-pdf-${pages}-pages`, pages, async () => {
      const text = deliveryText(12);
      const document: ImportDocument = {
        id: `pdf-${pages}`,
        kind: 'pdf',
        uri: null,
        fileName: 'benchmark.pdf',
        mimeType: 'application/pdf',
        sizeBytes: null,
        pageCount: pages,
        createdAt: new Date().toISOString(),
        pastedText: text,
      };
      const result = await new PdfImportPipeline(
        new PassthroughPdfPageExtractor(),
        new MockOcrProvider(text),
      ).recognize(document);
      return result.blocks.length;
    }));
  }
  for (const deliveries of [100, 200]) {
    measurements.push(await measure(`parse-${deliveries}-deliveries`, deliveries, async () =>
      parseDeliveries(deliveryText(deliveries)).length));
  }
  const report = {
    generatedAt: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    methodology: 'Vienas šiltas Node.js proceso paleidimas; CPU – process.cpuUsage; RAM – process.memoryUsage prieš ir po scenarijaus.',
    measurements,
  };
  await mkdir('reports', { recursive: true });
  await writeFile('reports/OCR_BENCHMARK.json', `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function measure(
  scenario: string,
  units: number,
  run: () => Promise<number>,
): Promise<Measurement> {
  const memoryBefore = process.memoryUsage();
  const cpuBefore = process.cpuUsage();
  const started = performance.now();
  const outputCount = await run();
  const durationMs = performance.now() - started;
  const cpu = process.cpuUsage(cpuBefore);
  const memoryAfter = process.memoryUsage();
  return {
    scenario,
    units,
    durationMs: round(durationMs),
    cpuUserMs: round(cpu.user / 1000),
    cpuSystemMs: round(cpu.system / 1000),
    rssBeforeMb: mb(memoryBefore.rss),
    rssAfterMb: mb(memoryAfter.rss),
    heapBeforeMb: mb(memoryBefore.heapUsed),
    heapAfterMb: mb(memoryAfter.heapUsed),
    outputCount,
  };
}

function deliveryText(count: number): string {
  return Array.from({ length: count }, (_, index) =>
    `Gedimino pr. ${index + 1}, Vilnius\nUžsakymas: BENCH-${index + 1}\n${100 + index} kg\n+370600${String(index).padStart(5, '0')}`,
  ).join('\n\n');
}

function mb(bytes: number): number {
  return round(bytes / 1024 / 1024);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
