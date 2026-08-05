import { haversineKm } from '@/domain/routing/evaluation/geo';
import type {
  MatrixCell,
  MatrixRequest,
  TravelCostProvider,
  TravelMatrix,
} from '@/domain/routing/models';

export type SyntheticMatrixMode = 'linear' | 'city_traffic' | 'asymmetric';

export class SyntheticTravelCostProvider implements TravelCostProvider {
  readonly name: string;

  constructor(readonly mode: SyntheticMatrixMode = 'city_traffic') {
    this.name = `synthetic:${mode}`;
  }

  async getMatrix(request: MatrixRequest): Promise<TravelMatrix> {
    const departureHour = new Date(request.departureAt).getUTCHours();
    const cells = request.locations.map((from, fromIndex) =>
      request.locations.map((to, toIndex): MatrixCell => {
        if (fromIndex === toIndex) {
          return {
            distanceKm: 0,
            durationMinutes: 0,
            reachable: true,
            maneuverPenalty: 0,
            restrictionWarnings: [],
          };
        }
        const direct = haversineKm(from, to);
        const orientation =
          (to.longitude - from.longitude) * 1.7 + (to.latitude - from.latitude);
        const roadFactor =
          this.mode === 'linear'
            ? 1.12
            : this.mode === 'city_traffic'
              ? 1.2 + deterministicNoise(from.id, to.id) * 0.22
              : 1.15 + Math.max(0, orientation) * 12;
        const distanceKm = direct * roadFactor;
        const rush =
          this.mode === 'city_traffic' &&
          request.trafficMode !== 'none' &&
          ((departureHour >= 6 && departureHour <= 9) || (departureHour >= 15 && departureHour <= 18))
            ? 1.55
            : 1;
        const directionFactor =
          this.mode === 'asymmetric'
            ? orientation > 0
              ? 1.35
              : 0.92
            : 1;
        const speedKmh = this.mode === 'city_traffic' ? 37 : 58;
        return {
          distanceKm: round(distanceKm),
          durationMinutes: round((distanceKm / speedKmh) * 60 * rush * directionFactor),
          reachable: true,
          maneuverPenalty: round(
            (this.mode === 'asymmetric' && orientation > 0 ? 2 : 0) +
              deterministicNoise(to.id, from.id) * 3,
          ),
          restrictionWarnings: [],
        };
      }),
    );
    return {
      provider: this.name,
      executionMode: 'synthetic',
      nodeIds: request.locations.map((location) => location.id),
      cells,
      fetchedAt: new Date().toISOString(),
      trafficMode: request.trafficMode,
      departureAt: request.departureAt,
      warnings: ['Sintetinė matrica: rezultatai nėra realaus kelių tiekėjo duomenys.'],
      version: 'synthetic-v1',
    };
  }
}

function deterministicNoise(left: string, right: string): number {
  let hash = 2166136261;
  for (const character of `${left}>${right}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffff_ffff;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
