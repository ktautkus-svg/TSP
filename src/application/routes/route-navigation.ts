import type { Route, RouteStatus } from '@/domain/route';

export type RouteScreen =
  | 'review'
  | 'alternatives'
  | 'edit'
  | 'loading'
  | 'delivery'
  | 'history-detail'
  | 'history'
  | 'dashboard';

export type RouteNavigationContext = {
  routeId: string;
  completionStartedAt?: string | null;
  hasSelectedCandidate?: boolean;
};

export type ResolvedRouteDestination = {
  screen: RouteScreen;
  pathname:
    | '/route/[id]/review'
    | '/route/[id]/alternatives'
    | '/route/[id]/edit'
    | '/route/[id]/loading'
    | '/route/[id]/delivery'
    | '/history/[id]'
    | '/history'
    | '/';
  params: { id: string; resumeCompletion?: '1'; redirectReason?: string } | undefined;
  resumeCompletion: boolean;
};

export function resolveRouteDestination(
  status: RouteStatus,
  context: RouteNavigationContext,
): ResolvedRouteDestination {
  const idParams = { id: context.routeId };
  switch (status) {
    case 'draft':
      return { screen: 'review', pathname: '/route/[id]/review', params: idParams, resumeCompletion: false };
    case 'planned':
      return context.hasSelectedCandidate === false
        ? { screen: 'alternatives', pathname: '/route/[id]/alternatives', params: idParams, resumeCompletion: false }
        : { screen: 'loading', pathname: '/route/[id]/loading', params: idParams, resumeCompletion: false };
    case 'loading':
    case 'loaded':
      return { screen: 'loading', pathname: '/route/[id]/loading', params: idParams, resumeCompletion: false };
    case 'in_progress': {
      const resumeCompletion = Boolean(context.completionStartedAt);
      return {
        screen: 'delivery',
        pathname: '/route/[id]/delivery',
        params: resumeCompletion ? { id: context.routeId, resumeCompletion: '1' } : idParams,
        resumeCompletion,
      };
    }
    case 'completed':
      return { screen: 'history-detail', pathname: '/history/[id]', params: idParams, resumeCompletion: false };
    case 'cancelled':
      return { screen: 'history', pathname: '/history', params: undefined, resumeCompletion: false };
  }
}

export function resolveRoute(route?: Route | null): ResolvedRouteDestination {
  if (!route || !route.status) {
    return { screen: 'dashboard', pathname: '/', params: undefined, resumeCompletion: false };
  }
  return resolveRouteDestination(route.status, {
    routeId: route?.id ?? 'unknown',
    completionStartedAt: route?.completionStartedAt,
    hasSelectedCandidate: Boolean(route?.selectedCandidateId),
  });
}

export function destinationForRouteStatus(status: RouteStatus): RouteScreen {
  return resolveRouteDestination(status, { routeId: 'route' }).screen;
}

export function routePathForStatus(
  routeId: string,
  status: RouteStatus,
): ResolvedRouteDestination['pathname'] {
  return resolveRouteDestination(status, { routeId }).pathname;
}

export function planningScreenAllowsStatus(
  screen: 'review' | 'alternatives' | 'edit',
  status: RouteStatus,
): boolean {
  return status === 'draft' && (screen === 'review' || screen === 'alternatives' || screen === 'edit');
}
