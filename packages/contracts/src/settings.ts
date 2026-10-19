import { z } from 'zod';

export const appSettingsSchema = z.object({
  nicknameBlocklist: z.array(z.string().trim().min(2).max(40)).max(500).default([]),
  retentionDays: z.number().int().min(0).max(3650).default(0),
  deletionMode: z.enum(['DELETE', 'ANONYMIZE']).default('ANONYMIZE'),
});
export type AppSettings = z.output<typeof appSettingsSchema>;
export type AppSettingsInput = z.input<typeof appSettingsSchema>;
