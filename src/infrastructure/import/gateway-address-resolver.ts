import type { AddressLookupProvider } from '@/application/import/address-resolver';
import type { ResolvedAddressCandidate } from '@/domain/import/models';
import { GatewayGeocodingProvider } from '@/infrastructure/routing/providers/gateway-geocoding-provider';

export class GatewayAddressResolver implements AddressLookupProvider {
  constructor(private readonly provider = new GatewayGeocodingProvider()) {}

  async resolve(address: string): Promise<ResolvedAddressCandidate[]> {
    const result = await this.provider.geocode(address);
    return result.alternatives.map((candidate, index) => ({
      normalizedAddress: candidate.normalizedAddress,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      placeId: candidate.placeId,
      confidence: result.isUnambiguous ? 0.96 : Math.max(0.55, 0.85 - index * 0.08),
    }));
  }
}
