import { randomUUID } from 'node:crypto';
import type { PaymentStatusCode } from '@azhoot/contracts';
import type { AppContext } from '../../context';
import { AppError } from '../../lib/errors';
import { getAsaasSettings } from '../platform/settings';

export interface ProviderPayment {
  id: string;
  subscriptionId: string | null;
  status: PaymentStatusCode;
  valueCents: number;
  netValueCents: number | null;
  dueDate: Date;
  paidAt: Date | null;
  invoiceUrl: string | null;
  billingType: string | null;
}

export interface CustomerInput {
  name: string;
  document: string;
  email: string;
  phone?: string | null;
  externalReference: string;
}

export interface SubscriptionInput {
  customerId: string;
  valueCents: number;
  cycle: 'MONTHLY' | 'YEARLY';
  nextDueDate: Date;
  description: string;
  externalReference: string;
}

/** Contrato comum dos provedores de cobrança (Asaas e simulado). */
export interface BillingProvider {
  readonly name: 'asaas' | 'simulated';
  createCustomer(input: CustomerInput): Promise<string>;
  createSubscription(
    input: SubscriptionInput,
  ): Promise<{ subscriptionId: string; payments: ProviderPayment[] }>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  getPayment(paymentId: string): Promise<ProviderPayment | null>;
  /** Cobrança avulsa (pagamento único), usada nos pacotes de créditos. */
  createCharge(input: ChargeInput): Promise<ProviderPayment>;
}

export interface ChargeInput {
  customerId: string;
  valueCents: number;
  dueDate: Date;
  description: string;
  externalReference: string;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** Datas do Asaas são dias (YYYY-MM-DD); fixamos 12:00 UTC para não trocar de dia no fuso de Brasília. */
export const parseDay = (s: string) => new Date(`${s}T12:00:00.000Z`);

export function mapAsaasStatus(s: string): PaymentStatusCode {
  switch (s) {
    case 'RECEIVED':
    case 'RECEIVED_IN_CASH':
      return 'RECEIVED';
    case 'CONFIRMED':
      return 'CONFIRMED';
    case 'OVERDUE':
      return 'OVERDUE';
    case 'REFUNDED':
    case 'REFUND_REQUESTED':
    case 'REFUND_IN_PROGRESS':
    case 'CHARGEBACK_REQUESTED':
    case 'CHARGEBACK_DISPUTE':
    case 'AWAITING_CHARGEBACK_REVERSAL':
      return 'REFUNDED';
    case 'DELETED':
      return 'CANCELED';
    default:
      return 'PENDING';
  }
}

export interface AsaasPaymentJson {
  id: string;
  subscription?: string | null;
  status: string;
  value: number;
  netValue?: number | null;
  dueDate: string;
  paymentDate?: string | null;
  confirmedDate?: string | null;
  clientPaymentDate?: string | null;
  invoiceUrl?: string | null;
  billingType?: string | null;
  deleted?: boolean;
}

export function fromAsaasPayment(p: AsaasPaymentJson): ProviderPayment {
  const paid = p.confirmedDate || p.paymentDate || p.clientPaymentDate;
  const status = p.deleted ? 'CANCELED' : mapAsaasStatus(p.status);
  return {
    id: p.id,
    subscriptionId: p.subscription ?? null,
    status,
    valueCents: Math.round(p.value * 100),
    netValueCents: p.netValue != null ? Math.round(p.netValue * 100) : null,
    dueDate: parseDay(p.dueDate),
    paidAt: paid && (status === 'CONFIRMED' || status === 'RECEIVED') ? parseDay(paid) : null,
    invoiceUrl: p.invoiceUrl ?? null,
    billingType: p.billingType ?? null,
  };
}

/** Cliente da API v3 do Asaas (https://docs.asaas.com). */
export class AsaasProvider implements BillingProvider {
  readonly name = 'asaas' as const;
  constructor(
    private readonly apiKey: string,
    private readonly environment: 'sandbox' | 'production',
    private readonly logger?: { warn: (obj: unknown, msg?: string) => void },
  ) {}

  private get base() {
    return this.environment === 'production'
      ? 'https://api.asaas.com/v3'
      : 'https://api-sandbox.asaas.com/v3';
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          access_token: this.apiKey,
          'Content-Type': 'application/json',
          'User-Agent': 'AZhoot',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      this.logger?.warn(
        { env: this.environment, method, path, reason: (err as Error).message },
        'Asaas: falha de rede ao chamar a API',
      );
      throw new AppError('BILLING_PROVIDER_ERROR', { reason: (err as Error).message });
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const description = (data as { errors?: { description: string }[] }).errors
        ?.map((e) => e.description)
        .join('; ');
      this.logger?.warn(
        { env: this.environment, method, path, status: res.status, description },
        'Asaas: resposta de erro da API (verifique a chave e se o ambiente sandbox/produção confere)',
      );
      throw new AppError('BILLING_PROVIDER_ERROR', { status: res.status, description });
    }
    return data as T;
  }

  async createCustomer(input: CustomerInput) {
    const c = await this.call<{ id: string }>('POST', '/customers', {
      name: input.name,
      cpfCnpj: input.document,
      email: input.email,
      mobilePhone: input.phone || undefined,
      externalReference: input.externalReference,
      notificationDisabled: true,
    });
    return c.id;
  }

  async createSubscription(input: SubscriptionInput) {
    const sub = await this.call<{ id: string }>('POST', '/subscriptions', {
      customer: input.customerId,
      billingType: 'UNDEFINED', // o cliente escolhe PIX, boleto ou cartão na fatura
      value: input.valueCents / 100,
      nextDueDate: ymd(input.nextDueDate),
      cycle: input.cycle,
      description: input.description,
      externalReference: input.externalReference,
    });
    const list = await this.call<{ data: AsaasPaymentJson[] }>(
      'GET',
      `/subscriptions/${sub.id}/payments`,
    );
    return { subscriptionId: sub.id, payments: list.data.map(fromAsaasPayment) };
  }

  async cancelSubscription(subscriptionId: string) {
    await this.call('DELETE', `/subscriptions/${subscriptionId}`);
  }

  async getPayment(paymentId: string) {
    try {
      return fromAsaasPayment(await this.call<AsaasPaymentJson>('GET', `/payments/${paymentId}`));
    } catch {
      return null;
    }
  }

  async createCharge(input: ChargeInput) {
    const p = await this.call<AsaasPaymentJson>('POST', '/payments', {
      customer: input.customerId,
      billingType: 'UNDEFINED',
      value: input.valueCents / 100,
      dueDate: ymd(input.dueDate),
      description: input.description,
      externalReference: input.externalReference,
    });
    return fromAsaasPayment(p);
  }

  /** Confirma recebimento manual (dinheiro/transferência) de uma cobrança. */
  async receiveInCash(paymentId: string, valueCents: number) {
    await this.call('POST', `/payments/${paymentId}/receiveInCash`, {
      paymentDate: ymd(new Date()),
      value: valueCents / 100,
      notifyCustomer: false,
    });
  }

  /** Atualiza o valor da assinatura (e das cobranças pendentes). */
  async updateSubscriptionValue(subscriptionId: string, valueCents: number) {
    await this.call('POST', `/subscriptions/${subscriptionId}`, {
      value: valueCents / 100,
      updatePendingPayments: true,
    });
  }

  async ping() {
    await this.call('GET', '/myAccount');
  }
}

/**
 * Provedor simulado (desenvolvimento/testes): gera faturas locais em /pagamento-simulado/:id.
 * O "pagamento" é disparado por um endpoint que reproduz o webhook do Asaas.
 */
export class SimulatedProvider implements BillingProvider {
  readonly name = 'simulated' as const;
  constructor(private readonly webUrl: string) {}

  async createCustomer() {
    return `sim_cus_${randomUUID()}`;
  }

  async createSubscription(input: SubscriptionInput) {
    const subscriptionId = `sim_sub_${randomUUID()}`;
    const id = `sim_pay_${randomUUID()}`;
    return {
      subscriptionId,
      payments: [
        {
          id,
          subscriptionId,
          status: 'PENDING' as const,
          valueCents: input.valueCents,
          netValueCents: Math.round(input.valueCents * 0.97),
          dueDate: input.nextDueDate,
          paidAt: null,
          invoiceUrl: `${this.webUrl.replace(/\/$/, '')}/pagamento-simulado/${id}`,
          billingType: 'UNDEFINED',
        },
      ],
    };
  }

  async cancelSubscription() {}

  async getPayment() {
    return null;
  }

  async createCharge(input: ChargeInput) {
    const id = `sim_pay_${randomUUID()}`;
    return {
      id,
      subscriptionId: null,
      status: 'PENDING' as const,
      valueCents: input.valueCents,
      netValueCents: Math.round(input.valueCents * 0.97),
      dueDate: input.dueDate,
      paidAt: null,
      invoiceUrl: `${this.webUrl.replace(/\/$/, '')}/pagamento-simulado/${id}`,
      billingType: 'UNDEFINED',
    };
  }

  invoiceUrlFor(id: string) {
    return `${this.webUrl.replace(/\/$/, '')}/pagamento-simulado/${id}`;
  }
}

/** Asaas quando configurado; simulado fora de produção; erro em produção sem configuração. */
export async function getProvider(ctx: AppContext): Promise<BillingProvider> {
  const s = await getAsaasSettings(ctx);
  if (s.apiKey) return new AsaasProvider(s.apiKey, s.environment, ctx.logger);
  if (ctx.env.NODE_ENV === 'production' && process.env.BILLING_ALLOW_SIMULATED !== '1') {
    throw new AppError('BILLING_NOT_CONFIGURED');
  }
  return new SimulatedProvider(ctx.env.PUBLIC_WEB_URL);
}
