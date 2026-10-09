import type { SQLiteDatabase } from 'expo-sqlite';

import { LocationParkMemoryRepository } from '@/database/repositories/location-park-memory-repository';
import { employeeApi, getEmployeeSession } from '@/infrastructure/auth/employee-session';
import {
  learnedCoordinateId,
  learnedSampleKey,
  normalizeLearnedCoordinate,
  type LearnedCoordinateMergeOutcome,
  type LearnedCoordinateSyncRecord,
} from '@/domain/learned-coordinate-sync';
import type { LearnedParkPin } from '@/domain/location-park-memory';
import { devWarn } from '@/ui/dev-log';

import { applyParkPinToAddress, type StopParkAddress } from './remember-park-pin';

export type LearnedCoordinateSyncTransport = {
  push(pins: LearnedCoordinateSyncRecord[]): Promise<{ results: LearnedCoordinateMergeOutcome[] }>;
  pull(): Promise<{ pins: LearnedCoordinateSyncRecord[] }>;
};

export type LearnedCoordinateSyncReport = {
  uploaded: number;
  kept: number;
  pulled: number;
  pending: number;
};

let transport: LearnedCoordinateSyncTransport | null = null;
let deviceIdOverride: string | null = null;

export function setLearnedCoordinateSyncTransport(next: LearnedCoordinateSyncTransport | null): void {
  transport = next;
}

export function setLearnedCoordinateDeviceId(deviceId: string | null): void {
  deviceIdOverride = deviceId;
}

function browserDeviceId(): string {
  if (deviceIdOverride) return deviceIdOverride;
  try {
    if (typeof localStorage === 'undefined') return 'device';
    const existing = localStorage.getItem('firo.device-id');
    if (existing) return existing;
    const created = `device-${Date.now().toString(36)}`;
    localStorage.setItem('firo.device-id', created);
    return created;
  } catch {
    return 'device';
  }
}

export function buildLearnedCoordinateRecord(input: {
  stop: StopParkAddress;
  pin: LearnedParkPin;
  deviceId?: string | null;
  driverName?: string | null;
  recipient?: string | null;
  routeNumber?: string | null;
  orderNumber?: string | null;
}): LearnedCoordinateSyncRecord {
  const normalizedAddress = input.stop.normalizedAddress ?? input.stop.originalAddress;
  const deviceId = input.deviceId ?? browserDeviceId();
  const canonicalId = learnedCoordinateId(normalizedAddress);
  const sampleKey = learnedSampleKey({
    deviceId,
    lastSampledAt: input.pin.lastSampledAt,
    learnedLatitude: input.pin.latitude,
    learnedLongitude: input.pin.longitude,
    sampleCount: input.pin.sampleCount,
  });
  return {
    canonicalId,
    address: input.stop.originalAddress,
    normalizedAddress,
    geocodeLatitude: input.stop.latitude,
    geocodeLongitude: input.stop.longitude,
    learnedLatitude: input.pin.latitude,
    learnedLongitude: input.pin.longitude,
    accuracyM: input.pin.accuracyM,
    sampleCount: input.pin.sampleCount,
    lastSampledAt: input.pin.lastSampledAt,
    sampleKey,
    version: 0,
    appliedSampleKeys: [sampleKey],
    status: input.pin.accuracyM !== null && input.pin.accuracyM > 65 ? 'imprecise' : 'used',
    driverName: input.driverName ?? null,
    deviceId,
    recipient: input.recipient ?? null,
    routeNumber: input.routeNumber ?? null,
    orderNumber: input.orderNumber ?? null,
  };
}

async function defaultTransport(): Promise<LearnedCoordinateSyncTransport> {
  return {
    async push(pins) {
      return employeeApi<{ results: LearnedCoordinateMergeOutcome[] }>('/api/learned-coordinates', {
        method: 'POST',
        body: JSON.stringify({ pins }),
      });
    },
    async pull() {
      return employeeApi<{ pins: LearnedCoordinateSyncRecord[] }>('/api/learned-coordinates');
    },
  };
}

function pinFromRecord(record: LearnedCoordinateSyncRecord): LearnedParkPin | null {
  if (!Number.isFinite(record.learnedLatitude) || !Number.isFinite(record.learnedLongitude) || !record.lastSampledAt) return null;
  return {
    latitude: record.learnedLatitude as number,
    longitude: record.learnedLongitude as number,
    heading: null,
    accuracyM: record.accuracyM,
    sampleCount: record.sampleCount,
    lastSampledAt: record.lastSampledAt,
  };
}

/**
 * Upload pending local courtyard pins and pull anything newer. A server error
 * leaves the local row pending and never blocks delivery. Repeated calls do
 * not create a second sample: the server ignores an already applied sample key.
 */
export async function syncLearnedCoordinates(db: SQLiteDatabase): Promise<LearnedCoordinateSyncReport> {
  const report: LearnedCoordinateSyncReport = { uploaded: 0, kept: 0, pulled: 0, pending: 0 };
  if (!transport && (await getEmployeeSession())?.demo) return report;
  const memory = new LocationParkMemoryRepository(db);
  const pending = await memory.listSyncRows();
  report.pending = pending.filter((row) => row.syncStatus !== 'synced' || row.syncedSampleKey !== row.sampleKey).length;
  let client = transport;
  if (!client) {
    try {
      client = await defaultTransport();
    } catch (reason) {
      devWarn('LEARNED_COORDINATE_SYNC_UNAVAILABLE', reason);
      return report;
    }
  }
  const outgoing = pending.filter((row) => row.syncStatus !== 'synced' || row.syncedSampleKey !== row.sampleKey);
  if (outgoing.length > 0) {
    try {
      const response = await client.push(outgoing.map((row) => row.record));
      const attempted = new Map(outgoing.map((row) => [row.record.canonicalId, row.record.sampleKey]));
      for (const outcome of response.results ?? []) {
        if (!outcome?.record) continue;
        const sampleKey = attempted.get(outcome.record.canonicalId) ?? outcome.record.sampleKey;
        await memory.markSynced(outcome.record.canonicalId, sampleKey, outcome.record.version);
        if (outcome.applied) report.uploaded += 1;
        else report.kept += 1;
        if (outcome.applied) {
          const pin = pinFromRecord(outcome.record);
          if (pin) await memory.save(outcome.record.normalizedAddress || outcome.record.address, pin, outcome.record.updatedAt ?? new Date().toISOString(), {
            originalAddress: outcome.record.address,
            normalizedAddress: outcome.record.normalizedAddress,
            geocodeLatitude: outcome.record.geocodeLatitude,
            geocodeLongitude: outcome.record.geocodeLongitude,
            sampleKey,
            syncStatus: 'synced',
            serverVersion: outcome.record.version,
          });
        }
        if (!outcome.applied && outcome.reason === 'older') {
          const serverPin = pinFromRecord(outcome.record);
          if (serverPin) await applyParkPinToAddress(db, outcome.record.address || outcome.record.normalizedAddress, serverPin);
        }
      }
    } catch (reason) {
      devWarn('LEARNED_COORDINATE_PUSH_FAILED', reason);
    }
  }
  try {
    const remote = await client.pull();
    for (const raw of remote.pins ?? []) {
      const record = normalizeLearnedCoordinate(raw as unknown as Record<string, unknown>, raw.deviceId ?? 'server');
      if (!record) continue;
      const local = await memory.findSyncRow(record.canonicalId);
      const localTime = Date.parse(local?.record.lastSampledAt ?? '');
      const remoteTime = Date.parse(record.lastSampledAt ?? '');
      const remoteNewer = !local || (Number.isFinite(remoteTime) && remoteTime > (Number.isFinite(localTime) ? localTime : 0));
      if (!remoteNewer) continue;
      const pin = pinFromRecord(record);
      if (!pin) continue;
      await memory.save(record.normalizedAddress || record.address, pin, record.updatedAt ?? record.lastSampledAt ?? new Date().toISOString(), {
        originalAddress: record.address,
        normalizedAddress: record.normalizedAddress,
        geocodeLatitude: record.geocodeLatitude,
        geocodeLongitude: record.geocodeLongitude,
        sampleKey: record.sampleKey,
        syncStatus: 'synced',
        serverVersion: record.version,
      });
      await applyParkPinToAddress(db, record.address || record.normalizedAddress, pin);
      report.pulled += 1;
    }
  } catch (reason) {
    devWarn('LEARNED_COORDINATE_PULL_FAILED', reason);
  }
  const after = await memory.listSyncRows();
  report.pending = after.filter((row) => row.syncStatus !== 'synced').length;
  return report;
}

export async function publishLearnedCoordinate(
  db: SQLiteDatabase,
  stop: StopParkAddress,
  pin: LearnedParkPin,
): Promise<void> {
  const session = transport ? null : await getEmployeeSession().catch(() => null);
  const record = buildLearnedCoordinateRecord({
    stop,
    pin,
    driverName: session?.profile.displayName ?? null,
    deviceId: browserDeviceId(),
  });
  const memory = new LocationParkMemoryRepository(db);
  await memory.save(stop.normalizedAddress ?? stop.originalAddress, pin, pin.lastSampledAt, {
    originalAddress: stop.originalAddress,
    normalizedAddress: stop.normalizedAddress,
    geocodeLatitude: stop.latitude,
    geocodeLongitude: stop.longitude,
    sampleKey: record.sampleKey,
    syncStatus: 'pending',
  });
  try {
    await syncLearnedCoordinates(db);
  } catch (reason) {
    devWarn('LEARNED_COORDINATE_PUBLISH_FAILED', reason);
  }
}

