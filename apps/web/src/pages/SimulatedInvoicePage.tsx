import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, CreditCard, FileText, QrCode } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatBRL, PAYMENT_STATUS_LABELS, type PaymentDto } from '@azhoot/contracts';
import { Alert, Button, Card, CardContent, cn, ErrorState, Logo, Spinner } from '@azhoot/ui';
import { api, describeError } from '@/lib/api';

const METHODS = [
  { id: 'PIX', label: 'PIX', icon: QrCode },
  { id: 'BOLETO', label: 'Boleto', icon: FileText },
  { id: 'CREDIT_CARD', label: 'Cartão', icon: CreditCard },
] as const;

/** Fatura do provedor simulado (desenvolvimento). Em produção o cliente paga na fatura do Asaas. */
export default function SimulatedInvoicePage() {
  const { providerId = '' } = useParams();
  const [method, setMethod] = useState<(typeof METHODS)[number]['id']>('PIX');
  const q = useQuery({
    queryKey: ['sim-invoice', providerId],
    queryFn: () => api<PaymentDto>(`/billing/simulated/${providerId}`),
  });
  const pay = useMutation({
    mutationFn: () =>
      api<PaymentDto>(`/billing/simulated/${providerId}/pay`, { body: { billingType: method } }),
    onSuccess: () => q.refetch(),
  });
  const paid = q.data && (q.data.status === 'RECEIVED' || q.data.status === 'CONFIRMED');
  return (
    <div className="grid min-h-dvh place-items-center bg-muted px-4 py-10">
      <div className="w-full max-w-md">
        <Logo className="mb-6 justify-center" />
        <Card>
          <CardContent className="grid gap-5 pt-6">
            <Alert variant="warning">
              Ambiente de testes: esta fatura é simulada e nenhum valor é cobrado.
            </Alert>
            {q.isPending ? (
              <Spinner />
            ) : q.isError ? (
              <ErrorState description={describeError(q.error)} />
            ) : (
              <>
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">{q.data.description}</p>
                  <p className="font-display text-4xl font-bold">{formatBRL(q.data.amountCents)}</p>
                  <p className="text-sm text-muted-foreground">
                    Vencimento {new Date(q.data.dueDate).toLocaleDateString('pt-BR')} ·{' '}
                    {PAYMENT_STATUS_LABELS[q.data.status]}
                  </p>
                </div>
                {paid ? (
                  <div className="grid justify-items-center gap-3 text-center">
                    <CheckCircle2 className="size-14 text-success" aria-hidden />
                    <p className="text-lg font-semibold">Pagamento confirmado!</p>
                    <Button asChild>
                      <Link to="/planos">Voltar ao AZhoot</Link>
                    </Button>
                  </div>
                ) : (
                  <>
                    <div
                      className="grid grid-cols-3 gap-2"
                      role="radiogroup"
                      aria-label="Forma de pagamento"
                    >
                      {METHODS.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          role="radio"
                          aria-checked={method === m.id}
                          onClick={() => setMethod(m.id)}
                          className={cn(
                            'grid min-h-20 place-items-center gap-1 rounded-xl border text-sm font-semibold',
                            method === m.id
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border',
                          )}
                        >
                          <m.icon className="size-6" aria-hidden />
                          {m.label}
                        </button>
                      ))}
                    </div>
                    <Button size="lg" loading={pay.isPending} onClick={() => pay.mutate()}>
                      Pagar {formatBRL(q.data.amountCents)} (simulação)
                    </Button>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
