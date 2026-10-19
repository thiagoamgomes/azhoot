import { z } from 'zod';
import { LIMITS } from './constants';
import { nicknameSchema } from './nickname';

export const sessionSettingsSchema = z.object({
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  allowLateJoin: z.boolean().default(true),
  hideIntermediateLeaderboard: z.boolean().default(false),
  nicknameModeration: z.boolean().default(true),
  maxParticipants: z
    .number()
    .int()
    .min(2)
    .max(LIMITS.maxParticipantsPerSession)
    .default(LIMITS.maxParticipantsPerSession),
});
export type SessionSettings = z.output<typeof sessionSettingsSchema>;
export type SessionSettingsInput = z.input<typeof sessionSettingsSchema>;

export const sessionCreateSchema = z.object({
  quizId: z.uuid(),
  settings: sessionSettingsSchema.default({
    shuffleQuestions: false,
    shuffleOptions: false,
    allowLateJoin: true,
    hideIntermediateLeaderboard: false,
    nicknameModeration: true,
    maxParticipants: LIMITS.maxParticipantsPerSession,
  }),
});
export type SessionCreateInput = z.input<typeof sessionCreateSchema>;

export const pinSchema = z.string().regex(/^\d{6}$/, 'O PIN possui 6 dígitos.');

export const joinSchema = z.object({
  nickname: nicknameSchema,
});
export type JoinInput = z.input<typeof joinSchema>;

export interface JoinResponse {
  sessionId: string;
  participantId: string;
  nickname: string;
  token: string;
  expiresAt: string;
}

export interface PinLookupResponse {
  sessionId: string;
  quizTitle: string;
  status: string;
  acceptingJoins: boolean;
}
