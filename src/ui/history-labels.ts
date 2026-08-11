import type { DeliveryStop, Route } from '@/domain/route';

export function deliveryStatusLabel(status: DeliveryStop['deliveryStatus']): string {
  if (status === 'delivered') return 'Pristatyta';
  if (status === 'failed') return 'Nepavyko pristatyti';
  return 'Nepristatyta';
}

export function loadingStatusLabel(status: DeliveryStop['loadingStatus']): string {
  return status === 'loaded' ? 'Pakrauta' : 'Nepakrauta';
}

export function routeStatusLabel(status: Route['status']): string {
  switch (status) {
    case 'draft':
      return 'Juodraštis';
    case 'planned':
      return 'Suplanuotas';
    case 'loading':
      return 'Krovimas';
    case 'loaded':
      return 'Paruoštas';
    case 'in_progress':
      return 'Vykdomas';
    case 'completed':
      return 'Užbaigtas';
    case 'cancelled':
      return 'Atšauktas';
    default:
      return status;
  }
}

export function formatLithuanianDate(value: string): string {
  const date = new Date(value.length === 10 ? `${value}T12:00:00.000Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('lt-LT', {
    timeZone: 'Europe/Vilnius',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export function formatLithuanianDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('lt-LT', {
    timeZone: 'Europe/Vilnius',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
