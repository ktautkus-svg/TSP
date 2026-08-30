import type { ResolvedAddressCandidate } from '@/domain/import/models';

type KnownAddressCorrection = {
  matches: (key: string) => boolean;
  candidate: ResolvedAddressCandidate;
};

const KNOWN_ADDRESS_CORRECTIONS: readonly KnownAddressCorrection[] = [
  {
    matches: (key) => key.includes('pajuoscio') && /(?:plentas|pl\.|pl)\s*73\b/.test(key),
    candidate: {
      normalizedAddress: 'Pajuosčio pl. 73, Dembavos k., Velžio sen., Panevėžio r., Lietuva',
      latitude: 55.738356,
      longitude: 24.434709,
      placeId: null,
      confidence: 1,
    },
  },
];

/** Operational overrides for repeatedly visited sites whose unloading point differs from the public address pin. */
export function knownAddressCorrection(value: string): ResolvedAddressCandidate | null {
  const key = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('lt-LT')
    .replace(/\s+/g, ' ')
    .trim();
  return KNOWN_ADDRESS_CORRECTIONS.find((correction) => correction.matches(key))?.candidate ?? null;
}
