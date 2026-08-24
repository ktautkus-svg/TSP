import type { DeliveryStatus, LoadingStatus, RouteStatus } from './route';

const routeTransitions: Record<RouteStatus, readonly RouteStatus[]> = {
  draft: ['planned', 'cancelled'],
  planned: ['loading', 'draft', 'cancelled'],
  loading: ['loaded', 'draft', 'cancelled'],
  loaded: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

const loadingTransitions: Record<LoadingStatus, readonly LoadingStatus[]> = {
  pending: ['loaded'],
  loaded: ['pending'],
};

const deliveryTransitions: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  pending: ['delivered', 'failed'],
  failed: ['delivered', 'failed', 'pending'],
  delivered: ['pending'],
};

export function normalizeIsoDate(value: string): string {
  const normalized = value.trim();
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Neteisinga datos reikšmė.');
  }
  return parsed.toISOString();
}

export const isoDateOrThrow = normalizeIsoDate;

export function validateOdometerInput(value: number | null, label = 'odometro'): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 10_000_000) {
    throw new Error(`Neteisingas ${label} odometro rodmuo.`);
  }
  return Math.round(value * 10) / 10;
}

export const validateOdometer = validateOdometerInput;

export function validateFuelRemainingLiters(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1_000) {
    throw new Error('Kuro likutis turi būti nuo 0 iki 1000 litrų.');
  }
  return Math.round(value * 10) / 10;
}

export const validateFuelLiters = validateFuelRemainingLiters;

export function validateFuelAmount(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1_000) {
    throw new Error('Įpilto kuro kiekis turi būti nuo 0,1 iki 1000 litrų.');
  }
  return Math.round(value * 100) / 100;
}

export const validateLiters = validateFuelAmount;

export function validateFuelPrice(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error('Neteisinga litro kaina.');
  }
  return Math.round(value * 1000) / 1000;
}

export const validatePricePerLiter = validateFuelPrice;

export function canTransitionRoute(from: RouteStatus, to: RouteStatus): boolean {
  return routeTransitions[from].includes(to);
}

export function canTransitionLoading(from: LoadingStatus, to: LoadingStatus): boolean {
  return loadingTransitions[from].includes(to);
}

export function canTransitionDelivery(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return deliveryTransitions[from].includes(to);
}

export function validateRouteStatusTransition(from: RouteStatus, to: RouteStatus): void {
  if (!canTransitionRoute(from, to)) {
    throw new Error(`Negalimas maršruto būsenos perėjimas: ${from} → ${to}`);
  }
}

export function validateLoadingTransition(from: LoadingStatus, to: LoadingStatus): void {
  if (!canTransitionLoading(from, to)) {
    throw new Error(`Negalimas pakrovimo būsenos perėjimas: ${from} → ${to}`);
  }
}

export function validateDeliveryTransition(from: DeliveryStatus, to: DeliveryStatus): void {
  if (!canTransitionDelivery(from, to)) {
    throw new Error(`Negalimas pristatymo būsenos perėjimas: ${from} → ${to}`);
  }
}

export const assertRouteTransition = validateRouteStatusTransition;
export const assertLoadingTransition = validateLoadingTransition;
export const assertDeliveryTransition = validateDeliveryTransition;
