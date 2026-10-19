import { appSettingsSchema, type AppSettings } from '@azhoot/contracts';
import type { AppContext } from '../../context';

const KEY = 'app';
let cache: { value: AppSettings; at: number } | null = null;

export async function getSettings(ctx: AppContext): Promise<AppSettings> {
  if (cache && Date.now() - cache.at < 10_000) return cache.value;
  const row = await ctx.prisma.appSetting.findUnique({ where: { key: KEY } });
  const value = appSettingsSchema.parse(row?.value ?? {});
  cache = { value, at: Date.now() };
  return value;
}

export async function saveSettings(ctx: AppContext, value: AppSettings) {
  await ctx.prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value },
    update: { value },
  });
  cache = { value, at: Date.now() };
  return value;
}

export function clearSettingsCache() {
  cache = null;
}
