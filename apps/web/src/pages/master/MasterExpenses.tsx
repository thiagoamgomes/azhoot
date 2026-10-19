import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Select,
  Skeleton,
} from '@azhoot/ui';
import { PageHeader } from '@/components/layout/AdminLayout';
import { api, describeError } from '@/lib/api';
import {
  brl,
  formatDate,
  Kpi,
  moneyInput,
  monthsAgoISO,
  parseMoney,
  Table,
  td,
  th,
  todayISO,
} from './shared';

export const EXPENSE_CATEGORIES = {
  MARKETING: 'Marketing / anúncios',
  INFRA: 'Infraestrutura',
  PESSOAL: 'Pessoal',
  IMPOSTOS: 'Impostos e taxas',
  FERRAMENTAS: 'Ferramentas',
  OUTROS: 'Outros',
} as const;
type Category = keyof typeof EXPENSE_CATEGORIES;

interface Expense {
  id: string;
  description: string;
  category: Category;
  channel: string | null;
  amountCents: number;
  date: string;
}

const empty = () => ({
  description: '',
  category: 'MARKETING' as Category,
  channel: '',
  amount: '',
  date: todayISO(),
});

export default function MasterExpenses() {
  const qc = useQueryClient();
  const [from, setFrom] = useState(monthsAgoISO(3));
  const [to, setTo] = useState(todayISO());
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [form, setForm] = useState(empty());
  const [error, setError] = useState<string | null>(null);
  const [remove, setRemove] = useState<Expense | null>(null);

  const q = useQuery({
    queryKey: ['master', 'expenses', from, to],
    queryFn: () =>
      api<{ items: Expense[]; totalCents: number }>(
        `/master/expenses?${new URLSearchParams({ from, to })}`,
      ),
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['master'] });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing && editing !== 'new'
        ? api(`/master/expenses/${editing.id}`, { method: 'PUT', body })
        : api('/master/expenses', { body }),
    onSuccess: () => {
      invalidate();
      setEditing(null);
      toast.success('Despesa salva.');
    },
    onError: (e) => setError(describeError(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/master/expenses/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate();
      setRemove(null);
      toast.success('Despesa excluída.');
    },
    onError: (e) => toast.error(describeError(e)),
  });

  function open(e: Expense | 'new') {
    setError(null);
    setForm(
      e === 'new'
        ? empty()
        : {
            description: e.description,
            category: e.category,
            channel: e.channel ?? '',
            amount: moneyInput(e.amountCents),
            date: e.date,
          },
    );
    setEditing(e);
  }

  function submit(ev: FormEvent) {
    ev.preventDefault();
    const amountCents = parseMoney(form.amount);
    if (form.description.trim().length < 2) return setError('Informe uma descrição.');
    if (!amountCents) return setError('Informe um valor maior que zero.');
    if (!form.date) return setError('Informe a data.');
    setError(null);
    save.mutate({
      description: form.description.trim(),
      category: form.category,
      channel: form.channel.trim() || null,
      amountCents,
      date: form.date,
    });
  }

  const items = q.data?.items ?? [];
  const byCat = items.reduce<Record<string, number>>(
    (a, e) => ({ ...a, [e.category]: (a[e.category] ?? 0) + e.amountCents }),
    {},
  );

  return (
    <>
      <PageHeader
        title="Despesas"
        description="Registre custos para calcular CAC, ROI e ROAS. Despesas de marketing entram no CAC e no ROAS."
        actions={
          <Button onClick={() => open('new')}>
            <Plus className="size-4" aria-hidden /> Nova despesa
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">De</span>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Data inicial"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">até</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="Data final"
          />
        </label>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Kpi
          label="Total no período"
          value={brl(q.data?.totalCents ?? 0)}
          hint={`${items.length} lançamentos`}
        />
        <Kpi label="Marketing" value={brl(byCat.MARKETING ?? 0)} />
        <Kpi label="Infraestrutura" value={brl(byCat.INFRA ?? 0)} />
        <Kpi
          label="Demais"
          value={brl((q.data?.totalCents ?? 0) - (byCat.MARKETING ?? 0) - (byCat.INFRA ?? 0))}
        />
      </div>

      {q.isPending ? (
        <Skeleton className="h-80" />
      ) : q.isError ? (
        <ErrorState description={describeError(q.error)} />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nenhuma despesa no período"
          description="Lance anúncios, servidores e ferramentas para ter CAC e ROI reais."
          action={<Button onClick={() => open('new')}>Lançar despesa</Button>}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Data</th>
              <th className={th}>Descrição</th>
              <th className={th}>Categoria</th>
              <th className={`${th} text-right`}>Valor</th>
              <th className={th}>
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((e) => (
              <tr key={e.id}>
                <td className={td}>{formatDate(e.date)}</td>
                <td className={td}>
                  {e.description}
                  {e.channel && <p className="text-xs text-muted-foreground">Canal: {e.channel}</p>}
                </td>
                <td className={td}>
                  <Badge variant={e.category === 'MARKETING' ? 'accent' : 'muted'}>
                    {EXPENSE_CATEGORIES[e.category]}
                  </Badge>
                </td>
                <td className={`${td} text-right tabular-nums`}>{brl(e.amountCents)}</td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Editar ${e.description}`}
                    onClick={() => open(e)}
                  >
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Excluir ${e.description}`}
                    onClick={() => setRemove(e)}
                  >
                    <Trash2 className="size-4 text-danger" aria-hidden />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>{editing === 'new' ? 'Nova despesa' : 'Editar despesa'}</DialogTitle>
              <DialogDescription>Valores em reais.</DialogDescription>
            </DialogHeader>
            <Field id="exp-desc" label="Descrição">
              {(p) => (
                <Input
                  {...p}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  maxLength={200}
                  autoFocus
                />
              )}
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="exp-cat" label="Categoria">
                {(p) => (
                  <Select
                    {...p}
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
                  >
                    {Object.entries(EXPENSE_CATEGORIES).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="exp-channel" label="Canal (opcional)" hint="Ex.: Google Ads, Instagram">
                {(p) => (
                  <Input
                    {...p}
                    value={form.channel}
                    onChange={(e) => setForm({ ...form, channel: e.target.value })}
                    maxLength={60}
                  />
                )}
              </Field>
              <Field id="exp-amount" label="Valor (R$)">
                {(p) => (
                  <Input
                    {...p}
                    inputMode="decimal"
                    placeholder="0,00"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  />
                )}
              </Field>
              <Field id="exp-date" label="Data">
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                  />
                )}
              </Field>
            </div>
            {error && <Alert variant="danger">{error}</Alert>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button type="submit" loading={save.isPending}>
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!remove}
        onOpenChange={(o) => !o && setRemove(null)}
        title="Excluir despesa?"
        description={remove ? `${remove.description} — ${brl(remove.amountCents)}` : ''}
        confirmLabel="Excluir"
        destructive
        loading={del.isPending}
        onConfirm={() => remove && del.mutate(remove.id)}
      />
    </>
  );
}
