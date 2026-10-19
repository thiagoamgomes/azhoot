/**
 * Métricas em memória no formato de texto do Prometheus (sem dependência externa).
 * Expostas em GET /metrics (proteja no proxy em produção).
 */
type Labels = Record<string, string>;

function key(name: string, labels?: Labels) {
  if (!labels || Object.keys(labels).length === 0) return name;
  const l = Object.entries(labels)
    .map(([k, v]) => `${k}="${v.replace(/"/g, '')}"`)
    .join(',');
  return `${name}{${l}}`;
}

export class Metrics {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histos = new Map<string, number[]>();

  inc(name: string, labels?: Labels, by = 1) {
    const k = key(name, labels);
    this.counters.set(k, (this.counters.get(k) ?? 0) + by);
  }

  gauge(name: string, value: number, labels?: Labels) {
    this.gauges.set(key(name, labels), value);
  }

  addGauge(name: string, delta: number, labels?: Labels) {
    const k = key(name, labels);
    this.gauges.set(k, (this.gauges.get(k) ?? 0) + delta);
  }

  observe(name: string, valueMs: number, labels?: Labels) {
    const k = key(name, labels);
    const arr = this.histos.get(k) ?? [];
    arr.push(valueMs);
    if (arr.length > 5000) arr.splice(0, arr.length - 5000);
    this.histos.set(k, arr);
  }

  percentile(name: string, p: number, labels?: Labels): number | null {
    const arr = [...(this.histos.get(key(name, labels)) ?? [])].sort((a, b) => a - b);
    if (arr.length === 0) return null;
    return arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))]!;
  }

  render(): string {
    const lines: string[] = [];
    for (const [k, v] of this.counters) lines.push(`${k} ${v}`);
    for (const [k, v] of this.gauges) lines.push(`${k} ${v}`);
    for (const [k, arr] of this.histos) {
      if (arr.length === 0) continue;
      const sorted = [...arr].sort((a, b) => a - b);
      const base = k.includes('{') ? k.slice(0, k.indexOf('{')) : k;
      const labels = k.includes('{') ? k.slice(k.indexOf('{') + 1, -1) : '';
      for (const q of [0.5, 0.95, 0.99]) {
        const v = sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
        lines.push(`${base}{${labels ? labels + ',' : ''}quantile="${q}"} ${v}`);
      }
      lines.push(`${base}_count${labels ? `{${labels}}` : ''} ${arr.length}`);
    }
    return lines.join('\n') + '\n';
  }
}
