import { parseDeliveryTimeWindow } from '@/application/import/logistics-excel-v1';
import type { DraftStopInput } from '@/application/routes/route-commands';
import type { ExcelDeliveryGroup, ExcelImportPreview, ExcelSourceRow } from '@/domain/import/excel-models';
import type { ImportResult, ParsedDelivery, ResolvedAddressCandidate } from '@/domain/import/models';
import type { DraftShipmentLineInput } from '@/domain/shipment-line';
import type { PlanningMode } from '@/domain/route';

export function excelPreviewToImportResult(preview: ExcelImportPreview): ImportResult {
  const deliveries = preview.groups.map((group) => groupToDelivery(group));
  const parserConfidence = deliveries.length
    ? deliveries.reduce((sum, delivery) => sum + delivery.parserConfidence, 0) / deliveries.length
    : 0;
  return {
    auditId: preview.id,
    document: {
      id: preview.id,
      kind: 'excel',
      uri: null,
      fileName: preview.fileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: null,
      pageCount: 1,
      createdAt: preview.createdAt,
    },
    ocr: {
      provider: 'mock',
      providerVersion: 'direct-xlsx-cells-1.0.0',
      text: '',
      confidence: 1,
      blocks: [],
      pageCount: 1,
      processingMs: 0,
      warnings: ['DIRECT_XLSX_CELL_IMPORT_NO_OCR'],
    },
    deliveries,
    duplicates: [],
    quality: {
      ocrConfidence: 1,
      parserConfidence,
      addressConfidence: 0,
      importConfidence: parserConfidence,
      overallConfidence: parserConfidence,
    },
    requiresReview: true,
  };
}

/** Keeps previously resolved addresses when region filtering rebuilds the preview. */
export function mergeImportResult(previous: ImportResult | null | undefined, next: ImportResult): ImportResult {
  if (!previous) return next;
  const previousById = new Map(previous.deliveries.map((delivery) => [delivery.id, delivery]));
  const deliveries = next.deliveries.map((delivery) => {
    const prior = previousById.get(delivery.id);
    if (!prior) return delivery;
    const addressUnchanged = (prior.addressQuery ?? prior.address.value) === (delivery.addressQuery ?? delivery.address.value);
    if (!addressUnchanged) return delivery;
    return {
      ...delivery,
      address: prior.address.manuallyCorrected ? prior.address : delivery.address,
      addressQuery: prior.addressQuery ?? delivery.addressQuery,
      recipient: prior.recipient.manuallyCorrected ? prior.recipient : delivery.recipient,
      weightKg: prior.weightKg.manuallyCorrected ? prior.weightKg : delivery.weightKg,
      deliveryTime: prior.deliveryTime.manuallyCorrected ? prior.deliveryTime : delivery.deliveryTime,
      addressCandidates: prior.addressCandidates.length ? prior.addressCandidates : delivery.addressCandidates,
      selectedAddress: prior.selectedAddress ?? delivery.selectedAddress,
      validationState: prior.selectedAddress || prior.validationState !== 'pending'
        ? prior.validationState
        : delivery.validationState,
      addressConfidence: prior.addressConfidence || delivery.addressConfidence,
      importConfidence: Math.max(prior.importConfidence, delivery.importConfidence),
    };
  });
  const addressConfidence = deliveries.length
    ? deliveries.reduce((sum, delivery) => sum + delivery.addressConfidence, 0) / deliveries.length
    : 0;
  const parserConfidence = deliveries.length
    ? deliveries.reduce((sum, delivery) => sum + delivery.parserConfidence, 0) / deliveries.length
    : 0;
  return {
    ...next,
    deliveries,
    quality: {
      ...next.quality,
      parserConfidence,
      addressConfidence,
      importConfidence: parserConfidence,
      overallConfidence: (parserConfidence + addressConfidence) / 2,
    },
    requiresReview: deliveries.some((delivery) => delivery.validationState !== 'valid' || !delivery.selectedAddress),
  };
}

export function excelPreviewToDraftStops(
  preview: ExcelImportPreview,
  deliveries: ParsedDelivery[],
): DraftStopInput[] {
  const deliveryByGroup = new Map(deliveries.map((delivery) => [delivery.id, delivery]));
  const rowById = new Map(preview.rows.map((row) => [row.id, row]));
  const confirmed = preview.groups.map((group) => ({
    group,
    delivery: deliveryByGroup.get(group.id),
    rows: group.lineIds.map((id) => rowById.get(id)).filter((row): row is ExcelSourceRow => Boolean(row && !row.excluded)),
  })).filter((entry): entry is { group: ExcelDeliveryGroup; delivery: ParsedDelivery; rows: ExcelSourceRow[] } =>
    Boolean(entry.delivery?.selectedAddress && entry.delivery.validationState === 'valid'),
  );

  const physicalGroups = new Map<string, typeof confirmed>();
  for (const entry of confirmed) {
    const candidate = entry.delivery.selectedAddress!;
    const key = confirmedAddressKey(candidate);
    const bucket = physicalGroups.get(key) ?? [];
    bucket.push(entry);
    physicalGroups.set(key, bucket);
  }

  return [...physicalGroups.values()].map((entries, index) => {
    const candidate = entries[0]!.delivery.selectedAddress!;
    const rows = entries.flatMap((entry) => entry.rows);
    const orderNumbers = unique(rows.map((row) => row.orderNumber));
    const correctedRecipients = unique(entries.map((entry) => entry.delivery.recipient.manuallyCorrected
      ? String(entry.delivery.recipient.value ?? '')
      : null));
    const recipients = correctedRecipients.length ? correctedRecipients : unique(rows.map((row) => row.recipient));
    const totalGrams = rows.reduce((sum, row) => sum + (row.weightGrams ?? 0), 0);
    const allWeightsUnknown = rows.every((row) => row.weightGrams === null);
    const correctedWeight = entries.length === 1 && entries[0]!.delivery.weightKg.manuallyCorrected
      ? entries[0]!.delivery.weightKg.value
      : null;
    const correctedTime = entries.find((entry) => entry.delivery.deliveryTime.manuallyCorrected)?.delivery.deliveryTime.value;
    const mergedFrom = entries.map((entry) => entry.group.deliveryTimeFrom).filter(Boolean).sort().at(-1) ?? null;
    const mergedTo = entries.map((entry) => entry.group.deliveryTimeTo).filter(Boolean).sort()[0] ?? null;
    const parsedCorrectedTime = correctedTime ? parseDeliveryTimeWindow(correctedTime) : null;
    const from = parsedCorrectedTime?.from ?? mergedFrom;
    const to = parsedCorrectedTime?.to ?? mergedTo;
    return {
      sourceStopId: `excel:${preview.id}:${entries.map((entry) => entry.group.id).join('+')}`,
      originalOrder: index + 1,
      orderNumber: orderNumbers[0] ?? null,
      recipient: recipients.join(' / '),
      originalAddress: entries[0]!.delivery.address.value ?? entries[0]!.group.originalAddress,
      geocodingQuery: candidate.normalizedAddress,
      normalizedAddress: candidate.normalizedAddress,
      addressValidationState: 'auto_confirmed',
      geocodingError: null,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      deliveryTimeFrom: from,
      deliveryTimeTo: to,
      requiredTimeWindow: Boolean(from && to),
      weightKg: correctedWeight ?? (allWeightsUnknown ? null : totalGrams / 1000),
      phone: null,
      notes: null,
      shipmentLines: rows.map(rowToShipmentLine),
    } satisfies DraftStopInput;
  });
}

export function unresolvedExcelIssues(
  preview: ExcelImportPreview,
  deliveries: ParsedDelivery[],
  planningMode: PlanningMode = 'with_time_windows',
): string[] {
  const deliveryByGroup = new Map(deliveries.map((delivery) => [delivery.id, delivery]));
  const issues: string[] = [];
  for (const group of preview.groups) {
    const delivery = deliveryByGroup.get(group.id);
    if (!delivery?.selectedAddress || delivery.validationState !== 'valid') issues.push(`Nepatvirtintas adresas: ${group.originalAddress}`);
    if (
      planningMode === 'with_time_windows' &&
      group.issueCodes.includes('TIME_WINDOW_CONFLICT') &&
      !delivery?.deliveryTime.manuallyCorrected
    ) {
      issues.push(`Laiko langų konfliktas: ${group.normalizedAddress}`);
    }
    if (group.issueCodes.includes('ADDRESS_SOURCE_CONFLICT') && !delivery?.address.manuallyCorrected) {
      issues.push(`D ir E adresų konfliktas: ${group.originalAddress}`);
    }
  }
  return issues;
}

function groupToDelivery(group: ExcelDeliveryGroup): ParsedDelivery {
  const weightKg = group.knownWeightLineCount === 0 ? null : group.totalWeightGrams / 1000;
  const deliveryTime = group.deliveryTimeFrom && group.deliveryTimeTo
    ? `${group.deliveryTimeFrom}-${group.deliveryTimeTo}`
    : null;
  const parserConfidence = group.issueCodes.length === 0 ? 0.96 : 0.55;
  return {
    id: group.id,
    sourcePage: null,
    rawText: `${group.orderNumbers.join(', ')} | ${group.originalAddress}`,
    address: field(group.normalizedAddress, parserConfidence, group.originalAddress),
    addressQuery: group.normalizedAddress,
    orderNumber: field(group.orderNumbers[0] ?? null, 1, group.orderNumbers.join(', ')),
    weightKg: field(weightKg, weightKg === null ? 0 : 1, `${group.totalWeightGrams} g`),
    deliveryTime: field(deliveryTime, deliveryTime ? 1 : 0, null),
    phone: field(null, 0, null),
    recipient: field(group.recipients.join(' / ') || null, group.recipients.length ? 0.9 : 0, null),
    notes: field(null, 0, null),
    parserConfidence,
    addressConfidence: 0,
    importConfidence: parserConfidence,
    addressCandidates: [],
    selectedAddress: null,
    validationState: 'pending',
  };
}

function rowToShipmentLine(row: ExcelSourceRow): DraftShipmentLineInput {
  return {
    sourceImportId: row.sourceImportId,
    sourceSheetName: row.sourceSheetName,
    sourceRowNumber: row.sourceRowNumber,
    orderNumber: row.orderNumber,
    weightGrams: row.weightGrams,
    deliveryTimeFrom: row.deliveryTimeFrom,
    deliveryTimeTo: row.deliveryTimeTo,
    supplierPrefix: row.supplierPrefix,
    recipient: row.recipient,
    routeCode: row.routeCode,
    rawColumnD: row.rawColumnD,
    rawColumnE: row.rawColumnE,
    rawRow: row.rawRow,
  };
}

function confirmedAddressKey(candidate: ResolvedAddressCandidate): string {
  const coordinateKey = `${candidate.latitude.toFixed(5)}:${candidate.longitude.toFixed(5)}`;
  const addressKey = candidate.normalizedAddress.toLocaleLowerCase('lt-LT').replace(/[^a-ząčęėįšųūž0-9]/giu, '');
  return Number.isFinite(candidate.latitude) && Number.isFinite(candidate.longitude)
    ? `coordinates:${coordinateKey}`
    : `address:${addressKey}`;
}

function field<T>(value: T | null, confidence: number, evidence: string | null) {
  return { value, confidence, evidence, manuallyCorrected: false };
}

function unique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
}
