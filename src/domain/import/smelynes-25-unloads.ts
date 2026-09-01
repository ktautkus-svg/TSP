/**
 * Smėlynės g. 25 (Respublikinė Panevėžio ligoninė / UAB Lambda LT) has two
 * separate unloadings. Daily Excel marks them in column E as kavinė vs
 * ne-kavinė. This is a single-site exception: every other same-address merge
 * is unchanged. Do not add other sites here.
 */

export type Smelynes25Unload = 'cafe' | 'default';

type Smelynes25Row = {
  normalizedAddress?: string | null;
  originalAddress?: string | null;
  rawColumnE?: string | null;
  recipient?: string | null;
  rawRow?: Record<string, unknown> | null;
};

export function mentionsSmelynes25(...texts: (string | null | undefined)[]): boolean {
  return texts.some((text) => {
    if (!text) return false;
    return /smelynes(?:gatve|g)?25(?![0-9])/.test(fold(text));
  });
}

export function smelynes25UnloadIdentity(columnText: string | null | undefined): Smelynes25Unload {
  const folded = (columnText ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('lt-LT');
  // Keep punctuation so "ligoninė(kavinė)" is not read as "ne kavinė".
  if (/(?:^|[^a-z])ne[\s\-()]*kavin/.test(folded)) return 'default';
  if (/(?:^|[^a-z])kavin/.test(folded)) return 'cafe';
  return 'default';
}

/** Suffix appended to the address/coordinate merge key. Empty when this site rule does not apply. */
export function smelynes25UnloadKey(row: Smelynes25Row): string {
  if (!isSmelynes25Row(row)) return '';
  return smelynes25UnloadIdentity(columnEText(row)) === 'cafe' ? '#smelynes25:cafe' : '';
}

export function smelynes25UnloadKeyFromRows(rows: readonly Smelynes25Row[]): string {
  return rows.map(smelynes25UnloadKey).find(Boolean) ?? '';
}

export function smelynes25UnloadLabel(rows: readonly Smelynes25Row[]): string | null {
  if (!rows.some(isSmelynes25Row)) return null;
  return rows.some((row) => smelynes25UnloadIdentity(columnEText(row)) === 'cafe')
    ? 'Kavinė'
    : 'Ne kavinė';
}

function isSmelynes25Row(row: Smelynes25Row): boolean {
  return mentionsSmelynes25(
    row.normalizedAddress,
    row.originalAddress,
    row.rawColumnE,
    row.recipient,
    literalColumn(row.rawRow, 'E'),
    literalColumn(row.rawRow, 'D'),
  );
}

function columnEText(row: Smelynes25Row): string {
  return [literalColumn(row.rawRow, 'E'), row.rawColumnE, row.recipient]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(' ');
}

function literalColumn(rawRow: Record<string, unknown> | null | undefined, column: string): string | null {
  if (!rawRow) return null;
  const value = rawRow[column] ?? rawRow[column.toLowerCase()];
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('lt-LT')
    .replace(/[^a-z0-9]/g, '');
}
