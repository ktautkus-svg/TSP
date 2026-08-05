export type TimeCategoryMinutes = {
  driving: number;
  service: number;
  waiting: number;
  break: number;
  unplannedIdle: number;
  other: number;
};

export type TimeKpis = {
  schedulePerformancePercent: number | null;
  schedulePerformanceDisplayPercent: number | null;
  savedOrLostMinutes: number | null;
  productiveTimePercent: number | null;
};

export function calculateTimeKpis(
  plannedDurationMinutes: number | null,
  actualDurationMinutes: number | null,
  categories?: TimeCategoryMinutes,
): TimeKpis {
  validateOptionalDuration(plannedDurationMinutes);
  validateOptionalDuration(actualDurationMinutes);

  const hasScheduleKpi =
    plannedDurationMinutes !== null &&
    actualDurationMinutes !== null &&
    actualDurationMinutes > 0;

  const schedulePerformancePercent = hasScheduleKpi
    ? (plannedDurationMinutes / actualDurationMinutes) * 100
    : null;

  let productiveTimePercent: number | null = null;
  if (categories) {
    const values = Object.values(categories);
    if (values.some((value) => !Number.isFinite(value) || value < 0)) {
      throw new Error('Laiko kategorijos turi būti neneigiami skaičiai.');
    }
    const categorizedTotal = values.reduce((sum, value) => sum + value, 0);
    if (categorizedTotal > 0) {
      productiveTimePercent =
        ((categories.driving + categories.service) / categorizedTotal) * 100;
    }
  }

  return {
    schedulePerformancePercent,
    schedulePerformanceDisplayPercent:
      schedulePerformancePercent === null ? null : Math.min(schedulePerformancePercent, 100),
    savedOrLostMinutes: hasScheduleKpi
      ? plannedDurationMinutes - actualDurationMinutes
      : null,
    productiveTimePercent,
  };
}

function validateOptionalDuration(value: number | null): void {
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    throw new Error('Trukmė turi būti neneigiama.');
  }
}
