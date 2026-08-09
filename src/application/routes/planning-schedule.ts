const DEFAULT_START_TIME = '04:00';

export function defaultPlanningDate(now = new Date()): string {
  const candidate = new Date(now);
  candidate.setHours(12, 0, 0, 0);
  candidate.setDate(candidate.getDate() + 1);
  while (candidate.getDay() === 0 || candidate.getDay() === 6) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return localDateValue(candidate);
}

export function defaultPlanningTime(): string {
  return DEFAULT_START_TIME;
}

export function planningDepartureIso(dateValue: string, timeValue: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || !/^\d{2}:\d{2}$/.test(timeValue)) return null;
  const [year, month, day] = dateValue.split('-').map(Number);
  const [hours, minutes] = timeValue.split(':').map(Number);
  if (hours > 23 || minutes > 59) return null;
  const local = new Date(year!, month! - 1, day, hours, minutes, 0, 0);
  if (
    local.getFullYear() !== year || local.getMonth() !== month! - 1 || local.getDate() !== day ||
    local.getHours() !== hours || local.getMinutes() !== minutes
  ) return null;
  return local.toISOString();
}

export function localDateValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
