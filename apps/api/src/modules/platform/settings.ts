import { z } from 'zod';
import {
  DEFAULT_TEMPLATES,
  NOTIFICATION_TYPES,
  type NotificationTemplate,
  type NotificationType,
} from '@azhoot/contracts';
import type { AppContext } from '../../context';
import { decryptSecret, encryptSecret, maskSecret } from '../../lib/secrets';

/* Configurações da plataforma (painel master), guardadas em AppSetting por chave. */

const cache = new Map<string, { value: unknown; at: number }>();

async function readKey<T>(ctx: AppContext, key: string, parse: (v: unknown) => T): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5000) return hit.value as T;
  const row = await ctx.prisma.appSetting.findUnique({ where: { key } });
  const value = parse(row?.value ?? {});
  cache.set(key, { value, at: Date.now() });
  return value;
}

async function writeKey(ctx: AppContext, key: string, value: object) {
  await ctx.prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  cache.delete(key);
}

export function clearPlatformCache() {
  cache.clear();
}

/* --------------------------------- e-mail -------------------------------- */

const templateSchema = z.object({
  enabled: z.boolean(),
  subject: z.string().max(200),
  body: z.string().max(10_000),
});

const emailStored = z.object({
  provider: z.enum(['sendgrid', 'log']).default('log'),
  apiKeyEnc: z.string().nullable().default(null),
  fromEmail: z.string().default(''),
  fromName: z.string().default('AZhoot'),
  replyTo: z.string().default(''),
  templates: z.record(z.string(), templateSchema).default({}),
});
export type EmailSettings = z.output<typeof emailStored> & {
  apiKey: string | null;
  templatesResolved: Record<NotificationType, NotificationTemplate>;
};

export async function getEmailSettings(ctx: AppContext): Promise<EmailSettings> {
  const stored = await readKey(ctx, 'email', (v) => emailStored.parse(v));
  const templatesResolved = Object.fromEntries(
    NOTIFICATION_TYPES.map((t) => [t, { ...DEFAULT_TEMPLATES[t], ...(stored.templates[t] ?? {}) }]),
  ) as Record<NotificationType, NotificationTemplate>;
  return {
    ...stored,
    apiKey: decryptSecret(stored.apiKeyEnc, ctx.env.SESSION_SECRET),
    templatesResolved,
  };
}

export const emailSettingsInput = z.object({
  provider: z.enum(['sendgrid', 'log']),
  apiKey: z.string().trim().max(300).optional(),
  fromEmail: z.string().trim().max(254),
  fromName: z.string().trim().max(120),
  replyTo: z.string().trim().max(254).default(''),
  templates: z.record(z.enum(NOTIFICATION_TYPES), templateSchema).optional(),
});

export async function saveEmailSettings(
  ctx: AppContext,
  input: z.output<typeof emailSettingsInput>,
) {
  const current = emailStored.parse(
    (await ctx.prisma.appSetting.findUnique({ where: { key: 'email' } }))?.value ?? {},
  );
  await writeKey(ctx, 'email', {
    provider: input.provider,
    apiKeyEnc: input.apiKey
      ? encryptSecret(input.apiKey, ctx.env.SESSION_SECRET)
      : current.apiKeyEnc,
    fromEmail: input.fromEmail,
    fromName: input.fromName,
    replyTo: input.replyTo,
    templates: input.templates ?? current.templates,
  });
}

export async function publicEmailSettings(ctx: AppContext) {
  const s = await getEmailSettings(ctx);
  return {
    provider: s.provider,
    apiKeyMasked: maskSecret(s.apiKey),
    fromEmail: s.fromEmail,
    fromName: s.fromName,
    replyTo: s.replyTo,
    templates: s.templatesResolved,
  };
}

/* --------------------------------- Asaas --------------------------------- */

const asaasStored = z.object({
  environment: z.enum(['sandbox', 'production']).default('sandbox'),
  apiKeyEnc: z.string().nullable().default(null),
  webhookTokenEnc: z.string().nullable().default(null),
});
export type AsaasSettings = {
  environment: 'sandbox' | 'production';
  apiKey: string | null;
  webhookToken: string | null;
};

export async function getAsaasSettings(ctx: AppContext): Promise<AsaasSettings> {
  const s = await readKey(ctx, 'asaas', (v) => asaasStored.parse(v));
  return {
    environment: s.environment,
    apiKey: process.env.ASAAS_API_KEY || decryptSecret(s.apiKeyEnc, ctx.env.SESSION_SECRET),
    webhookToken:
      process.env.ASAAS_WEBHOOK_TOKEN || decryptSecret(s.webhookTokenEnc, ctx.env.SESSION_SECRET),
  };
}

export const asaasSettingsInput = z.object({
  environment: z.enum(['sandbox', 'production']),
  apiKey: z.string().trim().max(300).optional(),
  webhookToken: z.string().trim().min(16).max(200).optional(),
});

export async function saveAsaasSettings(
  ctx: AppContext,
  input: z.output<typeof asaasSettingsInput>,
) {
  const current = asaasStored.parse(
    (await ctx.prisma.appSetting.findUnique({ where: { key: 'asaas' } }))?.value ?? {},
  );
  await writeKey(ctx, 'asaas', {
    environment: input.environment,
    apiKeyEnc: input.apiKey
      ? encryptSecret(input.apiKey, ctx.env.SESSION_SECRET)
      : current.apiKeyEnc,
    webhookTokenEnc: input.webhookToken
      ? encryptSecret(input.webhookToken, ctx.env.SESSION_SECRET)
      : current.webhookTokenEnc,
  });
}

export async function publicAsaasSettings(ctx: AppContext) {
  const s = await getAsaasSettings(ctx);
  return {
    environment: s.environment,
    apiKeyMasked: maskSecret(s.apiKey),
    webhookTokenMasked: maskSecret(s.webhookToken),
    configured: !!s.apiKey,
    webhookUrl: `${(process.env.PUBLIC_API_URL || ctx.env.PUBLIC_WEB_URL).replace(/\/$/, '')}/api/v1/webhooks/asaas`,
  };
}

/* -------------------------------- afiliado ------------------------------- */

const affiliateStored = z.object({
  /** Percentual global em pontos-base (2000 = 20%). */
  percentBp: z.number().int().min(0).max(10000).default(2000),
  /** Comissão em todos os pagamentos do indicado (recorrente) ou só no primeiro. */
  recurring: z.boolean().default(true),
});
export type AffiliateSettings = z.output<typeof affiliateStored>;
export const affiliateSettingsInput = affiliateStored;

export async function getAffiliateSettings(ctx: AppContext): Promise<AffiliateSettings> {
  return readKey(ctx, 'affiliate', (v) => affiliateStored.parse(v));
}

export async function saveAffiliateSettings(ctx: AppContext, input: AffiliateSettings) {
  await writeKey(ctx, 'affiliate', input);
}

/* ----------------------------------- IA ---------------------------------- */

const aiStored = z.object({
  apiKeyEnc: z.string().nullable().default(null),
  model: z.string().default('gpt-4o-mini'),
});
export type AiSettings = { apiKey: string | null; model: string };

export async function getAiSettings(ctx: AppContext): Promise<AiSettings> {
  const s = await readKey(ctx, 'ai', (v) => aiStored.parse(v));
  return {
    apiKey: process.env.OPENAI_API_KEY || decryptSecret(s.apiKeyEnc, ctx.env.SESSION_SECRET),
    model: s.model || 'gpt-4o-mini',
  };
}

export const aiSettingsInput = z.object({
  apiKey: z.string().trim().max(300).optional(),
  model: z.string().trim().min(2).max(80),
});

export async function saveAiSettings(ctx: AppContext, input: z.output<typeof aiSettingsInput>) {
  const current = aiStored.parse(
    (await ctx.prisma.appSetting.findUnique({ where: { key: 'ai' } }))?.value ?? {},
  );
  await writeKey(ctx, 'ai', {
    model: input.model,
    apiKeyEnc: input.apiKey
      ? encryptSecret(input.apiKey, ctx.env.SESSION_SECRET)
      : current.apiKeyEnc,
  });
}

export async function publicAiSettings(ctx: AppContext) {
  const s = await getAiSettings(ctx);
  return {
    provider: 'openai' as const,
    model: s.model,
    apiKeyMasked: maskSecret(s.apiKey),
    configured: !!s.apiKey,
  };
}
