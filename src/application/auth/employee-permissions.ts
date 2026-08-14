import type { EmployeeRole } from '@/infrastructure/auth/employee-session';

export const EMPLOYEE_ROLE_LABELS: Record<EmployeeRole, string> = {
  admin: 'Administratorius',
  dispatcher: 'Dispečeris',
  driver: 'Vairuotojas',
  quality: 'Kokybės kontrolė',
};

export function roleLabel(role: EmployeeRole): string {
  return EMPLOYEE_ROLE_LABELS[role];
}

export type SessionStateTone = 'success' | 'warning';

/** `online` reflects whether the session was last verified against the server, not just cached locally. */
export function sessionStateLabel(online: boolean): { label: string; tone: SessionStateTone } {
  return online
    ? { label: 'Prisijungta prie serverio', tone: 'success' }
    : { label: 'Vietinis režimas (neprisijungus)', tone: 'warning' };
}

export const DRIVER_PERMISSION_KEYS = [
  'canReorderAssignedRoute',
  'canCreateRoutes',
  'canAddStops',
  'canRecalculateRoute',
  'canCancelRoute',
  'canViewCompensation',
] as const;

export type DriverPermissionKey = (typeof DRIVER_PERMISSION_KEYS)[number];
export type DriverPermissions = Record<DriverPermissionKey, boolean>;

export const DEFAULT_DRIVER_PERMISSIONS: DriverPermissions = {
  canReorderAssignedRoute: false,
  canCreateRoutes: false,
  canAddStops: false,
  canRecalculateRoute: false,
  canCancelRoute: false,
  canViewCompensation: false,
};

export const DRIVER_PERMISSION_LABELS: Record<DriverPermissionKey, { title: string; description: string }> = {
  canReorderAssignedRoute: {
    title: 'Keisti sustojimų eiliškumą',
    description: 'Vairuotojas gali perstumdyti jam priskirto maršruto taškus.',
  },
  canCreateRoutes: {
    title: 'Kurti maršrutus',
    description: 'Vairuotojas gali pats importuoti ir planuoti naują maršrutą.',
  },
  canAddStops: {
    title: 'Įtraukti sustojimą',
    description: 'Vairuotojas gali pridėti naują tašką į aktyvų maršrutą.',
  },
  canRecalculateRoute: {
    title: 'Perskaičiuoti maršrutą',
    description: 'Vairuotojas gali keisti likusio maršruto seką.',
  },
  canCancelRoute: {
    title: 'Nutraukti maršrutą',
    description: 'Vairuotojas gali pats atšaukti jam priskirtą maršrutą.',
  },
  canViewCompensation: {
    title: 'Matyti atlygio skaičiavimą',
    description: 'Vairuotojas kelionės lape ir maršruto suvestinėje mato preliminarų bei galutinį dienos netto atlygį.',
  },
};

export function normalizeDriverPermissions(value?: Partial<DriverPermissions> | null): DriverPermissions {
  return {
    ...DEFAULT_DRIVER_PERMISSIONS,
    ...(value ?? {}),
  };
}

