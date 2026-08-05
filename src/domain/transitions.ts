import type { DeliveryStatus, LoadingStatus, RouteStatus } from './route';

const routeTransitions: Record<RouteStatus, readonly RouteStatus[]> = {
  draft: ['planned', 'cancelled'],
  // 'draft' here lets the user reopen planning to pick a different route alternative
  // before loading starts (ReopenRouteForPlanning).
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

export function canTransitionRoute(from: RouteStatus, to: RouteStatus): boolean {
  return routeTransitions[from].includes(to);
}

export function canTransitionLoading(from: LoadingStatus, to: LoadingStatus): boolean {
  return loadingTransitions[from].includes(to);
}

export function canTransitionDelivery(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return deliveryTransitions[from].includes(to);
}

export function assertRouteTransition(from: RouteStatus, to: RouteStatus): void {
  if (!canTransitionRoute(from, to)) {
    throw new Error(`Negalimas maršruto būsenos perėjimas: ${from} → ${to}`);
  }
}

export function assertDeliveryTransition(from: DeliveryStatus, to: DeliveryStatus): void {
  if (!canTransitionDelivery(from, to)) {
    throw new Error(`Negalimas pristatymo būsenos perėjimas: ${from} → ${to}`);
  }
}

export function assertLoadingTransition(from: LoadingStatus, to: LoadingStatus): void {
  if (!canTransitionLoading(from, to)) {
    throw new Error(`Negalimas pakrovimo būsenos perėjimas: ${from} → ${to}`);
  }
}
