import { unresolvedExcelIssues } from '@/application/import/excel-route-mapper';
import type { ExcelImportPreview } from '@/domain/import/excel-models';
import type { ImportResult, ParsedDelivery } from '@/domain/import/models';
import type { PlanningMode, RouteEndpoint } from '@/domain/route';

export function hasRouteCoordinates(endpoint: RouteEndpoint | null | undefined): boolean {
  return endpoint?.latitude !== null && endpoint?.latitude !== undefined
    && endpoint.longitude !== null && endpoint.longitude !== undefined
    && Number.isFinite(endpoint.latitude) && Number.isFinite(endpoint.longitude);
}

export function getRouteCreationBlockers(input: {
  result: ImportResult | null;
  excelPreview: ExcelImportPreview | null;
  planningMode: PlanningMode;
  warehouseEndpoint: RouteEndpoint | null;
  homeEndpoint: RouteEndpoint | null;
  endMode: 'warehouse' | 'home';
  manuallyResolvedRowIds?: ReadonlySet<string>;
}): string[] {
  const blockers: string[] = [];
  if (!input.result?.deliveries.length) blockers.push('Importe nėra nė vieno pristatymo taško.');
  if (!hasRouteCoordinates(input.warehouseEndpoint)) blockers.push('Sandėlio adresui trūksta patvirtintų koordinačių.');
  if (input.endMode === 'home' && !hasRouteCoordinates(input.homeEndpoint)) blockers.push('Namų adresui trūksta patvirtintų koordinačių.');

  const deliveries = input.result?.deliveries ?? [];
  const relevantDeliveries = input.excelPreview
    ? input.excelPreview.groups.map((group) => deliveries.find((delivery) => delivery.id === group.id)).filter((delivery): delivery is ParsedDelivery => Boolean(delivery))
    : deliveries;
  if (input.excelPreview && relevantDeliveries.length !== input.excelPreview.groups.length) {
    blockers.push('Atkurto importo duomenys paseno. Paspauskite „Patikrinti pataisytus adresus“.');
  }
  for (const [index, delivery] of relevantDeliveries.entries()) {
    if (!delivery.address.value || !delivery.selectedAddress || delivery.validationState !== 'valid') {
      blockers.push(`Pristatymo taškas ${index + 1}: adresas dar nepatvirtintas.`);
    }
  }

  if (input.excelPreview) {
    if (!input.excelPreview.mappingRecognized) blockers.push('Reikia patvirtinti Excel stulpelių susiejimą.');
    const unresolvedRows = input.excelPreview.rows.filter((row) =>
      !row.excluded && !row.normalizedAddress && !input.manuallyResolvedRowIds?.has(row.id),
    );
    if (unresolvedRows.length > 0) blockers.push(`${unresolvedRows.length} Excel eilutėms neatpažintas adresas.`);
    for (const issue of unresolvedExcelIssues(input.excelPreview, relevantDeliveries, input.planningMode)) blockers.push(issue);
    if (input.excelPreview.groups.some((group) => group.issueCodes.includes('INVALID_WEIGHT') || group.issueCodes.includes('NEGATIVE_WEIGHT'))) {
      blockers.push('Bent viename taške yra neteisinga svorio reikšmė.');
    }
  }
  return [...new Set(blockers)];
}
