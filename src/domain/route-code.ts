export interface RouteCodeSource {
  readonly route_code?: unknown;
}

const REGION_CODE_PATTERN = /^[A-RT-Z]\d{2}$/u;

export function normalizeRegionCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return REGION_CODE_PATTERN.test(normalized) ? normalized : null;
}

export function uniqueRegionCodes(lines: readonly RouteCodeSource[]): string[] {
  const values = new Set<string>();
  for (const line of lines) {
    const code = normalizeRegionCode(line.route_code);
    if (code) values.add(code);
  }
  return [...values];
}
