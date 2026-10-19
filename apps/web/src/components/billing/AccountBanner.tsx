import { AlertTriangle, Snowflake } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatBRL } from '@azhoot/contracts';
import { Button } from '@azhoot/ui';
import { useBilling } from '@/lib/billing';
import { formatDateTime } from '@/lib/format';

/** Faixa de atraso (topo) — a versão grande de conta congelada fica no dashboard. */
export function PastDueStrip() {
  const { data } = useBilling();
  if (!data || data.subscriptionStatus !== 'PAST_DUE' || !data.openPayment) return null;
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-3 bg-warning px-4 py-2 text-sm font-medium text-slate-950"
      role="status"
    >
      <AlertTriangle className="size-4" aria-hidden />
      Sua fatura de {formatBRL(data.openPayment.amountCents)} venceu em{' '}
      {formatDateTime(data.openPayment.dueDate).split(' ')[0]}. Pague para evitar o congelamento da
      conta.
      {data.openPayment.invoiceUrl && (
        <a
          href={data.openPayment.invoiceUrl}
          target="_blank"
          rel="noreferrer"
          className="font-semibold underline"
        >
          Pagar agora
        </a>
      )}
    </div>
  );
}

export function FrozenBanner() {
  const { data } = useBilling();
  if (!data || data.subscriptionStatus !== 'FROZEN') return null;
  return (
    <section
      className="mb-6 overflow-hidden rounded-3xl border-2 border-danger/40 bg-gradient-to-br from-red-50 to-amber-50 p-6 text-slate-900 dark:from-red-950/60 dark:to-amber-950/40 dark:text-slate-50 sm:p-8"
      role="alert"
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-danger text-white">
          <Snowflake className="size-9" aria-hidden />
        </div>
        <div className="flex-1">
          <h2 className="text-2xl font-bold">Sua conta está congelada</h2>
          <p className="mt-1 text-base">
            A fatura {data.openPayment ? `de ${formatBRL(data.openPayment.amountCents)} ` : ''}está
            em aberto há mais de 5 dias. Você ainda vê seus quizzes e relatórios, mas não pode
            criar, editar nem abrir salas até regularizar.
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        {data.openPayment?.invoiceUrl && (
          <Button asChild size="lg" variant="destructive">
            <a href={data.openPayment.invoiceUrl} target="_blank" rel="noreferrer">
              Pagar agora e liberar a conta
            </a>
          </Button>
        )}
        <Button asChild size="lg" variant="outline">
          <Link to="/planos?cancelar=1">Voltar ao plano Gratuito</Link>
        </Button>
      </div>
    </section>
  );
}
