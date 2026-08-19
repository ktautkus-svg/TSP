import { vehicleLoadPercent } from '@/domain/vehicle-load';
import { formatWeightKg } from '@/ui/format-weight';

export type VehicleLoadView = {
  percent: number;
  overCapacity: boolean;
  percentLabel: string;
  ratioLabel: string;
  summaryLabel: string;
};

export function describeVehicleLoad(
  weightKg: number,
  payloadKg: number | null | undefined,
): VehicleLoadView | null {
  const percent = vehicleLoadPercent(weightKg, payloadKg ?? Number.NaN);
  if (percent === null || payloadKg == null) return null;
  const percentLabel = `${new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 0 }).format(Math.round(percent))}%`;
  const ratioLabel = `${formatWeightKg(weightKg)} / ${formatWeightKg(payloadKg)} kg`;
  return {
    percent,
    overCapacity: percent > 100,
    percentLabel,
    ratioLabel,
    summaryLabel: `Apkrova ${percentLabel} · ${ratioLabel}`,
  };
}
