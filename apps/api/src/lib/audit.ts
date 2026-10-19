import type { AppContext } from '../context';

export type AuditAction =
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.password_changed'
  | 'user.created'
  | 'user.updated'
  | 'quiz.published'
  | 'quiz.archived'
  | 'quiz.deleted'
  | 'session.created'
  | 'session.started'
  | 'session.ended'
  | 'session.participant_removed'
  | 'report.exported'
  | 'report.deleted'
  | 'settings.updated'
  | 'auth.signup'
  | 'billing.checkout'
  | 'billing.plan_change'
  | 'billing.cancel'
  | 'account.deleted'
  | 'master.account_updated'
  | 'master.password_reset'
  | 'master.payment_marked'
  | 'master.commission_paid'
  | 'master.settings_updated'
  | 'master.expense_changed'
  | 'ai.generate'
  | 'master.credit_pack_changed'
  | 'master.credits_adjusted';

export interface AuditInput {
  actorId?: string | null;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  requestId?: unknown;
}

/** Registra ação administrativa. Nunca falha a operação principal. */
export async function audit(ctx: AppContext, input: AuditInput): Promise<void> {
  try {
    await ctx.prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        metadata: (input.metadata ?? {}) as object,
        ip: input.ip ?? null,
        requestId: input.requestId != null ? String(input.requestId) : null,
      },
    });
  } catch (err) {
    ctx.logger.warn({ err, action: input.action }, 'falha ao registrar auditoria');
  }
}
