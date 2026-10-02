/**
 * Compares an explicitly supplied locality with the locality returned by a
 * geocoder. Street names and house numbers are not enough on their own: the
 * same „Mokyklos g. 1“ can exist in several Lithuanian settlements.
 */
export function isAddressLocalityCompatible(query: string, normalizedAddress: string): boolean {
  const expectedLocality = firstLocalityComponent(query);
  if (!expectedLocality) return true;
  const candidateLocality = firstLocalityComponent(normalizedAddress);
  if (!candidateLocality) return false;
  return localityMatches(expectedLocality, candidateLocality);
}

function firstLocalityComponent(value: string): string | null {
  // Raw Excel cells keep the address on separate lines; a line break is a
  // component boundary exactly like a comma.
  const allParts = value
    .split(/,|\r?\n/)
    .map((part) => part.trim())
    .filter((part) => Boolean(part) && !/^Lietuva$/iu.test(part));
  // Supplier / recipient lines ("UAB Lambda LT") precede the street line in
  // multi-line cells and are never the locality.
  const firstStreetPart = /[\r\n]/.test(value) ? allParts.findIndex((part) => /\d/.test(part)) : -1;
  const parts = firstStreetPart > 0 ? allParts.slice(firstStreetPart) : allParts;
  if (parts.length >= 2) {
    const locality = cleanLocality(parts[1]!);
    return locality || null;
  }
  const withoutCountry = (parts[0] ?? value)
    .replace(/\b(?:LT-?)?\d{5}\b/giu, ' ')
    .replace(/\s+Lietuva\s*$/iu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const inline = /\b\d+[A-ZĄČĘĖĮŠŲŪŽ]?\s+([\p{L}][\p{L}\s.'’-]+)$/u.exec(withoutCountry)?.[1] ?? '';
  const locality = cleanLocality(inline);
  return locality || null;
}

function cleanLocality(value: string): string {
  // „75451 Kaltinėnai Šilalės r.Kaltinėnai 75451 Lietuva“: postcodes, the
  // country and a trailing district („Šilalės r.“) are not the settlement.
  const withoutNoise = value
    .replace(/\b(?:LT-?)?\d{5}\b/giu, ' ')
    .replace(/\bLietuva\b/giu, ' ');
  const withoutDistrict = withoutNoise.replace(/(?:^|\s)\p{L}{3,}\s*(?:r|raj|sav)\.(?:\s*sav\.)?/giu, ' ');
  const base = /\p{L}{3,}/u.test(withoutDistrict) ? withoutDistrict : withoutNoise;
  return base
    .replace(/\b(?:k|mstl|m|sen|r|raj|sav|apskr)\.?\b/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function localityMatches(expected: string, actual: string): boolean {
  const expectedWords = localityWords(expected);
  const actualWords = localityWords(actual);
  if (expectedWords.length === 0 || actualWords.length === 0) return false;
  return expectedWords.every((word) => actualWords.some((candidate) => sameLithuanianWord(word, candidate)));
}

function localityWords(value: string): string[] {
  return cleanLocality(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('lt-LT')
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length >= 3);
}

function sameLithuanianWord(left: string, right: string): boolean {
  if (left === right) return true;
  const commonLength = Math.min(left.length, right.length, 6);
  return commonLength >= 5 && left.slice(0, commonLength) === right.slice(0, commonLength);
}
