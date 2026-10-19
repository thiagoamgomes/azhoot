import { ERROR_CODES, type ErrorCode } from '@azhoot/contracts';

const STATUS: Partial<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  PARTICIPANT_TOKEN_INVALID: 401,
  FORBIDDEN: 403,
  CSRF_INVALID: 403,
  PARTICIPANT_REMOVED: 403,
  CANNOT_MODIFY_SELF: 403,
  NOT_FOUND: 404,
  SESSION_NOT_FOUND: 404,
  PIN_INVALID: 404,
  CONFLICT: 409,
  EMAIL_IN_USE: 409,
  NICKNAME_TAKEN: 409,
  ALREADY_ANSWERED: 409,
  QUIZ_IN_USE: 409,
  INVALID_TRANSITION: 409,
  SESSION_ENDED: 410,
  QUESTION_CLOSED: 422,
  QUESTION_MISMATCH: 409,
  QUIZ_NOT_PUBLISHED: 422,
  QUIZ_INVALID: 422,
  QUIZ_ARCHIVED: 422,
  SESSION_FULL: 422,
  SESSION_STARTED: 422,
  SESSION_NO_QUESTIONS: 422,
  NICKNAME_INVALID: 422,
  NICKNAME_BLOCKED: 422,
  ANSWER_INVALID: 422,
  UPLOAD_INVALID: 422,
  LEADERBOARD_HIDDEN: 422,
  RATE_LIMITED: 429,
  MASTER_ONLY: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  NO_AI_CREDITS: 402,
  AI_NOT_CONFIGURED: 503,
  AI_FAILED: 502,
  CREDIT_PACK_INVALID: 400,
  ATTACHMENT_INVALID: 422,
  ATTACHMENT_EMPTY: 422,
  NOT_ACCOUNT_OWNER: 403,
  AFFILIATE_DISABLED: 403,
  ACCOUNT_INACTIVE: 403,
  ACCOUNT_FROZEN: 402,
  PLAN_LIMIT_QUIZZES: 402,
  PLAN_LIMIT_USERS: 402,
  PLAN_INVALID: 422,
  PLAN_SAME: 409,
  PLAN_REMOVALS_REQUIRED: 422,
  BILLING_DOCUMENT_INVALID: 422,
  BILLING_NOT_CONFIGURED: 503,
  BILLING_PROVIDER_ERROR: 502,
  NO_ACTIVE_SUBSCRIPTION: 409,
  NO_PENDING_CHANGE: 409,
  CHECKOUT_PENDING: 409,
  WEBHOOK_UNAUTHORIZED: 401,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, details?: Record<string, unknown>, message?: string) {
    super(message ?? ERROR_CODES[code]);
    this.code = code;
    this.status = STATUS[code] ?? 400;
    this.details = details;
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;

/**
 * Detecta violação de unicidade do Prisma (P2002), opcionalmente por campo/constraint.
 * Compatível com o formato clássico (`meta.target`) e com driver adapters (`meta.driverAdapterError`).
 */
export function isUniqueViolation(err: unknown, field?: string): boolean {
  const e = err as {
    code?: string;
    message?: string;
    meta?: {
      target?: string[] | string;
      driverAdapterError?: {
        cause?: { originalMessage?: string; constraint?: { fields?: string[]; index?: string } };
      };
    };
  };
  if (e?.code !== 'P2002') return false;
  if (!field) return true;
  const cause = e.meta?.driverAdapterError?.cause;
  const haystack = [
    ...(Array.isArray(e.meta?.target) ? e.meta.target : [String(e.meta?.target ?? '')]),
    ...(cause?.constraint?.fields ?? []),
    cause?.constraint?.index ?? '',
    cause?.originalMessage ?? '',
    e.message ?? '',
  ].join(' ');
  return haystack.includes(field);
}
