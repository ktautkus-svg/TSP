export type RoutePriceVehicle = {
  registrationNumber: string;
  maximumPayloadKg: number;
};

export type RoutePriceInput = {
  date: string;
  distanceKm: number | null;
  weightKg: number;
  stops: number;
  driverName: string;
  vehicle: RoutePriceVehicle;
  bonusNetEur?: number;
};

export type PreliminaryRoutePrice = {
  totalEur: number;
  baseCostEur: number;
  fuelCostEur: number;
  roadCostEur: number;
  insuranceCostEur: number;
  driverCostEur: number;
  overheadEur: number;
  source: 'excel-vehicle' | 'payload-estimate';
  assumptions: readonly string[];
};

export type VehicleCostProfile = {
  fuelNormLitersPer100Km: number;
  annualInsuranceEur: number;
  monthlyRoadTaxEur: number;
};

export type VariableDriverCostProfile = {
  type: 'variable';
  baseNetEur: number;
  perKmEur: number;
  perKgEur: number;
  perStopEur: number;
};

export type DriverCostProfile =
  | { type: 'fixed'; dailyNetEur: number }
  | VariableDriverCostProfile;

export type RoutePriceSettings = {
  fuelPriceByMonth: number[];
  workingDaysByMonth: number[];
  overheadPercent: number;
  payrollTaxPercent: number;
  vehicleCosts: Record<string, VehicleCostProfile>;
  driverCosts: Record<string, DriverCostProfile>;
  defaultDriverCost: VariableDriverCostProfile;
  fallbackPayloadThresholdsKg: { smallMax: number; mediumMax: number };
  fallbackVehicleCosts: {
    small: VehicleCostProfile;
    medium: VehicleCostProfile;
    large: VehicleCostProfile;
  };
};

// Source: "Maršruto kaina.xlsm", sheet "Technine lentele". These are
// operational price inputs only; they never influence routing or stop order.
export const DEFAULT_ROUTE_PRICE_SETTINGS: RoutePriceSettings = {
  fuelPriceByMonth: [1.26, 1.25, 1.17, 1.10, 1.08, 1.13, 1.13, 1.13, 1.13, 1.13, 1.13, 1.13],
  workingDaysByMonth: [22, 20, 20, 20, 21, 20, 23, 20, 22, 23, 20, 20],
  overheadPercent: 5,
  payrollTaxPercent: 51,
  vehicleCosts: {
    EFA568: vehicle(20, 450, 137), LRI744: vehicle(15, 929.46, 34), MSZ867: vehicle(13.2, 1756.81, 34),
    LRI748: vehicle(15, 929.46, 34), LMC891: vehicle(14, 196, 37), NAH354: vehicle(12, 1006.01, 34),
    LRI740: vehicle(15, 929.46, 34), LFG709: vehicle(25, 470, 91), MYZ861: vehicle(25, 470, 91),
    MSV407: vehicle(15, 196, 75), LRI742: vehicle(15, 929.46, 34), MSZ859: vehicle(14.5, 1756.81, 34),
    GFU337: vehicle(25, 450, 118), KZP979: vehicle(20, 450, 137), FDB519: vehicle(20, 450, 137),
    LRI741: vehicle(15, 929.46, 34), MFJ465: vehicle(12, 196, 30.42), KJL116: vehicle(13, 196, 34),
    MET628: vehicle(12, 1006.01, 34), MSZ873: vehicle(14.5, 1756.81, 34), EFA559: vehicle(20, 450, 137),
    MCI855: vehicle(12, 196, 43), MET630: vehicle(12, 1006.01, 34), MCP563: vehicle(12, 196, 34),
    NYP356: vehicle(13.5, 196, 37),
  },
  driverCosts: {
    'arūnas jusys': fixedDriver(60),
    'genadij bajerovič': fixedDriver(55),
    'pavel jermolenko': fixedDriver(60),
    'jonas milkintas': fixedDriver(55),
    'prav.+vilnius': fixedDriver(73),
    'prav.': fixedDriver(63),
    'gintaras gavėnas': fixedDriver(63),
    'audrius mickus': variableDriver(25, 0.05, 0.005, 0.60),
    'romualdas neverdauskas': variableDriver(25, 0.05, 0.005, 0.60),
  },
  defaultDriverCost: variableDriver(23, 0.05, 0.006, 0.65),
  fallbackPayloadThresholdsKg: { smallMax: 1600, mediumMax: 3500 },
  fallbackVehicleCosts: {
    small: vehicle(14.5, 929.46, 34),
    medium: vehicle(20, 450, 137),
    large: vehicle(25, 470, 91),
  },
};

export function normalizeRoutePriceSettings(value: unknown): RoutePriceSettings {
  const source = record(value);
  const defaults = DEFAULT_ROUTE_PRICE_SETTINGS;
  const vehicleCosts = profileRecord(source.vehicleCosts, defaults.vehicleCosts, normalizeVehicleProfile);
  const driverCosts = profileRecord(source.driverCosts, defaults.driverCosts, normalizeDriverProfile);
  const fallback = record(source.fallbackVehicleCosts);
  const thresholds = record(source.fallbackPayloadThresholdsKg);
  return {
    fuelPriceByMonth: monthArray(source.fuelPriceByMonth, defaults.fuelPriceByMonth, 0.01),
    workingDaysByMonth: monthArray(source.workingDaysByMonth, defaults.workingDaysByMonth, 1),
    overheadPercent: numberValue(source.overheadPercent, defaults.overheadPercent, 0),
    payrollTaxPercent: numberValue(source.payrollTaxPercent, defaults.payrollTaxPercent, 0),
    vehicleCosts,
    driverCosts,
    defaultDriverCost: normalizeVariableProfile(source.defaultDriverCost, defaults.defaultDriverCost),
    fallbackPayloadThresholdsKg: {
      smallMax: numberValue(thresholds.smallMax, defaults.fallbackPayloadThresholdsKg.smallMax, 0),
      mediumMax: numberValue(thresholds.mediumMax, defaults.fallbackPayloadThresholdsKg.mediumMax, 0),
    },
    fallbackVehicleCosts: {
      small: normalizeVehicleProfile(fallback.small, defaults.fallbackVehicleCosts.small),
      medium: normalizeVehicleProfile(fallback.medium, defaults.fallbackVehicleCosts.medium),
      large: normalizeVehicleProfile(fallback.large, defaults.fallbackVehicleCosts.large),
    },
  };
}

export function estimatePreliminaryRoutePrice(
  input: RoutePriceInput,
  settings: RoutePriceSettings = DEFAULT_ROUTE_PRICE_SETTINGS,
): PreliminaryRoutePrice | null {
  if (input.distanceKm === null || !Number.isFinite(input.distanceKm) || input.distanceKm < 0) return null;
  const normalizedSettings = normalizeRoutePriceSettings(settings);
  const monthIndex = routeMonthIndex(input.date);
  const fuelPrice = normalizedSettings.fuelPriceByMonth[monthIndex];
  const workingDays = normalizedSettings.workingDaysByMonth[monthIndex];
  const registration = input.vehicle.registrationNumber.trim().toUpperCase();
  const exactVehicle = normalizedSettings.vehicleCosts[registration];
  const vehicleCosts = exactVehicle ?? estimatedVehicleCosts(input.vehicle.maximumPayloadKg, normalizedSettings);
  const driverCosts = driverCostProfile(input.driverName, normalizedSettings);
  const taxMultiplier = 1 + normalizedSettings.payrollTaxPercent / 100;
  const bonus = finiteNonNegative(input.bonusNetEur ?? 0);
  const distance = finiteNonNegative(input.distanceKm);
  const weight = finiteNonNegative(input.weightKg);
  const stops = finiteNonNegative(input.stops);

  const fuelCostEur = distance / 100 * vehicleCosts.fuelNormLitersPer100Km * fuelPrice;
  const roadCostEur = vehicleCosts.monthlyRoadTaxEur / workingDays;
  const insuranceCostEur = (vehicleCosts.annualInsuranceEur / 12) / workingDays;
  const driverNet = driverCosts.type === 'fixed'
    ? driverCosts.dailyNetEur + bonus
    : driverCosts.baseNetEur + driverCosts.perKmEur * distance + driverCosts.perKgEur * weight + driverCosts.perStopEur * stops + bonus;
  const driverCostEur = driverNet * taxMultiplier;
  const baseCostEur = fuelCostEur + roadCostEur + insuranceCostEur + driverCostEur;
  const overheadEur = baseCostEur * normalizedSettings.overheadPercent / 100;

  return {
    totalEur: money(baseCostEur + overheadEur),
    baseCostEur: money(baseCostEur),
    fuelCostEur: money(fuelCostEur),
    roadCostEur: money(roadCostEur),
    insuranceCostEur: money(insuranceCostEur),
    driverCostEur: money(driverCostEur),
    overheadEur: money(overheadEur),
    source: exactVehicle ? 'excel-vehicle' : 'payload-estimate',
    assumptions: [
      `Kuro kaina ${fuelPrice.toFixed(2)} €/l`,
      `${workingDays} darbo d.`,
      `darbdavio koef. ${taxMultiplier.toFixed(2)}`,
      `${formatNumber(normalizedSettings.overheadPercent)} % rezervas`,
    ],
  };
}

function driverCostProfile(name: string, settings: RoutePriceSettings): DriverCostProfile {
  return settings.driverCosts[normalizeName(name)] ?? settings.defaultDriverCost;
}

function estimatedVehicleCosts(payloadKg: number, settings: RoutePriceSettings): VehicleCostProfile {
  const payload = finiteNonNegative(payloadKg);
  if (payload > settings.fallbackPayloadThresholdsKg.mediumMax) return settings.fallbackVehicleCosts.large;
  if (payload > settings.fallbackPayloadThresholdsKg.smallMax) return settings.fallbackVehicleCosts.medium;
  return settings.fallbackVehicleCosts.small;
}

function normalizeVehicleProfile(value: unknown, fallback: VehicleCostProfile): VehicleCostProfile {
  const source = record(value);
  return {
    fuelNormLitersPer100Km: numberValue(source.fuelNormLitersPer100Km, fallback.fuelNormLitersPer100Km, 0),
    annualInsuranceEur: numberValue(source.annualInsuranceEur, fallback.annualInsuranceEur, 0),
    monthlyRoadTaxEur: numberValue(source.monthlyRoadTaxEur, fallback.monthlyRoadTaxEur, 0),
  };
}

function normalizeDriverProfile(value: unknown, fallback: DriverCostProfile): DriverCostProfile {
  const source = record(value);
  if (source.type === 'fixed' || (source.type !== 'variable' && fallback.type === 'fixed')) {
    const dailyFallback = fallback.type === 'fixed' ? fallback.dailyNetEur : 0;
    return fixedDriver(numberValue(source.dailyNetEur, dailyFallback, 0));
  }
  const variableFallback = fallback.type === 'variable' ? fallback : DEFAULT_ROUTE_PRICE_SETTINGS.defaultDriverCost;
  return normalizeVariableProfile(source, variableFallback);
}

function normalizeVariableProfile(value: unknown, fallback: VariableDriverCostProfile): VariableDriverCostProfile {
  const source = record(value);
  return variableDriver(
    numberValue(source.baseNetEur, fallback.baseNetEur, 0),
    numberValue(source.perKmEur, fallback.perKmEur, 0),
    numberValue(source.perKgEur, fallback.perKgEur, 0),
    numberValue(source.perStopEur, fallback.perStopEur, 0),
  );
}

function profileRecord<T>(
  value: unknown,
  fallback: Record<string, T>,
  normalize: (value: unknown, fallback: T) => T,
): Record<string, T> {
  const source = record(value);
  return Object.fromEntries(Object.entries(fallback).map(([key, defaultValue]) => [
    key,
    normalize(source[key], defaultValue),
  ]));
}

function monthArray(value: unknown, fallback: number[], minimum: number): number[] {
  const source = Array.isArray(value) ? value : [];
  return fallback.map((defaultValue, index) => numberValue(source[index], defaultValue, minimum));
}

function routeMonthIndex(date: string): number {
  const match = /^\d{4}-(\d{2})-\d{2}$/.exec(date);
  const month = match ? Number(match[1]) : new Date(date).getMonth() + 1;
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month - 1 : new Date().getMonth();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function numberValue(value: unknown, fallback: number, minimum: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}
function normalizeName(value: string): string { return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('lt-LT'); }
function finiteNonNegative(value: number): number { return Number.isFinite(value) ? Math.max(0, value) : 0; }
function money(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
function formatNumber(value: number): string { return new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 2 }).format(value); }
function vehicle(fuelNormLitersPer100Km: number, annualInsuranceEur: number, monthlyRoadTaxEur: number): VehicleCostProfile {
  return { fuelNormLitersPer100Km, annualInsuranceEur, monthlyRoadTaxEur };
}
function fixedDriver(dailyNetEur: number): DriverCostProfile { return { type: 'fixed', dailyNetEur }; }
function variableDriver(baseNetEur: number, perKmEur: number, perKgEur: number, perStopEur: number): VariableDriverCostProfile {
  return { type: 'variable', baseNetEur, perKmEur, perKgEur, perStopEur };
}
