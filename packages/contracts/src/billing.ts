import { z } from 'zod';
import { emailSchema, passwordSchema } from './auth';

export const PLAN_IDS = ['FREE', 'MONTHLY', 'YEARLY'] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export const planIdSchema = z.enum(PLAN_IDS);

export const PLAN_RANK: Record<PlanId, number> = { FREE: 0, MONTHLY: 1, YEARLY: 2 };

export type PlanIntervalCode = 'NONE' | 'MONTHLY' | 'YEARLY';

export interface PlanDto {
  id: PlanId;
  name: string;
  description: string | null;
  priceCents: number;
  interval: PlanIntervalCode;
  maxQuizzes: number | null;
  maxParticipants: number;
  maxUsers: number;
  features: string[];
  aiCreditsIncluded: number;
  active: boolean;
  sortOrder: number;
}

export interface Limits {
  maxQuizzes: number | null;
  maxParticipants: number;
  maxUsers: number;
}

export type SubscriptionStatusCode = 'ACTIVE' | 'PAST_DUE' | 'FROZEN';
export type PaymentStatusCode =
  'PENDING' | 'CONFIRMED' | 'RECEIVED' | 'OVERDUE' | 'CANCELED' | 'REFUNDED';

export const PAYMENT_STATUS_LABELS: Record<PaymentStatusCode, string> = {
  PENDING: 'Aguardando pagamento',
  CONFIRMED: 'Confirmado',
  RECEIVED: 'Recebido',
  OVERDUE: 'Vencido',
  CANCELED: 'Cancelado',
  REFUNDED: 'Estornado',
};

export const PAID_STATUSES: PaymentStatusCode[] = ['CONFIRMED', 'RECEIVED'];

export interface PaymentDto {
  id: string;
  accountId: string | null;
  accountName: string;
  planId: string;
  amountCents: number;
  status: PaymentStatusCode;
  billingType: string | null;
  description: string | null;
  dueDate: string;
  paidAt: string | null;
  invoiceUrl: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
}

export interface PlanWithPrice extends PlanDto {
  /** Preço efetivo para esta conta (override do master, se houver). */
  effectivePriceCents: number;
  effectiveLimits: Limits;
}

export interface BillingOverview {
  accountId: string;
  accountName: string;
  isOwner: boolean;
  plan: PlanWithPrice;
  usage: { quizzes: number; users: number };
  subscriptionStatus: SubscriptionStatusCode;
  billingExempt: boolean;
  currentPeriodEnd: string | null;
  pendingPlanId: PlanId | null;
  pendingChangeAt: string | null;
  pendingRemovals: { quizIds: string[]; userIds: string[] };
  openPayment: PaymentDto | null;
  /** Pagamento em aberto de upgrade (plano diferente do atual). */
  checkoutPayment: PaymentDto | null;
  plans: PlanWithPrice[];
  billing: {
    name: string | null;
    document: string | null;
    email: string | null;
    phone: string | null;
  };
  affiliateEnabled: boolean;
  /** Dias até o congelamento quando em atraso. */
  daysOverdue: number | null;
}

/* ------------------------------- documentos ------------------------------ */

const onlyDigits = (v: string) => v.replace(/\D/g, '');

export function isValidCpf(value: string): boolean {
  const c = onlyDigits(value);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(c[9]) && calc(10) === Number(c[10]);
}

export function isValidCnpj(value: string): boolean {
  const c = onlyDigits(value);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (len: number) => {
    const weights =
      len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(c[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

export const documentSchema = z
  .string()
  .transform(onlyDigits)
  .refine((v) => isValidCpf(v) || isValidCnpj(v), 'Informe um CPF ou CNPJ válido.');

/* -------------------------------- schemas -------------------------------- */

export const removalsSchema = z.object({
  removeQuizIds: z.array(z.uuid()).max(1000).default([]),
  removeUserIds: z.array(z.uuid()).max(100).default([]),
});

export const checkoutSchema = z.object({
  planId: z.enum(['MONTHLY', 'YEARLY']),
  billingName: z.string().trim().min(3, 'Informe o nome completo ou razão social.').max(120),
  billingDocument: documentSchema,
  billingEmail: emailSchema.optional(),
  billingPhone: z
    .string()
    .transform(onlyDigits)
    .refine((v) => v === '' || (v.length >= 10 && v.length <= 11), 'Telefone inválido.')
    .optional(),
});
export type CheckoutInput = z.input<typeof checkoutSchema>;

export const changePlanSchema = removalsSchema.extend({ planId: planIdSchema });
export type ChangePlanInput = z.input<typeof changePlanSchema>;

export const cancelPlanSchema = removalsSchema.extend({
  reason: z.string().trim().max(500).optional(),
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Informe sua senha.').max(128),
  confirm: z.literal(true),
});

export const signupSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome.').max(120),
  accountName: z.string().trim().max(120).optional(),
  email: emailSchema,
  password: passwordSchema,
  acceptTerms: z.literal(true, 'Aceite os termos para continuar.'),
  ref: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9-]{3,40}$/)
    .optional(),
});
export type SignupInput = z.input<typeof signupSchema>;

/* -------------------------------- afiliado ------------------------------- */

export const PIX_KEY_TYPES = ['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP'] as const;
export const PIX_KEY_LABELS: Record<(typeof PIX_KEY_TYPES)[number], string> = {
  CPF: 'CPF',
  CNPJ: 'CNPJ',
  EMAIL: 'E-mail',
  PHONE: 'Telefone',
  EVP: 'Chave aleatória',
};

export const pixSchema = z
  .object({ pixKeyType: z.enum(PIX_KEY_TYPES), pixKey: z.string().trim().min(3).max(120) })
  .superRefine((v, ctx) => {
    const ok =
      v.pixKeyType === 'CPF'
        ? isValidCpf(v.pixKey)
        : v.pixKeyType === 'CNPJ'
          ? isValidCnpj(v.pixKey)
          : v.pixKeyType === 'EMAIL'
            ? z.email().safeParse(v.pixKey).success
            : v.pixKeyType === 'PHONE'
              ? /^\+?\d{10,13}$/.test(v.pixKey.replace(/[\s()-]/g, ''))
              : /^[0-9a-f-]{32,36}$/i.test(v.pixKey);
    if (!ok)
      ctx.addIssue({
        code: 'custom',
        path: ['pixKey'],
        message: 'Chave PIX inválida para o tipo escolhido.',
      });
  });

export type CommissionStatusCode = 'PENDING' | 'PAID' | 'CANCELED';

export interface AffiliateOverview {
  code: string;
  link: string;
  percentBp: number;
  pixKeyType: string | null;
  pixKey: string | null;
  totals: { referrals: number; paying: number; pendingCents: number; paidCents: number };
  referrals: {
    id: string;
    name: string;
    planId: string;
    createdAt: string;
    paying: boolean;
    lastPaymentAt: string | null;
    earnedCents: number;
  }[];
  commissions: {
    id: string;
    referredName: string;
    baseAmountCents: number;
    percentBp: number;
    amountCents: number;
    status: CommissionStatusCode;
    createdAt: string;
    paidAt: string | null;
  }[];
}

/* ------------------------------ notificações ----------------------------- */

export const NOTIFICATION_TYPES = [
  'welcome',
  'plan_contracted',
  'plan_changed',
  'due_soon',
  'due_today',
  'overdue_1',
  'overdue_5',
  'weekly_report',
  'account_deleted',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationTemplate {
  enabled: boolean;
  subject: string;
  body: string;
}

export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  welcome: 'Boas-vindas',
  plan_contracted: 'Plano contratado',
  plan_changed: 'Alteração de plano',
  due_soon: 'Próximo do vencimento (5 dias antes)',
  due_today: 'Dia do vencimento (não pago)',
  overdue_1: '1 dia após o vencimento',
  overdue_5: '5 dias após o vencimento (conta congelada)',
  weekly_report: 'Quizzes da semana',
  account_deleted: 'Conta excluída',
};

/** Variáveis disponíveis: {{nome}}, {{conta}}, {{plano}}, {{valor}}, {{vencimento}}, {{link}}, {{relatorio}}, {{plano_anterior}}. */
export const DEFAULT_TEMPLATES: Record<NotificationType, NotificationTemplate> = {
  welcome: {
    enabled: true,
    subject: 'Boas-vindas ao AZhoot, {{nome}}!',
    body: 'Olá, {{nome}}!\n\nSua conta {{conta}} está pronta no plano {{plano}}. Crie seu primeiro quiz e abra uma sala em segundos.\n\nAcesse: {{link}}',
  },
  plan_contracted: {
    enabled: true,
    subject: 'Plano {{plano}} ativado',
    body: 'Olá, {{nome}}!\n\nRecebemos seu pagamento de {{valor}} e o plano {{plano}} está ativo. Próxima renovação: {{vencimento}}.\n\nAproveite: {{link}}',
  },
  plan_changed: {
    enabled: true,
    subject: 'Seu plano foi alterado para {{plano}}',
    body: 'Olá, {{nome}}!\n\nSeu plano mudou de {{plano_anterior}} para {{plano}}.\n\nDetalhes: {{link}}',
  },
  due_soon: {
    enabled: true,
    subject: 'Sua fatura do AZhoot vence em 5 dias',
    body: 'Olá, {{nome}}!\n\nA fatura de {{valor}} do plano {{plano}} vence em {{vencimento}}. Pague por PIX, boleto ou cartão: {{link}}',
  },
  due_today: {
    enabled: true,
    subject: 'Sua fatura do AZhoot vence hoje',
    body: 'Olá, {{nome}}!\n\nA fatura de {{valor}} do plano {{plano}} vence hoje ({{vencimento}}). Evite a interrupção: {{link}}',
  },
  overdue_1: {
    enabled: true,
    subject: 'Fatura do AZhoot em atraso',
    body: 'Olá, {{nome}}!\n\nNão identificamos o pagamento de {{valor}} vencido em {{vencimento}}. Regularize para manter seu plano {{plano}}: {{link}}',
  },
  overdue_5: {
    enabled: true,
    subject: 'Sua conta AZhoot foi congelada',
    body: 'Olá, {{nome}}!\n\nA fatura vencida em {{vencimento}} continua em aberto e sua conta foi congelada. Você ainda pode acessar o painel, mas precisa pagar ({{link}}) ou voltar ao plano Gratuito para continuar usando.',
  },
  weekly_report: {
    enabled: true,
    subject: 'Seus quizzes da semana no AZhoot',
    body: 'Olá, {{nome}}!\n\nResumo da semana da conta {{conta}}:\n\n{{relatorio}}\n\nVeja os relatórios completos: {{link}}',
  },
  account_deleted: {
    enabled: true,
    subject: 'Sua conta AZhoot foi excluída',
    body: 'Olá, {{nome}}!\n\nConfirmamos a exclusão da conta {{conta}} e de todos os seus dados. Sentiremos sua falta — você pode voltar quando quiser.',
  },
};

export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => vars[k] ?? '');
}

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
