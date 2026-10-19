import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { CREDIT_REASON_LABELS, formatBRL, type CreditTx } from '@azhoot/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  Skeleton,
} from '@azhoot/ui';
import { PageHeader } from '@/components/layout/AdminLayout';
import { describeError } from '@/lib/api';
import { buyCreditPack, CREDITS_KEY, useCredits } from '@/lib/ai';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';

export default function CreditsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const q = useCredits();
  const isOwner = user?.role === 'OWNER';
  const [buying, setBuying] = useState<string | null>(null);

  const buy = useMutation({
    mutationFn: (packId: string) => buyCreditPack(packId),
    onSuccess: (res) => {
      setBuying(null);
      void qc.invalidateQueries({ queryKey: CREDITS_KEY });
      if (res.invoiceUrl) window.open(res.invoiceUrl, '_blank', 'noopener');
    },
    onError: (e) => {
      setBuying(null);
      toast.error(describeError(e));
    },
  });

  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError)
    return (
      <ErrorState
        description={describeError(q.error)}
        action={<Button onClick={() => q.refetch()}>Tentar novamente</Button>}
      />
    );

  const { balance, packs, transactions } = q.data;

  return (
    <>
      <PageHeader
        title="Créditos de IA"
        description="Use créditos para gerar perguntas com IA. Só texto consome 1 crédito; com anexos, 2. Créditos comprados não expiram."
      />

      {/* Saldo atual */}
      <Card className="relative mb-8 overflow-hidden border-primary/40">
        <div
          className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-primary via-violet-500 to-primary"
          aria-hidden
        />
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
          <div className="flex items-center gap-4">
            <span className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Sparkles className="size-7" aria-hidden />
            </span>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Saldo atual</p>
              <p className="font-display text-4xl font-bold tabular-nums">
                {balance}
                <span className="ml-1.5 text-base font-normal text-muted-foreground">créditos</span>
              </p>
            </div>
          </div>
          <p className="max-w-xs text-sm text-muted-foreground">
            Cada geração de perguntas consome <strong>1 crédito</strong> (ou{' '}
            <strong>2 com anexo</strong>). Escolha um pacote abaixo para adicionar mais.
          </p>
        </CardContent>
      </Card>

      {/* Pacotes */}
      <div className="mb-4 flex items-end justify-between">
        <h2 className="font-display text-lg font-semibold">Comprar créditos</h2>
        <Badge variant="accent" className="text-sm">
          Não expiram
        </Badge>
      </div>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {packs.map((p) => (
          <Card key={p.id} className="flex flex-col">
            <CardContent className="flex flex-1 flex-col gap-3 pt-6 text-center">
              <p className="font-display text-3xl font-bold">{p.credits}</p>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">créditos</p>
              <p className="mt-auto text-lg font-semibold">{formatBRL(p.priceCents)}</p>
              <Button
                size="sm"
                className="w-full"
                disabled={!isOwner}
                loading={buying === p.id}
                onClick={() => {
                  setBuying(p.id);
                  buy.mutate(p.id);
                }}
              >
                <Wand2 aria-hidden /> Comprar
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      {!isOwner && (
        <p className="mt-2 text-xs text-muted-foreground">
          Somente o dono da conta pode comprar créditos.
        </p>
      )}

      {/* Histórico */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Movimentações</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {transactions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma movimentação até agora.</p>
          ) : (
            <table className="w-full min-w-[520px] text-sm">
              <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2">
                    Quando
                  </th>
                  <th scope="col" className="py-2">
                    Motivo
                  </th>
                  <th scope="col" className="py-2 text-right">
                    Créditos
                  </th>
                  <th scope="col" className="py-2 text-right">
                    Saldo
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {transactions.map((t: CreditTx) => (
                  <tr key={t.id}>
                    <td className="py-2">{formatDateTime(t.createdAt)}</td>
                    <td className="py-2">
                      {CREDIT_REASON_LABELS[t.reason] ?? t.reason}
                      {t.note && <span className="text-muted-foreground"> · {t.note}</span>}
                    </td>
                    <td
                      className={
                        'py-2 text-right font-semibold tabular-nums ' +
                        (t.delta >= 0 ? 'text-success-strong' : 'text-danger')
                      }
                    >
                      {t.delta >= 0 ? `+${t.delta}` : t.delta}
                    </td>
                    <td className="py-2 text-right tabular-nums">{t.balanceAfter}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
