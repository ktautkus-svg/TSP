import { haversineKm } from '@/domain/routing/evaluation/geo';

export type LearnedCoordinateStatus = 'used' | 'imprecise' | 'rejected' | 'needs_samples';

export type LearnedCoordinateSample = {
  address: string;
  normalizedAddress: string;
  recipient?: string | null;
  routeNumber?: string | null;
  orderNumber?: string | null;
  geocodeLatitude: number | null;
  geocodeLongitude: number | null;
  learnedLatitude: number | null;
  learnedLongitude: number | null;
  sampleCount: number;
  lastSampledAt: string | null;
  accuracyM: number | null;
  driverName?: string | null;
  deviceId?: string | null;
  status: LearnedCoordinateStatus;
  rejectionReason?: string | null;
  updatedAt?: string | null;
};

export type LearnedCoordinateRow = LearnedCoordinateSample & {
  differenceM: number | null;
};

const REJECTION_LABEL: Record<string, string> = {
  missing_fix: 'Nėra GPS taško',
  stale: 'Mėginys pasenęs',
  inaccurate: 'GPS tikslumas per prastas',
  too_far: 'Per toli nuo sustojimo',
  admin_removed: 'Administratoriaus pašalintas taškas',
};

export function learnedCoordinateDifferenceM(row: Pick<LearnedCoordinateSample, 'geocodeLatitude' | 'geocodeLongitude' | 'learnedLatitude' | 'learnedLongitude'>): number | null {
  if (
    !Number.isFinite(row.geocodeLatitude)
    || !Number.isFinite(row.geocodeLongitude)
    || !Number.isFinite(row.learnedLatitude)
    || !Number.isFinite(row.learnedLongitude)
  ) return null;
  return Math.round(haversineKm(
    { latitude: row.geocodeLatitude as number, longitude: row.geocodeLongitude as number },
    { latitude: row.learnedLatitude as number, longitude: row.learnedLongitude as number },
  ) * 1000);
}

export function toLearnedCoordinateRow(sample: LearnedCoordinateSample): LearnedCoordinateRow {
  return { ...sample, differenceM: learnedCoordinateDifferenceM(sample) };
}

export function filterLearnedCoordinates(rows: readonly LearnedCoordinateRow[], input: { address?: string; status?: LearnedCoordinateStatus | 'all' }): LearnedCoordinateRow[] {
  const query = input.address?.trim().toLocaleLowerCase('lt') ?? '';
  return rows.filter((row) => {
    if (input.status && input.status !== 'all' && row.status !== input.status) return false;
    if (!query) return true;
    return [row.address, row.normalizedAddress, row.recipient, row.routeNumber, row.orderNumber]
      .some((value) => (value ?? '').toLocaleLowerCase('lt').includes(query));
  });
}

export function learnedCoordinateCsv(rows: readonly LearnedCoordinateRow[]): string {
  const header = [
    'originalus_adresas',
    'normalizuotas_adresas',
    'gavejas',
    'marsrutas_ar_uzsakymas',
    'geokodavimo_lat',
    'geokodavimo_lng',
    'ismokta_lat',
    'ismokta_lng',
    'skirtumas_m',
    'meginiu_skaicius',
    'paskutinis_meginys',
    'gps_tikslumas_m',
    'vairuotojas_ar_irenginys',
    'busena',
    'atmestimo_priezastis',
  ];
  const lines = rows.map((row) => [
    row.address,
    row.normalizedAddress,
    row.recipient ?? '',
    row.routeNumber ?? row.orderNumber ?? '',
    row.geocodeLatitude ?? '',
    row.geocodeLongitude ?? '',
    row.learnedLatitude ?? '',
    row.learnedLongitude ?? '',
    row.differenceM ?? '',
    row.sampleCount,
    row.lastSampledAt ?? '',
    row.accuracyM ?? '',
    row.driverName ?? row.deviceId ?? '',
    row.status,
    row.rejectionReason ? (REJECTION_LABEL[row.rejectionReason] ?? row.rejectionReason) : '',
  ].map(csvCell).join(','));
  return [header.join(','), ...lines].join('\n');
}

export function rejectionReasonLabel(reason: string | null | undefined): string {
  if (!reason) return '';
  return REJECTION_LABEL[reason] ?? reason;
}

/** A newer sample wins. An older device must not replace a newer learned pin. */
export function shouldKeepLearnedPin(existingUpdatedAt: string | null | undefined, incomingUpdatedAt: string): boolean {
  if (!existingUpdatedAt) return false;
  const existing = Date.parse(existingUpdatedAt);
  const incoming = Date.parse(incomingUpdatedAt);
  if (!Number.isFinite(existing) || !Number.isFinite(incoming)) return false;
  return existing > incoming;
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
