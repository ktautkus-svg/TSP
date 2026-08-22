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
  'canEnterTripReadings',
] as const;

export type DriverPermissionKey = (typeof DRIVER_PERMISSION_KEYS)[number];
export type DriverPermissions = Record<DriverPermissionKey, boolean>;

export const MANAGEMENT_PERMISSION_KEYS = [
  'canManageEmployees',
  'canManageVehicles',
  'canManageFinancials',
  'canEnterTripReadings',
] as const;
export type ManagementPermissionKey = (typeof MANAGEMENT_PERMISSION_KEYS)[number];
export type ManagementPermissions = Record<ManagementPermissionKey, boolean>;
export type EmployeePermissionKey = DriverPermissionKey | ManagementPermissionKey;
export type EmployeePermissions = DriverPermissions & ManagementPermissions;

export const DEFAULT_DRIVER_PERMISSIONS: DriverPermissions = {
  canReorderAssignedRoute: false,
  canCreateRoutes: false,
  canAddStops: false,
  canRecalculateRoute: false,
  canCancelRoute: false,
  canViewCompensation: false,
  canEnterTripReadings: false,
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
  canEnterTripReadings: {
    title: 'Įvesti odometrą ir kurą',
    description: 'Gali kelionės lape suvesti dienos odometrą ir kuro pylimus.',
  },
};

export const DEFAULT_MANAGEMENT_PERMISSIONS: ManagementPermissions = {
  canManageEmployees: false,
  canManageVehicles: false,
  canManageFinancials: false,
  canEnterTripReadings: false,
};

export function normalizeDriverPermissions(value?: Partial<DriverPermissions> | null): DriverPermissions {
  return {
    ...DEFAULT_DRIVER_PERMISSIONS,
    ...(value ?? {}),
  };
}

export const MANAGEMENT_PERMISSION_LABELS: Record<ManagementPermissionKey, { title: string; description: string }> = {
  canManageEmployees: {
    title: 'Redaguoti vairuotojus',
    description: 'Dispečeris gali kurti ir redaguoti vairuotojus bei jų prisijungimus.',
  },
  canManageVehicles: {
    title: 'Redaguoti automobilius',
    description: 'Dispečeris gali keisti automobilių duomenis ir jų priskyrimą.',
  },
  canManageFinancials: {
    title: 'Redaguoti finansinius duomenis',
    description: 'Dispečeris gali keisti kuro, draudimo, kelių mokesčių ir atlygio parametrus.',
  },
  canEnterTripReadings: {
    title: 'Įvesti odometrą ir kurą',
    description: 'Gali kelionės lape suvesti dienos odometrą ir kuro pylimus bet kuriam automobiliui.',
  },
};

export function normalizeEmployeePermissions(value?: Partial<EmployeePermissions> | null): EmployeePermissions {
  return {
    ...DEFAULT_DRIVER_PERMISSIONS,
    ...DEFAULT_MANAGEMENT_PERMISSIONS,
    ...(value ?? {}),
  };
}

export function canApproveExpiredDeparture(profile: {
  role: EmployeeRole;
  permissions?: Partial<EmployeePermissions> | null;
}): boolean {
  if (profile.role === 'admin') return true;
  if (profile.role === 'dispatcher') {
    return normalizeEmployeePermissions(profile.permissions).canManageVehicles;
  }
  return false;
}

export function canEnterTripReadings(profile: {
  role: EmployeeRole;
  permissions?: Partial<EmployeePermissions> | null;
}): boolean {
  if (profile.role === 'admin' || profile.role === 'dispatcher') return true;
  return normalizeEmployeePermissions(profile.permissions).canEnterTripReadings === true;
}

