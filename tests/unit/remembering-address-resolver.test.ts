import { describe, expect, it, vi } from 'vitest';

import { RememberingAddressResolver } from '../../src/infrastructure/import/remembering-address-resolver';
import type { AddressResolutionMemoryRepository } from '../../src/database/repositories/address-resolution-memory-repository';
import type { ResolvedAddressCandidate } from '../../src/domain/import/models';

function candidate(overrides: Partial<ResolvedAddressCandidate> = {}): ResolvedAddressCandidate {
  return { normalizedAddress: 'Smėlynės g. 25, Panevėžys', latitude: 55.7, longitude: 24.35, placeId: null, confidence: 1, ...overrides };
}

describe('RememberingAddressResolver', () => {
  it('uses the verified Pajuosčio unloading point without calling the provider', async () => {
    const provider = { resolve: vi.fn().mockResolvedValue([]) };
    const memory = { find: vi.fn().mockResolvedValue(null), remember: vi.fn().mockResolvedValue(undefined) } as unknown as AddressResolutionMemoryRepository;
    const resolver = new RememberingAddressResolver(provider, memory);

    const result = await resolver.resolve('Pajuosčio pl.73, Dembavos k., Velžio sen.');

    expect(result).toEqual([expect.objectContaining({ latitude: 55.738356, longitude: 24.434709 })]);
    expect(provider.resolve).not.toHaveBeenCalled();
    expect(memory.remember).toHaveBeenCalledWith(
      'Pajuosčio pl.73, Dembavos k., Velžio sen.',
      expect.objectContaining({ latitude: 55.738356, longitude: 24.434709 }),
    );
  });

  it('remembers an unambiguous automatic hit, not only manual fixes', async () => {
    const found = candidate();
    const provider = { resolve: vi.fn().mockResolvedValue([found]) };
    const memory = { find: vi.fn().mockResolvedValue(null), remember: vi.fn().mockResolvedValue(undefined) } as unknown as AddressResolutionMemoryRepository;
    const resolver = new RememberingAddressResolver(provider, memory);

    const result = await resolver.resolve('Smėlynės g. 25, Panevėžys');

    expect(result).toEqual([found]);
    expect(memory.remember).toHaveBeenCalledWith('Smėlynės g. 25, Panevėžys', found);
  });

  it('does not remember an ambiguous result with several candidates', async () => {
    const provider = { resolve: vi.fn().mockResolvedValue([candidate(), candidate({ latitude: 55.8 })]) };
    const memory = { find: vi.fn().mockResolvedValue(null), remember: vi.fn().mockResolvedValue(undefined) } as unknown as AddressResolutionMemoryRepository;
    const resolver = new RememberingAddressResolver(provider, memory);

    await resolver.resolve('Smėlynės g. 25, Panevėžys');

    expect(memory.remember).not.toHaveBeenCalled();
  });

  it('reuses a remembered address instead of calling the provider again', async () => {
    const remembered = candidate();
    const provider = { resolve: vi.fn().mockResolvedValue([]) };
    const memory = { find: vi.fn().mockResolvedValue(remembered), remember: vi.fn().mockResolvedValue(undefined) } as unknown as AddressResolutionMemoryRepository;
    const resolver = new RememberingAddressResolver(provider, memory);

    const result = await resolver.resolve('Smėlynės g. 25, Panevėžys');

    expect(result).toEqual([{ ...remembered, confidence: 1 }]);
    expect(provider.resolve).not.toHaveBeenCalled();
  });
});
