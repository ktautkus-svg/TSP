export type LearnedCoordinateStatus = 'used' | 'imprecise' | 'rejected' | 'needs_samples';

/** Server document and sync payload. `canonicalId` is the stable address key. */
export type LearnedCoordinateSyncRecord = {
  canonicalId: string;
  address: string;
  normalizedAddress: string;
  geocodeLatitude: number | null;
  geocodeLongitude: number | null;
  learnedLatitude: number | null;
  learnedLongitude: number | null;
  accuracyM: number | null;
  sampleCount: number;
  lastSampledAt: string | null;
  sampleKey: string;
  version: number;
  appliedSampleKeys: string[];
  status: LearnedCoordinateStatus;
  driverName?: string | null;
  deviceId?: string | null;
  recipient?: string | null;
  routeNumber?: string | null;
  orderNumber?: string | null;
  rejectionReason?: string | null;
  updatedAt?: string | null;
};

export type LearnedCoordinateMergeReason = 'created' | 'duplicate' | 'older' | 'updated';

export type LearnedCoordinateMergeOutcome = {
  record: LearnedCoordinateSyncRecord;
  applied: boolean;
  reason: LearnedCoordinateMergeReason;
};

const APPLIED_KEY_LIMIT = 32;

/** Stable server id. Same normalization as the local park-memory key. */
export function learnedCoordinateId(address: string | null | undefined): string {
  return (address ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('lt-LT')
    .replace(/\s+/g, ' ')
    .replace(/\s*([,;])\s*/g, '$1')
    .trim();
}

export function learnedSampleKey(input: {
  deviceId?: string | null;
  lastSampledAt?: string | null;
  learnedLatitude?: number | null;
  learnedLongitude?: number | null;
  sampleCount?: number | null;
}): string {
  const latitude = Number.isFinite(input.learnedLatitude) ? (input.learnedLatitude as number).toFixed(6) : 'na';
  const longitude = Number.isFinite(input.learnedLongitude) ? (input.learnedLongitude as number).toFixed(6) : 'na';
  return [
    (input.deviceId ?? 'device').trim() || 'device',
    input.lastSampledAt ?? 'undated',
    latitude,
    longitude,
    String(input.sampleCount ?? 0),
  ].join('|');
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function statusOf(input: {
  status?: unknown;
  learnedLatitude: number | null;
  learnedLongitude: number | null;
  accuracyM: number | null;
  sampleCount: number;
}): LearnedCoordinateStatus {
  if (input.status === 'used' || input.status === 'imprecise' || input.status === 'rejected' || input.status === 'needs_samples') {
    return input.status;
  }
  if (input.learnedLatitude === null || input.learnedLongitude === null) return 'needs_samples';
  if (input.sampleCount < 1) return 'needs_samples';
  if (input.accuracyM !== null && input.accuracyM > 65) return 'imprecise';
  return 'used';
}

export function normalizeLearnedCoordinate(
  raw: Record<string, unknown>,
  actor: string,
): LearnedCoordinateSyncRecord | null {
  const address = text(raw.address) || text(raw.originalAddress);
  const normalizedAddress = text(raw.normalizedAddress) || address;
  const canonicalId = text(raw.canonicalId) || learnedCoordinateId(normalizedAddress || address);
  if (!canonicalId || !address) return null;
  const learnedLatitude = finite(raw.learnedLatitude);
  const learnedLongitude = finite(raw.learnedLongitude);
  const sampleCount = Math.max(0, Math.round(finite(raw.sampleCount) ?? (learnedLatitude === null ? 0 : 1)));
  const lastSampledAt = text(raw.lastSampledAt) || null;
  const deviceId = text(raw.deviceId) || actor || null;
  const sampleKey = text(raw.sampleKey) || learnedSampleKey({
    deviceId,
    lastSampledAt,
    learnedLatitude,
    learnedLongitude,
    sampleCount,
  });
  const applied = Array.isArray(raw.appliedSampleKeys)
    ? raw.appliedSampleKeys.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
  return {
    canonicalId,
    address,
    normalizedAddress,
    geocodeLatitude: finite(raw.geocodeLatitude),
    geocodeLongitude: finite(raw.geocodeLongitude),
    learnedLatitude,
    learnedLongitude,
    accuracyM: finite(raw.accuracyM),
    sampleCount,
    lastSampledAt,
    sampleKey,
    version: Math.max(0, Math.round(finite(raw.version) ?? 0)),
    appliedSampleKeys: applied.includes(sampleKey) ? applied : [...applied, sampleKey].slice(-APPLIED_KEY_LIMIT),
    status: statusOf({ status: raw.status, learnedLatitude, learnedLongitude, accuracyM: finite(raw.accuracyM), sampleCount }),
    driverName: text(raw.driverName) || null,
    deviceId,
    recipient: text(raw.recipient) || null,
    routeNumber: text(raw.routeNumber) || null,
    orderNumber: text(raw.orderNumber) || null,
    rejectionReason: text(raw.rejectionReason) || null,
    updatedAt: text(raw.updatedAt) || lastSampledAt,
  };
}

function sampleTime(record: LearnedCoordinateSyncRecord): number {
  const parsed = Date.parse(record.lastSampledAt ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Lower accuracy meters is a better fix. Missing accuracy loses to a real fix. */
function accuracyRank(record: LearnedCoordinateSyncRecord): number {
  return record.accuracyM !== null && Number.isFinite(record.accuracyM) ? -record.accuracyM : Number.NEGATIVE_INFINITY;
}

/**
 * Newer sample time wins. Equal time uses version, then GPS accuracy.
 * A repeated sample key is a no-op so retries cannot inflate sampleCount.
 * An older device cannot replace a newer server record.
 */
export function mergeLearnedCoordinate(
  existing: LearnedCoordinateSyncRecord | null,
  incoming: LearnedCoordinateSyncRecord,
  now = new Date().toISOString(),
): LearnedCoordinateMergeOutcome {
  if (!existing) {
    const created: LearnedCoordinateSyncRecord = {
      ...incoming,
      version: Math.max(1, incoming.version || 1),
      appliedSampleKeys: [incoming.sampleKey].slice(-APPLIED_KEY_LIMIT),
      sampleCount: Math.max(1, incoming.sampleCount),
      updatedAt: now,
    };
    return { record: created, applied: true, reason: 'created' };
  }
  if (existing.appliedSampleKeys.includes(incoming.sampleKey) || existing.sampleKey === incoming.sampleKey) {
    return { record: existing, applied: false, reason: 'duplicate' };
  }
  const timeDelta = sampleTime(incoming) - sampleTime(existing);
  const versionDelta = incoming.version - existing.version;
  const accuracyDelta = accuracyRank(incoming) - accuracyRank(existing);
  const incomingWins = timeDelta > 0 || (timeDelta === 0 && (versionDelta > 0 || (versionDelta === 0 && accuracyDelta > 0)));
  if (!incomingWins) return { record: existing, applied: false, reason: 'older' };
  const appliedSampleKeys = [...existing.appliedSampleKeys, incoming.sampleKey].slice(-APPLIED_KEY_LIMIT);
  return {
    applied: true,
    reason: 'updated',
    record: {
      ...existing,
      ...incoming,
      canonicalId: existing.canonicalId,
      address: incoming.address || existing.address,
      normalizedAddress: incoming.normalizedAddress || existing.normalizedAddress,
      geocodeLatitude: incoming.geocodeLatitude ?? existing.geocodeLatitude,
      geocodeLongitude: incoming.geocodeLongitude ?? existing.geocodeLongitude,
      sampleCount: Math.max(existing.sampleCount, incoming.sampleCount),
      version: existing.version + 1,
      appliedSampleKeys,
      sampleKey: incoming.sampleKey,
      updatedAt: now,
    },
  };
}

/** In-memory stand-in for the Firestore store. Production and tests share the merge. */
export class InMemoryLearnedCoordinateStore {
  private readonly records = new Map<string, LearnedCoordinateSyncRecord>();

  list(): LearnedCoordinateSyncRecord[] {
    return [...this.records.values()].sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''));
  }

  upsert(raw: Record<string, unknown>, actor: string, now = new Date().toISOString()): LearnedCoordinateMergeOutcome | null {
    const incoming = normalizeLearnedCoordinate(raw, actor);
    if (!incoming) return null;
    const outcome = mergeLearnedCoordinate(this.records.get(incoming.canonicalId) ?? null, incoming, now);
    if (outcome.applied) this.records.set(outcome.record.canonicalId, outcome.record);
    return outcome;
  }
}
