import type { AddressLookupProvider } from '@/application/import/address-resolver';
import { AddressResolutionMemoryRepository } from '@/database/repositories/address-resolution-memory-repository';
import type { ResolvedAddressCandidate } from '@/domain/import/models';

export class RememberingAddressResolver implements AddressLookupProvider {
  constructor(
    private readonly provider: AddressLookupProvider,
    private readonly memory: AddressResolutionMemoryRepository,
  ) {}

  async resolve(address: string): Promise<ResolvedAddressCandidate[]> {
    const remembered = await this.memory.find(address);
    if (remembered) return [{ ...remembered, confidence: 1 }];
    return this.provider.resolve(address);
  }
}
