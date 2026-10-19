import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { PIX_KEY_LABELS } from '@azhoot/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
import { brl, formatDate, pct, Table, td, th } from './shared';

interface Resp {
  affiliates: {
    accountId: string;
    name: string;
    pixKeyType: string | null;
    pixKey: string | null;
    pendingCents: number;
    count: number;
  }[];
  items: {
    id: string;
    affiliateAccountId: string;
    affiliateName: string;
    referredName: string;
    baseAmountCents: number;
    percentBp: number;
    amountCents: number;
    status: string;
    createdAt: string;
    paidAt: string | null;
    paidNote: string | null;
  }[];
}

export default function MasterAffiliates() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('PENDING');
  const [paying, setPaying] = useState<Resp['affiliates'][number] | null>(null);
  const [note, setNote] = useState('');
  const pendingQ = useQuery({
    queryKey: ['master', 'commissions', 'PENDING'],
    queryFn: () => api<Resp>('/master/commissions?status=PENDING'),
  });
  const listQ = useQuery({
    queryKey: ['master', 'commissions', status],
    queryFn: () => api<Resp>(`/master/commissions?status=${status}`),
  });
  const pay = useMutation({
    mutationFn: (accountId: string) =>
      api<{ paid: number }>('/master/commissions/pay', {
        body: { affiliateAccountId: accountId, note: note.trim() || undefined },
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['master'] });
      setPaying(null);
      setNote('');
      toast.success(`${r.paid} comissões marcadas como pagas.`);
    },
    onError: (e) => toast.error(describeError(e)),
  });

  return (
    <>
      <PageHeader
        title="Afiliados"
        description="Repasses por PIX são feitos manualmente: pague pela chave do afiliado e marque como pago aqui."
      />
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>A pagar por afiliado</CardTitle>
          <CardDescription>
            Comissões pendentes agrupadas, com a chave PIX cadastrada.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pendingQ.isPending ? (
            <Skeleton className="h-32" />
          ) : pendingQ.isError ? (
            <ErrorState description={describeError(pendingQ.error)} />
          ) : pendingQ.data.affiliates.length === 0 ? (
            <EmptyState title="Nada a pagar" description="Nenhuma comissão pendente no momento." />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {pendingQ.data.affiliates.map((a) => (
                <li key={a.accountId} className="grid gap-3 rounded-2xl border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link
                        to={`/master/usuarios/${a.accountId}`}
                        className="font-semibold hover:underline"
                      >
                        {a.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{a.count} comissões pendentes</p>
                    </div>
                    <p className="font-display text-xl font-bold tabular-nums">
                      {brl(a.pendingCents)}
                    </p>
                  </div>
                  {a.pixKey ? (
                    <div className="flex items-center gap-2 rounded-lg bg-muted p-2 text-sm">
                      <span className="flex-1 truncate">
                        <span className="text-muted-foreground">
                          {PIX_KEY_LABELS[a.pixKeyType as keyof typeof PIX_KEY_LABELS] ??
                            a.pixKeyType}
                          :{' '}
                        </span>
                        <span className="font-mono">{a.pixKey}</span>
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Copiar chave PIX"
                        onClick={() => {
                          void navigator.clipboard.writeText(a.pixKey ?? '');
                          toast.success('Chave copiada!');
                        }}
                      >
                        <Copy className="size-4" aria-hidden />
                      </Button>
                    </div>
                  ) : (
                    <p className="rounded-lg bg-warning/10 p-2 text-sm">
                      Sem chave PIX cadastrada — peça ao afiliado para cadastrar em “Indique e
                      ganhe”.
                    </p>
                  )}
                  <Button onClick={() => setPaying(a)}>Marcar como pago</Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">Histórico de comissões</h2>
        <Select
          aria-label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-auto"
        >
          <option value="PENDING">A pagar</option>
          <option value="PAID">Pagas</option>
          <option value="CANCELED">Canceladas</option>
          <option value="ALL">Todas</option>
        </Select>
      </div>
      {listQ.isPending ? (
        <Skeleton className="h-64" />
      ) : listQ.isError ? (
        <ErrorState description={describeError(listQ.error)} />
      ) : listQ.data.items.length === 0 ? (
        <EmptyState title="Nenhuma comissão" />
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Afiliado</th>
              <th className={th}>Indicado</th>
              <th className={`${th} text-right`}>Pagamento</th>
              <th className={`${th} text-right`}>Comissão</th>
              <th className={th}>Status</th>
              <th className={th}>Data</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {listQ.data.items.map((c) => (
              <tr key={c.id}>
                <td className={td}>
                  <Link to={`/master/usuarios/${c.affiliateAccountId}`} className="hover:underline">
                    {c.affiliateName}
                  </Link>
                </td>
                <td className={td}>{c.referredName}</td>
                <td className={`${td} text-right tabular-nums`}>{brl(c.baseAmountCents)}</td>
                <td className={`${td} text-right tabular-nums`}>
                  {brl(c.amountCents)}{' '}
                  <span className="text-xs text-muted-foreground">({pct(c.percentBp)})</span>
                </td>
                <td className={td}>
                  <Badge
                    variant={
                      c.status === 'PAID' ? 'success' : c.status === 'PENDING' ? 'warning' : 'muted'
                    }
                  >
                    {c.status === 'PAID'
                      ? 'Paga'
                      : c.status === 'PENDING'
                        ? 'A pagar'
                        : 'Cancelada'}
                  </Badge>
                  {c.paidNote && <p className="text-xs text-muted-foreground">{c.paidNote}</p>}
                </td>
                <td className={`${td} text-xs`}>{formatDate(c.paidAt ?? c.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Dialog open={!!paying} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar repasse para {paying?.name}</DialogTitle>
            <DialogDescription>
              Faça o PIX de {brl(paying?.pendingCents ?? 0)} e confirme. Todas as {paying?.count}{' '}
              comissões pendentes serão marcadas como pagas.
            </DialogDescription>
          </DialogHeader>
          <Field id="pay-note" label="Observação (opcional)" hint="Ex.: ID da transação PIX">
            {(p) => (
              <Input
                {...p}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
              />
            )}
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPaying(null)}>
              Cancelar
            </Button>
            <Button loading={pay.isPending} onClick={() => paying && pay.mutate(paying.accountId)}>
              Confirmar pagamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
