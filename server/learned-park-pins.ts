import { Firestore } from '@google-cloud/firestore';

import {
  mergeLearnedCoordinate,
  normalizeLearnedCoordinate,
  type LearnedCoordinateMergeOutcome,
} from '../src/domain/learned-coordinate-sync.js';

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
  status: 'used' | 'imprecise' | 'rejected' | 'needs_samples';
  rejectionReason?: string | null;
  updatedAt?: string | null;
};

const COLLECTION = 'tsp_learned_park_pins';

export class LearnedParkPinStore {
  private readonly pins = new Firestore().collection(COLLECTION);

  async list(): Promise<LearnedCoordinateSample[]> {
    const snapshot = await this.pins.orderBy('updatedAt', 'desc').limit(500).get();
    return snapshot.docs.map((doc) => doc.data() as LearnedCoordinateSample);
  }

  async upsert(sample: LearnedCoordinateSample | Record<string, unknown>, actor: string): Promise<LearnedCoordinateMergeOutcome> {
    const incoming = normalizeLearnedCoordinate(sample as Record<string, unknown>, actor);
    if (!incoming) {
      throw new Error('Išmoktai koordinatei reikia adreso.');
    }
    const ref = this.pins.doc(incoming.canonicalId);
    const existing = await ref.get();
    const current = existing.exists ? normalizeLearnedCoordinate(existing.data() as Record<string, unknown>, actor) : null;
    const outcome = mergeLearnedCoordinate(current, incoming);
    if (outcome.applied) await ref.set(outcome.record);
    return outcome;
  }

  async sync(samples: (LearnedCoordinateSample | Record<string, unknown>)[], actor: string): Promise<LearnedCoordinateMergeOutcome[]> {
    const results: LearnedCoordinateMergeOutcome[] = [];
    for (const sample of samples.slice(0, 200)) {
      results.push(await this.upsert(sample, actor));
    }
    return results;
  }

  async remove(normalizedAddress: string): Promise<boolean> {
    const id = normalizedAddress.trim().toLowerCase();
    const canonical = normalizeLearnedCoordinate({ address: normalizedAddress, normalizedAddress }, 'admin')?.canonicalId ?? id;
    const ref = this.pins.doc(canonical);
    const existing = await ref.get();
    if (!existing.exists) return false;
    const current = existing.data() as LearnedCoordinateSample;
    await ref.set({
      ...current,
      learnedLatitude: null,
      learnedLongitude: null,
      status: 'rejected',
      rejectionReason: 'admin_removed',
      updatedAt: new Date().toISOString(),
    });
    return true;
  }
}
