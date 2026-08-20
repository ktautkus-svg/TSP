import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Firestore } from '@google-cloud/firestore';
import { GatewayError } from './errors';

type UsagePeriod = { key: string; units: number; estimatedCostCents: number };
type UsageState = { periods: UsagePeriod[] };

export type UsageGuardConfig = {
  armed: boolean;
  dailyUnits: number;
  weeklyUnits: number;
  dailyBudgetCents: number | null;
  weeklyBudgetCents: number | null;
};

export interface GatewayUsageGuard {
  reserve(units: number, estimatedCostCents: number | null, now?: Date): Promise<void>;
}

export class FileGatewayUsageGuard implements GatewayUsageGuard {
  constructor(
    private readonly directory: string,
    private readonly config: UsageGuardConfig,
  ) {}

  async reserve(units: number, estimatedCostCents: number | null, now = new Date()): Promise<void> {
    if (!this.config.armed) {
      throw new GatewayError(
        'REAL_PROVIDER_DISABLED',
        'Realūs maršrutų provideriai išjungti. Pirmiausia aiškiai įjunkite saugų routing režimą su biudžetu.',
        503,
        false,
      );
    }
    const state = await this.read();
    const daily = periodKey(now, 'day');
    const weekly = periodKey(now, 'week');
    const dailyUsage = usageFor(state, daily);
    const weeklyUsage = usageFor(state, weekly);
    const cost = Math.max(0, estimatedCostCents ?? 0);
    if (dailyUsage.units + units > this.config.dailyUnits) {
      throw budgetError('dienos', this.config.dailyUnits);
    }
    if (weeklyUsage.units + units > this.config.weeklyUnits) {
      throw budgetError('savaitės', this.config.weeklyUnits);
    }
    if (this.config.dailyBudgetCents !== null && dailyUsage.estimatedCostCents + cost > this.config.dailyBudgetCents) {
      throw budgetError('dienos pinigų', this.config.dailyBudgetCents);
    }
    if (this.config.weeklyBudgetCents !== null && weeklyUsage.estimatedCostCents + cost > this.config.weeklyBudgetCents) {
      throw budgetError('savaitės pinigų', this.config.weeklyBudgetCents);
    }
    addUsage(state, daily, units, cost);
    addUsage(state, weekly, units, cost);
    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, 'usage.json'), JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  private async read(): Promise<UsageState> {
    try {
      const parsed = JSON.parse(await readFile(join(this.directory, 'usage.json'), 'utf8')) as UsageState;
      return { periods: Array.isArray(parsed.periods) ? parsed.periods : [] };
    } catch {
      return { periods: [] };
    }
  }
}

export class MemoryGatewayUsageGuard implements GatewayUsageGuard {
  private readonly periods = new Map<string, UsagePeriod>();

  constructor(private readonly config: UsageGuardConfig) {}

  async reserve(units: number, estimatedCostCents: number | null, now = new Date()): Promise<void> {
    if (!this.config.armed) throw new GatewayError('REAL_PROVIDER_DISABLED', 'Realūs maršrutų provideriai išjungti.', 503, false);
    const cost = Math.max(0, estimatedCostCents ?? 0);
    const daily = this.period(periodKey(now, 'day'));
    const weekly = this.period(periodKey(now, 'week'));
    if (daily.units + units > this.config.dailyUnits) throw budgetError('dienos', this.config.dailyUnits);
    if (weekly.units + units > this.config.weeklyUnits) throw budgetError('savaitės', this.config.weeklyUnits);
    if (this.config.dailyBudgetCents !== null && daily.estimatedCostCents + cost > this.config.dailyBudgetCents) throw budgetError('dienos pinigų', this.config.dailyBudgetCents);
    if (this.config.weeklyBudgetCents !== null && weekly.estimatedCostCents + cost > this.config.weeklyBudgetCents) throw budgetError('savaitės pinigų', this.config.weeklyBudgetCents);
    daily.units += units; daily.estimatedCostCents += cost;
    weekly.units += units; weekly.estimatedCostCents += cost;
  }

  private period(key: string): UsagePeriod {
    const existing = this.periods.get(key);
    if (existing) return existing;
    const created = { key, units: 0, estimatedCostCents: 0 };
    this.periods.set(key, created);
    return created;
  }
}

export class FirestoreGatewayUsageGuard implements GatewayUsageGuard {
  private readonly db = new Firestore();
  private readonly reference = this.db.collection('tsp_gateway_usage').doc('global');

  constructor(private readonly config: UsageGuardConfig) {}

  async reserve(units: number, estimatedCostCents: number | null, now = new Date()): Promise<void> {
    if (!this.config.armed) throw new GatewayError('REAL_PROVIDER_DISABLED', 'Realūs maršrutų provideriai išjungti.', 503, false);
    const cost = Math.max(0, estimatedCostCents ?? 0);
    const dailyKey = periodKey(now, 'day');
    const weeklyKey = periodKey(now, 'week');
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(this.reference);
      const periods = (snapshot.data()?.periods ?? {}) as Record<string, UsagePeriod>;
      const daily = periods[dailyKey] ?? { key: dailyKey, units: 0, estimatedCostCents: 0 };
      const weekly = periods[weeklyKey] ?? { key: weeklyKey, units: 0, estimatedCostCents: 0 };
      if (daily.units + units > this.config.dailyUnits) throw budgetError('dienos', this.config.dailyUnits);
      if (weekly.units + units > this.config.weeklyUnits) throw budgetError('savaitės', this.config.weeklyUnits);
      if (this.config.dailyBudgetCents !== null && daily.estimatedCostCents + cost > this.config.dailyBudgetCents) throw budgetError('dienos pinigų', this.config.dailyBudgetCents);
      if (this.config.weeklyBudgetCents !== null && weekly.estimatedCostCents + cost > this.config.weeklyBudgetCents) throw budgetError('savaitės pinigų', this.config.weeklyBudgetCents);
      transaction.set(this.reference, {
        periods: {
          ...periods,
          [dailyKey]: { ...daily, units: daily.units + units, estimatedCostCents: daily.estimatedCostCents + cost },
          [weeklyKey]: { ...weekly, units: weekly.units + units, estimatedCostCents: weekly.estimatedCostCents + cost },
        },
        updatedAt: now.toISOString(),
      });
    });
  }
}

function usageFor(state: UsageState, key: string): UsagePeriod {
  return state.periods.find((period) => period.key === key) ?? { key, units: 0, estimatedCostCents: 0 };
}

function addUsage(state: UsageState, key: string, units: number, cost: number): void {
  const existing = state.periods.find((period) => period.key === key);
  if (existing) { existing.units += units; existing.estimatedCostCents += cost; return; }
  state.periods.push({ key, units, estimatedCostCents: cost });
}

function periodKey(date: Date, period: 'day' | 'week'): string {
  const iso = date.toISOString().slice(0, 10);
  if (period === 'day') return `day:${iso}`;
  const start = new Date(date);
  const day = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - day + 1);
  return `week:${start.toISOString().slice(0, 10)}`;
}

function budgetError(period: string, limit: number): GatewayError {
  return new GatewayError('ROUTING_BUDGET_EXCEEDED', `Viršytas ${period} routing biudžetas (${limit} vienetų).`, 429, false, { limit, period });
}
