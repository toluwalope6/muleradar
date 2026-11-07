const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: number, currency: string): string {
  let f = moneyFormatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat('en-IE', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2 });
    moneyFormatters.set(currency, f);
  }
  return f.format(amount);
}

const wholeFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoneyWhole(amount: number, currency: string): string {
  if (!Number.isInteger(amount)) return formatMoney(amount, currency);
  let f = wholeFormatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat('en-IE', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 });
    wholeFormatters.set(currency, f);
  }
  return f.format(amount);
}

export function formatMoneyShort(amount: number, currency: string): string {
  const symbol = currency === 'EUR' ? '€' : `${currency} `;
  if (amount >= 1000) return `${symbol}${(amount / 1000).toFixed(amount % 1000 === 0 ? 0 : 1)}k`;
  return `${symbol}${amount.toFixed(0)}`;
}

const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function formatDateTime(iso: string): string {
  return `${dateTimeFmt.format(new Date(iso))} UTC`;
}

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

export function hoursBetween(startIso: string, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 3_600_000;
}

export function formatDuration(startIso: string, endIso: string): string {
  const totalMinutes = Math.round(hoursBetween(startIso, endIso) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`;
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}
