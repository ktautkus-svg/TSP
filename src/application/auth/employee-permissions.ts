export const DRIVER_PERMISSION_KEYS = [
  'canReorderAssignedRoute',
  'canCreateRoutes',
  'canAddStops',
  'canRecalculateRoute',
  'canCancelRoute',
] as const;

export type DriverPermissionKey = (typeof DRIVER_PERMISSION_KEYS)[number];
export type DriverPermissions = Record<DriverPermissionKey, boolean>;

export const DEFAULT_DRIVER_PERMISSIONS: DriverPermissions = {
  canReorderAssignedRoute: false,
  canCreateRoutes: false,
  canAddStops: false,
  canRecalculateRoute: false,
  canCancelRoute: false,
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
};

export function normalizeDriverPermissions(value?: Partial<DriverPermissions> | null): DriverPermissions {
  return {
    ...DEFAULT_DRIVER_PERMISSIONS,
    ...(value ?? {}),
  };
}

