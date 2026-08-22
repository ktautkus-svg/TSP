export const DEPARTURE_WARNING_DAYS = 14;

export type DepartureIssueCode =
  | 'INSPECTION_EXPIRED'
  | 'ROAD_TAX_EXPIRED'
  | 'SERVICE_EXPIRED'
  | 'INSPECTION_DUE_SOON'
  | 'ROAD_TAX_DUE_SOON'
  | 'SERVICE_DUE_SOON'
  | 'OPEN_NON_URGENT_FAULT';

export type DepartureIssue = {
  code: DepartureIssueCode;
  severity: 'block' | 'warning';
  message: string;
  href?: '/vehicle' | '/contacts';
};

export type VehicleComplianceInput = {
  id: string;
  registrationNumber: string;
  technicalInspectionDueOn: string | null;
  roadTaxDueOn: string | null;
  nextServiceDueOn: string | null;
};

export type OperationalContactInput = {
  id: string;
  kind: 'administration' | 'dispatcher' | 'warehouse' | 'other';
  name: string;
  roleLabel: string | null;
  phone: string;
  isEmergency: boolean;
};

export type VehicleFaultInput = {
  id: string;
  comment: string;
  notifiedAt: string | null;
};

export type DepartureReadiness = {
  blockers: DepartureIssue[];
  warnings: DepartureIssue[];
  canDepart: boolean;
  canBeginLoading: boolean;
};

function todayOn(nowIso: string): string {
  return nowIso.slice(0, 10);
}

function daysUntil(dueOn: string, today: string): number {
  const due = Date.parse(`${dueOn}T00:00:00.000Z`);
  const current = Date.parse(`${today}T00:00:00.000Z`);
  if (!Number.isFinite(due) || !Number.isFinite(current)) return Number.NaN;
  return Math.round((due - current) / 86_400_000);
}

function isIsoDate(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function deadlineIssues(input: {
  expiredCode: DepartureIssueCode;
  soonCode: DepartureIssueCode;
  label: string;
  dueOn: string | null;
  today: string;
}): DepartureIssue[] {
  // Unentered dates must not interrupt work. Gates apply only after a real date is saved.
  if (!isIsoDate(input.dueOn)) return [];
  const remaining = daysUntil(input.dueOn, input.today);
  if (!Number.isFinite(remaining)) return [];
  if (remaining < 0) {
    return [{
      code: input.expiredCode,
      severity: 'block',
      message: `${input.label} baigėsi ${input.dueOn}. Kol terminas neatnaujintas, važiuoti negalima.`,
      href: '/vehicle',
    }];
  }
  if (remaining <= DEPARTURE_WARNING_DAYS) {
    return [{
      code: input.soonCode,
      severity: 'warning',
      message: `${input.label} baigiasi ${input.dueOn} (liko ${remaining} d.). Darbas netrukdomas.`,
      href: '/vehicle',
    }];
  }
  return [];
}

export function evaluateDepartureReadiness(input: {
  vehicle: VehicleComplianceInput | null;
  contacts?: readonly OperationalContactInput[];
  faults?: readonly VehicleFaultInput[];
  now?: string;
}): DepartureReadiness {
  const today = todayOn(input.now ?? new Date().toISOString());
  const issues: DepartureIssue[] = [];

  if (input.vehicle) {
    issues.push(...deadlineIssues({
      expiredCode: 'INSPECTION_EXPIRED',
      soonCode: 'INSPECTION_DUE_SOON',
      label: 'Techninės apžiūros terminas',
      dueOn: input.vehicle.technicalInspectionDueOn,
      today,
    }));
    issues.push(...deadlineIssues({
      expiredCode: 'ROAD_TAX_EXPIRED',
      soonCode: 'ROAD_TAX_DUE_SOON',
      label: 'Kelių mokesčio terminas',
      dueOn: input.vehicle.roadTaxDueOn,
      today,
    }));
    issues.push(...deadlineIssues({
      expiredCode: 'SERVICE_EXPIRED',
      soonCode: 'SERVICE_DUE_SOON',
      label: 'Priežiūros terminas',
      dueOn: input.vehicle.nextServiceDueOn,
      today,
    }));
  }

  for (const fault of input.faults ?? []) {
    issues.push({
      code: 'OPEN_NON_URGENT_FAULT',
      severity: 'warning',
      message: fault.notifiedAt
        ? `Neskubus gedimas perduotas administracijai: ${fault.comment}`
        : `Neskubus gedimas dar neperduotas administracijai: ${fault.comment}`,
      href: '/vehicle',
    });
  }

  const blockers = issues.filter((issue) => issue.severity === 'block');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  return {
    blockers,
    warnings,
    canDepart: blockers.length === 0,
    canBeginLoading: blockers.length === 0,
  };
}

export function firstBlockerMessage(readiness: DepartureReadiness): string {
  return readiness.blockers[0]?.message ?? 'Pasibaigęs automobilio terminas. Važiuoti negalima.';
}
