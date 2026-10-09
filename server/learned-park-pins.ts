import { Firestore } from '@google-cloud/firestore';

import { shouldKeepLearnedPin, type LearnedCoordinateSample } from '../src/domain/learned-coordinate-audit.js';

const COLLECTION = 'tsp_learned_park_pins';

export class LearnedParkPinStore {
  private readonly pins = new Firestore().collection(COLLECTION);

  async list(): Promise<LearnedCoordinateSample[]> {
    const snapshot = await this.pins.orderBy('updatedAt', 'desc').limit(500).get();
    return snapshot.docs.map((doc) => doc.data() as LearnedCoordinateSample);
  }

  async upsert(sample: LearnedCoordinateSample, actor: string): Promise<LearnedCoordinateSample> {
    const id = sample.normalizedAddress.trim().toLowerCase();
    const ref = this.pins.doc(id);
    const existing = await ref.get();
    const incomingAt = sample.updatedAt ?? sample.lastSampledAt ?? new Date().toISOString();
    const current = existing.data() as LearnedCoordinateSample | undefined;
    if (current && shouldKeepLearnedPin(current.updatedAt ?? current.lastSampledAt, incomingAt)) return current;
    const stored: LearnedCoordinateSample = { ...sample, updatedAt: incomingAt, deviceId: sample.deviceId ?? actor };
    await ref.set(stored);
    return stored;
  }

  async remove(normalizedAddress: string): Promise<boolean> {
    const id = normalizedAddress.trim().toLowerCase();
    const ref = this.pins.doc(id);
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
