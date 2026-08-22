export const DEPARTURE_WARNING_DAYS = 14;

export type DepartureIssueCode =
  | 'INSPECTION_EXPIRED'
  | 'ROAD_TAX_EXPIRED'
  | 'SERVICE_EXPIRED'
  | 'INSPECTION_DUE_SOON'
  | 'ROAD_TAX_DUE_SOON'
  | 'SERVICE_DUE_SOON'
  | 'OPEN_NON_URGENT_FAULT'
  | 'EXPIRED_DATE_OVERRIDE';

export type DepartureIssue = {
  code: DepartureIssueCode;
  severity: 'block' | 'warning';
  message: string;
  href?: '/vehicle' | '/contacts';
  dueOn?: string;
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

export type DepartureOverrideStatus = 'none' | 'pending' | 'approved';

export type DepartureOverrideInput = {
  status: 'pending' | 'approved';
  fingerprint: string;
};

export type DepartureReadiness = {
  blockers: DepartureIssue[];
  warnings: DepartureIssue[];
  canDepart: boolean;
  canBeginLoading: boolean;
  overrideStatus: DepartureOverrideStatus;
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
      message: `${input.label} baigėsi ${input.dueOn}. Kol terminas neatnaujintas, važiuoti negalima, nebent administratorius patvirtins.`,
      href: '/vehicle',
      dueOn: input.dueOn,
    }];
  }
  if (remaining <= DEPARTURE_WARNING_DAYS) {
    return [{
      code: input.soonCode,
      severity: 'warning',
      message: `${input.label} baigiasi ${input.dueOn} (liko ${remaining} d.). Darbas netrukdomas.`,
      href: '/vehicle',
      dueOn: input.dueOn,
    }];
  }
  return [];
}

export function departureBlockerFingerprint(issues: readonly DepartureIssue[]): string {
  return issues
    .filter((issue) => issue.severity === 'block')
    .map((issue) => `${issue.code}:${issue.dueOn ?? ''}`)
    .sort()
    .join('|');
}

export function expiredDeadlineSummary(issues: readonly DepartureIssue[]): string {
  return issues
    .filter((issue) => issue.severity === 'block')
    .map((issue) => (issue.dueOn ? `${issue.code}:${issue.dueOn}` : issue.code))
    .sort()
    .join(', ');
}

export function applyDepartureOverride(
  result: Omit<DepartureReadiness, 'overrideStatus'> & { overrideStatus?: DepartureOverrideStatus },
  override?: DepartureOverrideInput | null,
): DepartureReadiness {
  const fingerprint = departureBlockerFingerprint(result.blockers);
  if (!fingerprint || !override || override.fingerprint !== fingerprint) {
    return {
      blockers: result.blockers,
      warnings: result.warnings,
      canDepart: result.blockers.length === 0,
      canBeginLoading: result.blockers.length === 0,
      overrideStatus: 'none',
    };
  }
  if (override.status === 'pending') {
    return {
      blockers: result.blockers,
      warnings: result.warnings,
      canDepart: false,
      canBeginLoading: false,
      overrideStatus: 'pending',
    };
  }
  const released = result.blockers.map((issue) => ({
    ...issue,
    severity: 'warning' as const,
    message: issue.dueOn
      ? `${issue.code === 'INSPECTION_EXPIRED' ? 'Techninės apžiūros' : issue.code === 'ROAD_TAX_EXPIRED' ? 'Kelių mokesčio' : 'Priežiūros'} terminas baigėsi ${issue.dueOn}, bet administratorius patvirtino, kad važiuoti galima.`
      : issue.message,
  }));
  return {
    blockers: [],
    warnings: [
      {
        code: 'EXPIRED_DATE_OVERRIDE',
        severity: 'warning',
        message: 'Administratorius patvirtino, kad su pasibaigusiais terminais vis tiek galima važiuoti.',
        href: '/vehicle',
      },
      ...released,
      ...result.warnings,
    ],
    canDepart: true,
    canBeginLoading: true,
    overrideStatus: 'approved',
  };
}

export function evaluateDepartureReadiness(input: {
  vehicle: VehicleComplianceInput | null;
  contacts?: readonly OperationalContactInput[];
  faults?: readonly VehicleFaultInput[];
  now?: string;
  override?: DepartureOverrideInput | null;
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
  return applyDepartureOverride({
    blockers,
    warnings,
    canDepart: blockers.length === 0,
    canBeginLoading: blockers.length === 0,
  }, input.override);
}

export function firstBlockerMessage(readiness: DepartureReadiness): string {
  return readiness.blockers[0]?.message ?? 'Pasibaigęs automobilio terminas. Važiuoti negalima.';
}
