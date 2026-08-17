export interface RouteCodeSource {
  readonly route_code?: unknown;
  readonly routeCode?: unknown;
  readonly raw_row_json?: unknown;
  readonly rawRowJson?: unknown;
  readonly rawRow?: unknown;
}

const REGION_CODE_PATTERN = /^[A-RT-Z]\d{2}$/u;

export function normalizeRegionCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return REGION_CODE_PATTERN.test(normalized) ? normalized : null;
}

/**
 * Older imports can have the region in the original Excel row even when the
 * detected route-code column was wrong. Keep those routes readable without
 * rewriting their stored operational data.
 */
export function regionCodeFromSource(line: RouteCodeSource): string | null {
  const direct = normalizeRegionCode(line.route_code) ?? normalizeRegionCode(line.routeCode);
  if (direct) return direct;
  for (const raw of [line.raw_row_json, line.rawRowJson, line.rawRow]) {
    const row = parseRawRow(raw);
    if (!row) continue;
    for (const value of Object.values(row)) {
      const code = normalizeRegionCode(value);
      if (code) return code;
    }
  }
  return null;
}

export function uniqueRegionCodes(lines: readonly RouteCodeSource[]): string[] {
  const values = new Set<string>();
  for (const line of lines) {
    const code = regionCodeFromSource(line);
    if (code) values.add(code);
  }
  return [...values];
}

function parseRawRow(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
