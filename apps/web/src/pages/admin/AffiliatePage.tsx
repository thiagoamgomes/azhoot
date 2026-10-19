import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Gift, Share2, Users, Wallet } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  formatBRL,
  PIX_KEY_LABELS,
  PIX_KEY_TYPES,
  pixSchema,
  type AffiliateOverview,
} from '@azhoot/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  Field,
  Input,
  Select,
  Skeleton,
} from '@azhoot/ui';
import { PageHeader } from '@/components/layout/AdminLayout';
import { api, describeError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

const pct = (bp: number) => `${(bp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const PLAN_NAMES: Record<string, string> = { FREE: 'Gratuito', MONTHLY: 'Mensal', YEARLY: 'Anual' };

export default function AffiliatePage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['affiliate'],
    queryFn: () => api<AffiliateOverview>('/account/affiliate'),
  });
  const [pix, setPix] = useState({
    pixKeyType: 'EMAIL' as (typeof PIX_KEY_TYPES)[number],
    pixKey: '',
  });
  const [pixError, setPixError] = useState<string | null>(null);
  useEffect(() => {
    if (q.data?.pixKeyType)
      setPix({
        pixKeyType: q.data.pixKeyType as (typeof PIX_KEY_TYPES)[number],
        pixKey: q.data.pixKey ?? '',
      });
  }, [q.data]);
  const save = useMutation({
    mutationFn: () =>
      api<AffiliateOverview>('/account/affiliate/pix', { method: 'PUT', body: pix }),
    onSuccess: (d) => {
      qc.setQueryData(['affiliate'], d);
      toast.success('Chave PIX salva.');
    },
    onError: (e) => setPixError(describeError(e)),
  });

  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState description={describeError(q.error)} />;
  const d = q.data;

  function submit(e: FormEvent) {
    e.preventDefault();
    const p = pixSchema.safeParse(pix);
    if (!p.success) return setPixError(p.error.issues[0]!.message);
    setPixError(null);
    save.mutate();
  }

  async function copy() {
    await navigator.clipboard.writeText(d.link).catch(() => undefined);
    toast.success('Link copiado!');
  }

  async function share() {
    if (navigator.share)
      await navigator
        .share({ title: 'AZhoot', text: 'Crie quizzes ao vivo com o AZhoot:', url: d.link })
        .catch(() => undefined);
    else void copy();
  }

  return (
    <>
      <PageHeader
        title="Indique e ganhe"
        description="Compartilhe seu link: a cada pagamento de quem se cadastrar por ele, você recebe uma comissão."
      />
      <Card className="mb-6 overflow-hidden border-primary/30">
        <CardContent className="grid gap-4 bg-gradient-to-br from-primary/10 via-transparent to-violet-500/10 pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid size-12 place-items-center rounded-2xl bg-primary text-white">
              <Gift className="size-6" aria-hidden />
            </span>
            <div>
              <p className="text-sm text-muted-foreground">Seu percentual</p>
              <p className="font-display text-3xl font-bold">{pct(d.percentBp)}</p>
            </div>
            <p className="ml-auto max-w-md text-sm text-muted-foreground">
              Você ganha em todo pagamento do indicado — mensalmente no plano Mensal, anualmente no
              plano Anual.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor="aff-link" className="sr-only">
              Seu link exclusivo
            </label>
            <Input
              id="aff-link"
              readOnly
              value={d.link}
              className="font-mono text-sm"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button onClick={copy}>
              <Copy /> Copiar link
            </Button>
            <Button variant="outline" onClick={share}>
              <Share2 /> Compartilhar
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Indicações', String(d.totals.referrals), Users],
          ['Pagantes', String(d.totals.paying), Users],
          ['A receber', formatBRL(d.totals.pendingCents), Wallet],
          ['Já recebido', formatBRL(d.totals.paidCents), Wallet],
        ].map(([label, value, Icon]) => {
          const I = Icon as typeof Users;
          return (
            <Card key={label as string} className="p-5">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                {label as string} <I className="size-4" aria-hidden />
              </div>
              <p className="mt-2 font-display text-2xl font-bold">{value as string}</p>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader>
            <CardTitle>Conta PIX para receber</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-4" noValidate>
              <Field id="pix-type" label="Tipo de chave">
                {(p) => (
                  <Select
                    {...p}
                    value={pix.pixKeyType}
                    onChange={(e) =>
                      setPix({
                        ...pix,
                        pixKeyType: e.target.value as (typeof PIX_KEY_TYPES)[number],
                      })
                    }
                  >
                    {PIX_KEY_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {PIX_KEY_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="pix-key" label="Chave PIX" error={pixError}>
                {(p) => (
                  <Input
                    {...p}
                    value={pix.pixKey}
                    onChange={(e) => setPix({ ...pix, pixKey: e.target.value })}
                  />
                )}
              </Field>
              <Button type="submit" className="w-fit" loading={save.isPending}>
                Salvar chave PIX
              </Button>
              <p className="text-xs text-muted-foreground">
                Os pagamentos das comissões são feitos manualmente pela equipe AZhoot para esta
                chave.
              </p>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Suas indicações</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {d.referrals.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ninguém se cadastrou pelo seu link ainda. Que tal enviar para alguém hoje?
              </p>
            ) : (
              <table className="w-full min-w-[480px] text-sm">
                <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-2">
                      Indicado
                    </th>
                    <th scope="col" className="py-2">
                      Plano
                    </th>
                    <th scope="col" className="py-2">
                      Pagou?
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Você ganhou
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {d.referrals.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2">
                        {r.name}
                        <p className="text-xs text-muted-foreground">
                          desde {formatDateTime(r.createdAt).split(' ')[0]}
                        </p>
                      </td>
                      <td className="py-2">{PLAN_NAMES[r.planId] ?? r.planId}</td>
                      <td className="py-2">
                        {r.paying ? (
                          <Badge variant="success">Sim</Badge>
                        ) : (
                          <Badge variant="muted">Ainda não</Badge>
                        )}
                      </td>
                      <td className="py-2 text-right tabular-nums">{formatBRL(r.earnedCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Comissões</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {d.commissions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              As comissões aparecem aqui quando um indicado paga.
            </p>
          ) : (
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2">
                    Data
                  </th>
                  <th scope="col" className="py-2">
                    Indicado
                  </th>
                  <th scope="col" className="py-2 text-right">
                    Pagamento
                  </th>
                  <th scope="col" className="py-2 text-right">
                    %
                  </th>
                  <th scope="col" className="py-2 text-right">
                    Comissão
                  </th>
                  <th scope="col" className="py-2">
                    Situação
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.commissions.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2">{formatDateTime(c.createdAt).split(' ')[0]}</td>
                    <td className="py-2">{c.referredName}</td>
                    <td className="py-2 text-right tabular-nums">{formatBRL(c.baseAmountCents)}</td>
                    <td className="py-2 text-right tabular-nums">{pct(c.percentBp)}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">
                      {formatBRL(c.amountCents)}
                    </td>
                    <td className="py-2">
                      {c.status === 'PAID' ? (
                        <Badge variant="success">
                          Paga {c.paidAt ? `em ${formatDateTime(c.paidAt).split(' ')[0]}` : ''}
                        </Badge>
                      ) : c.status === 'PENDING' ? (
                        <Badge variant="warning">A receber</Badge>
                      ) : (
                        <Badge variant="muted">Cancelada</Badge>
                      )}
                    </td>
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
