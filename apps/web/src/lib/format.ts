const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: TZ,
  });
}

export function formatTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  });
}

export function formatNumber(n: number) {
  return n.toLocaleString('pt-BR');
}

export function formatPercent(v: number | null | undefined) {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}

export function formatSeconds(ms: number | null | undefined) {
  return ms == null
    ? '—'
    : `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`;
}

export function ordinal(n: number) {
  return `${n}º`;
}

export function formatPin(pin: string | null | undefined) {
  if (!pin) return '——— ———';
  return `${pin.slice(0, 3)} ${pin.slice(3)}`;
}
