import type { ResolvedAddressCandidate } from '@/domain/import/models';

type KnownAddressCorrection = {
  matches: (key: string) => boolean;
  candidate: ResolvedAddressCandidate;
};

type KnownSplitUnloadSite = {
  id: string;
  matches: (key: string) => boolean;
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

/**
 * Sites that keep more than one unloading even when the street address matches.
 * This is the durable remembered rule for Lambda / Respublikinė Panevėžio
 * ligoninė (Smėlynės 25): kavinė and ne-kavinė stay two stops.
 */
const KNOWN_SPLIT_UNLOAD_SITES: readonly KnownSplitUnloadSite[] = [
  {
    id: 'lambda-respublikine-panevezio-ligonine-smelynes-25',
    matches: (key) =>
      /smelynes(?:\s+g(?:atve)?\.?)?\s*25\b/.test(key)
      || (/ligonin/.test(key) && /panev/.test(key) && /(?:respublikin|lambda)/.test(key)),
  },
];

export function knownSiteKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('lt-LT')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Operational overrides for repeatedly visited sites whose unloading point differs from the public address pin. */
export function knownAddressCorrection(value: string): ResolvedAddressCandidate | null {
  const key = knownSiteKey(value);
  return KNOWN_ADDRESS_CORRECTIONS.find((correction) => correction.matches(key))?.candidate ?? null;
}

export function knownSplitUnloadSite(value: string): boolean {
  const key = knownSiteKey(value);
  if (!key) return false;
  return KNOWN_SPLIT_UNLOAD_SITES.some((site) => site.matches(key));
}
