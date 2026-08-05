export const FUEL_TYPES = ['diesel', 'petrol', 'lpg', 'electric', 'hybrid', 'other'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export type SavedLocation = {
  label: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type Vehicle = {
  id: string;
  name: string;
  registrationNumber: string;
  fuelType: FuelType;
  baseFuelNormLPer100Km: number | null;
  lengthM: number | null;
  widthM: number | null;
  heightM: number | null;
  emptyWeightKg: number | null;
  maximumPayloadKg: number | null;
  maximumGrossWeightKg: number | null;
  homeLocation: SavedLocation | null;
  warehouseLocation: SavedLocation | null;
  createdAt: string;
  updatedAt: string;
};

export type TripSheet = {
  id: string;
  date: string;
  vehicleId: string;
  startLocation: SavedLocation;
  endLocation: SavedLocation;
  startOdometer: number | null;
  endOdometer: number | null;
  actualDistanceKm: number | null;
  plannedDistanceKm: number | null;
  plannedStartAt: string | null;
  actualStartAt: string | null;
  plannedEndAt: string | null;
  actualEndAt: string | null;
  plannedDurationMinutes: number | null;
  actualDurationMinutes: number | null;
  schedulePerformancePercent: number | null;
  productiveTimePercent: number | null;
  totalDeliveredWeightKg: number;
  totalStops: number;
  notes: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type FuelEntry = {
  id: string;
  vehicleId: string;
  tripSheetId: string | null;
  filledAt: string;
  odometer: number;
  liters: number;
  pricePerLiter: number | null;
  totalCost: number | null;
  fullTank: boolean;
  fuelType: FuelType;
  station: string | null;
  notes: string | null;
  createdAt: string;
};

export const TIME_CATEGORIES = [
  'driving',
  'service',
  'waiting',
  'break',
  'unplanned_idle',
  'other',
] as const;
export type TimeCategory = (typeof TIME_CATEGORIES)[number];
