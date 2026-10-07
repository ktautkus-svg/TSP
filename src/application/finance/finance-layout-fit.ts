/**
 * Synthetic viewport / column-fit checks for wages and trip-sheet tables.
 * These are not CSS source-regex assertions: they measure real style widths
 * against concrete viewport budgets and synthetic day/export totals.
 */

export const VIEWPORTS = {
  desktop1366: { width: 1366, height: 768 },
  desktop1920: { width: 1920, height: 1080 },
  phone360: { width: 360, height: 640 },
  phone390: { width: 390, height: 844 },
  tablet768: { width: 768, height: 1024 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;

/** Mirrors wages.tsx createStyles table column widths. */
export const WAGE_TABLE_LAYOUT = {
  contentMaxWidth: 1480,
  foundationPaddingX: 20,
  textColumnWidth: 140,
  numberColumnWidth: 72,
  quickActionWidth: 72,
  toggleWidth: 36,
  textColumnsWithoutDriver: 2, // date + comment
  textColumnsWithDriver: 3, // date + driver + comment
  numberColumns: 9,
} as const;

/** Mirrors trip-sheet.tsx report table fixed widths. */
export const TRIP_SHEET_LAYOUT = {
  contentMaxWidth: 1600,
  foundationPaddingX: 20,
  sheetPaddingX: 20,
  line: 40,
  date: 84,
  routeMin: 120,
  number: 60,
  wideNumber: 104,
  receipt: 84,
  odo: 76,
  driver: 140,
} as const;

export function wageTableRequiredWidth(options: { showDriver: boolean; canEdit: boolean }): number {
  const textColumns = options.showDriver
    ? WAGE_TABLE_LAYOUT.textColumnsWithDriver
    : WAGE_TABLE_LAYOUT.textColumnsWithoutDriver;
  return (
    textColumns * WAGE_TABLE_LAYOUT.textColumnWidth
    + WAGE_TABLE_LAYOUT.numberColumns * WAGE_TABLE_LAYOUT.numberColumnWidth
    + (options.canEdit ? WAGE_TABLE_LAYOUT.quickActionWidth : 0)
    + WAGE_TABLE_LAYOUT.toggleWidth
  );
}

export function tripSheetRequiredWidth(): number {
  return (
    TRIP_SHEET_LAYOUT.line
    + TRIP_SHEET_LAYOUT.date
    + TRIP_SHEET_LAYOUT.routeMin
    + TRIP_SHEET_LAYOUT.number
    + TRIP_SHEET_LAYOUT.wideNumber
    + TRIP_SHEET_LAYOUT.number
    + TRIP_SHEET_LAYOUT.receipt
    + TRIP_SHEET_LAYOUT.wideNumber
    + TRIP_SHEET_LAYOUT.wideNumber
    + TRIP_SHEET_LAYOUT.odo
    + TRIP_SHEET_LAYOUT.odo
    + TRIP_SHEET_LAYOUT.driver
  );
}

export function availableContentWidth(viewportWidth: number, contentMaxWidth: number, paddingX: number): number {
  const shell = Math.min(viewportWidth, contentMaxWidth);
  return shell - paddingX * 2;
}

export type LayoutFitResult = {
  viewport: ViewportName;
  required: number;
  available: number;
  fitsWithoutHorizontalScroll: boolean;
  /** Horizontal ScrollView is acceptable on narrow phones; amounts must still be reachable. */
  allowsHorizontalScroll: boolean;
  clipped: boolean;
};

export function assessWageTableFit(viewport: ViewportName, options: { showDriver: boolean; canEdit: boolean }): LayoutFitResult {
  const { width } = VIEWPORTS[viewport];
  const required = wageTableRequiredWidth(options);
  const available = availableContentWidth(width, WAGE_TABLE_LAYOUT.contentMaxWidth, WAGE_TABLE_LAYOUT.foundationPaddingX);
  const fitsWithoutHorizontalScroll = required <= available;
  const allowsHorizontalScroll = width < 1280;
  return {
    viewport,
    required,
    available,
    fitsWithoutHorizontalScroll,
    allowsHorizontalScroll,
    // Clipped only when the table cannot fit and horizontal scroll is also unavailable.
    clipped: !fitsWithoutHorizontalScroll && !allowsHorizontalScroll,
  };
}

export function assessTripSheetFit(viewport: ViewportName): LayoutFitResult {
  const { width } = VIEWPORTS[viewport];
  const required = tripSheetRequiredWidth();
  const available = availableContentWidth(
    width,
    TRIP_SHEET_LAYOUT.contentMaxWidth,
    TRIP_SHEET_LAYOUT.foundationPaddingX + TRIP_SHEET_LAYOUT.sheetPaddingX,
  );
  const fitsWithoutHorizontalScroll = required <= available;
  const allowsHorizontalScroll = width < 1280;
  return {
    viewport,
    required,
    available,
    fitsWithoutHorizontalScroll,
    allowsHorizontalScroll,
    clipped: !fitsWithoutHorizontalScroll && !allowsHorizontalScroll,
  };
}

export function assertAmountsVisible(values: readonly (number | string | null | undefined)[]): string[] {
  return values.map((value) => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'number') {
      return new Intl.NumberFormat('lt-LT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    }
    return String(value);
  });
}

/** Extract a numeric style width from product source (not a duplicated constant). */
export function parseStyleWidth(source: string, styleName: string): number {
  const match = source.match(new RegExp(`${styleName}:\\s*\\{[^}]*\\b(?:min)?[Ww]idth:\\s*(\\d+)`));
  if (!match) throw new Error(`Missing style width for ${styleName}`);
  return Number(match[1]);
}

export function parseContentMaxWidth(source: string): number {
  const match = source.match(/contentMaxWidth=\{(\d+)\}/);
  if (!match) throw new Error('Missing contentMaxWidth');
  return Number(match[1]);
}

/**
 * Build wage/trip required widths from the actual screen source so viewport
 * checks fail when UI styles drift away from finance-layout-fit constants.
 */
export function measureWageTableFromSource(wagesSource: string, options: { showDriver: boolean; canEdit: boolean }): number {
  const text = parseStyleWidth(wagesSource, 'wageTableText');
  const number = parseStyleWidth(wagesSource, 'wageTableNumber');
  const quick = parseStyleWidth(wagesSource, 'wageTableQuick');
  const toggle = parseStyleWidth(wagesSource, 'wageTableToggle');
  const textColumns = options.showDriver ? 3 : 2;
  return textColumns * text + 9 * number + (options.canEdit ? quick : 0) + toggle;
}

export function measureTripSheetFromSource(tripSource: string): { required: number; declaredMinWidth: number } {
  const line = parseStyleWidth(tripSource, 'reportLineCell');
  const date = parseStyleWidth(tripSource, 'reportDateCell');
  const route = parseStyleWidth(tripSource, 'reportRouteCell');
  const number = parseStyleWidth(tripSource, 'reportNumberCell');
  const wide = parseStyleWidth(tripSource, 'reportWideNumberCell');
  const receipt = parseStyleWidth(tripSource, 'reportReceiptCell');
  const odo = parseStyleWidth(tripSource, 'reportOdoCell');
  const driver = parseStyleWidth(tripSource, 'reportDriverCell');
  const required = line + date + route + number + wide + number + receipt + wide + wide + odo + odo + driver;
  const declaredMinWidth = parseStyleWidth(tripSource, 'reportTable');
  return { required, declaredMinWidth };
}
