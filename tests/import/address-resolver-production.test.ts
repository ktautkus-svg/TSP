import { describe, expect, it } from 'vitest';
import { resolveDeliveryAddresses, type AddressLookupProvider } from '../../src/application/import/address-resolver';
import { deliveryFixture } from './helpers';

const cases = Array.from({ length: 30 }, (_, index) => ({ index, mode: index % 3 as 0 | 1 | 2 }));

describe('address resolver (30 cases)', () => {
  it.each(cases)('classifies address result $index', async ({ index, mode }) => {
    const provider: AddressLookupProvider = {
      resolve: async (address) => mode === 0 ? [] : Array.from({ length: mode }, (_, candidate) => ({
        normalizedAddress: `${address} LT ${candidate}`,
        latitude: 54.6 + candidate / 100,
        longitude: 25.2,
        placeId: `place-${index}-${candidate}`,
        confidence: 0.9 - candidate * 0.1,
      })),
    };
    const [result] = await resolveDeliveryAddresses([deliveryFixture(index + 1)], provider);
    expect(result.validationState).toBe(mode === 0 ? 'invalid' : mode === 1 ? 'valid' : 'ambiguous');
    expect(result.addressCandidates).toHaveLength(mode);
    expect(Boolean(result.selectedAddress)).toBe(mode === 1);
  });

  it('uses the dominant city only in the normalized query and keeps original address text', async () => {
    const seen: string[] = [];
    const provider: AddressLookupProvider = {
      resolve: async (address) => {
        seen.push(address);
        return [{
          normalizedAddress: `${address}, Lietuva`,
          latitude: 55.93,
          longitude: 23.31,
          placeId: address,
          confidence: 0.96,
        }];
      },
    };
    const withCity = deliveryFixture(1, 'Dvaro g. 144A, Šiauliai');
    const withoutCity = deliveryFixture(2, 'Stoties g. 9C');
    const results = await resolveDeliveryAddresses([withCity, withoutCity], provider);
    expect(seen[1]).toBe('Stoties g. 9C, Šiauliai');
    expect(results[1].address.value).toBe('Stoties g. 9C');
    expect(results[1].addressQuery).toBe('Stoties g. 9C, Šiauliai');
    expect(results[1].selectedAddress?.normalizedAddress).toBe('Stoties g. 9C, Šiauliai, Lietuva');
  });
});
