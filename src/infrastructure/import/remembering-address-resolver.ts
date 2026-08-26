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
    const candidates = await this.provider.resolve(address);
    // Remember any unambiguous automatic hit too, not only manual fixes —
    // otherwise a repeat delivery that geocoded cleanly on its own (no
    // correction needed) is never cached, and a later import can resolve the
    // same physical address differently (provider variance, or this file's
    // city-context guess landing on a different dominant city than last time).
    if (candidates.length === 1) void this.memory.remember(address, candidates[0]!);
    return candidates;
  }
}
