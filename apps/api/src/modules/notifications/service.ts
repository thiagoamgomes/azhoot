import { formatBRL, renderTemplate, type NotificationType } from '@azhoot/contracts';
import type { AppContext } from '../../context';
import { isUniqueViolation } from '../../lib/errors';
import { getEmailSettings } from '../platform/settings';
import { sendEmail, toHtml } from './mailer';

export interface NotifyOptions {
  /** Chave de idempotência: a mesma (type, refKey) nunca é enviada duas vezes ao mesmo destinatário. */
  refKey: string;
  vars?: Record<string, string>;
  /** Destinatários explícitos (ex.: conta que será excluída). Padrão: donos da conta. */
  recipients?: { email: string; name: string; userId?: string }[];
  link?: string;
  /** Não cria notificação no painel (ex.: conta excluída). */
  skipInApp?: boolean;
}

const LINKS: Partial<Record<NotificationType, string>> = {
  plan_contracted: '/planos',
  plan_changed: '/planos',
  due_soon: '/planos',
  due_today: '/planos',
  overdue_1: '/planos',
  overdue_5: '/planos',
  weekly_report: '/relatorios',
  welcome: '/dashboard',
};

export function fmtDate(d: Date | null | undefined) {
  return d ? d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
}
export { formatBRL };

/**
 * Notificação do sistema: e-mail (SendGrid/log) + aviso no painel.
 * Idempotente por (type, refKey, e-mail) via NotificationDelivery. Nunca lança.
 */
export async function notify(
  ctx: AppContext,
  accountId: string,
  type: NotificationType,
  opts: NotifyOptions,
): Promise<number> {
  try {
    const [settings, account] = await Promise.all([
      getEmailSettings(ctx),
      ctx.prisma.account.findUnique({ where: { id: accountId }, include: { plan: true } }),
    ]);
    const recipients =
      opts.recipients ??
      (
        await ctx.prisma.user.findMany({
          where: { accountId, role: 'OWNER', active: true },
          select: { id: true, email: true, name: true },
        })
      ).map((u) => ({ email: u.email, name: u.name, userId: u.id }));
    const template = settings.templatesResolved[type];
    const link = `${ctx.env.PUBLIC_WEB_URL.replace(/\/$/, '')}${opts.link ?? LINKS[type] ?? '/dashboard'}`;
    let delivered = 0;
    for (const r of recipients) {
      const vars = {
        nome: r.name.split(' ')[0] ?? r.name,
        conta: account?.name ?? '',
        plano: account?.plan.name ?? '',
        link,
        ...opts.vars,
      };
      const subject = renderTemplate(template.subject, vars);
      const text = renderTemplate(template.body, vars);
      try {
        await ctx.prisma.notificationDelivery.create({
          data: {
            accountId: account ? accountId : null,
            type,
            refKey: opts.refKey,
            toEmail: r.email,
            status: 'PENDING',
          },
        });
      } catch (err) {
        if (isUniqueViolation(err)) continue; // já enviado
        throw err;
      }
      if (!opts.skipInApp && account) {
        await ctx.prisma.notification.create({
          data: {
            accountId,
            userId: r.userId ?? null,
            type,
            title: subject,
            body: text,
            link: opts.link ?? LINKS[type] ?? null,
          },
        });
      }
      let status = 'SKIPPED';
      let error: string | null = null;
      if (template.enabled) {
        try {
          status = (
            await sendEmail(ctx, { to: r.email, subject, text, html: toHtml(subject, text) })
          ).status;
        } catch (err) {
          status = 'FAILED';
          error = (err as Error).message.slice(0, 500);
          ctx.logger.warn({ err, type, accountId }, 'falha ao enviar e-mail');
        }
      }
      await ctx.prisma.notificationDelivery.updateMany({
        where: { type, refKey: opts.refKey, toEmail: r.email },
        data: { status, error },
      });
      ctx.metrics.inc('azhoot_notifications_total', { type, status });
      delivered++;
    }
    return delivered;
  } catch (err) {
    ctx.logger.error({ err, type, accountId }, 'falha ao notificar');
    return 0;
  }
}

/** Relatório textual dos quizzes realizados pela conta nos últimos 7 dias. */
export async function weeklyReportText(
  ctx: AppContext,
  accountId: string,
  since: Date,
  until: Date,
) {
  const sessions = await ctx.prisma.gameSession.findMany({
    where: { accountId, startedAt: { gte: since, lt: until }, status: 'FINISHED' },
    include: {
      quizVersion: { select: { title: true } },
      participants: { select: { nickname: true, finalRank: true, status: true } },
      _count: { select: { answers: true } },
    },
    orderBy: { startedAt: 'asc' },
  });
  if (sessions.length === 0) return null;
  const answers = await ctx.prisma.answer.groupBy({
    by: ['gameSessionId', 'isCorrect'],
    where: { gameSessionId: { in: sessions.map((s) => s.id) } },
    _count: true,
  });
  let totalParticipants = 0;
  let totalAnswers = 0;
  let totalCorrect = 0;
  let totalScored = 0;
  const lines = sessions.map((s) => {
    const rows = answers.filter((a) => a.gameSessionId === s.id);
    const correct = rows.find((r) => r.isCorrect === true)?._count ?? 0;
    const scored = rows.filter((r) => r.isCorrect !== null).reduce((a, r) => a + r._count, 0);
    const winner = s.participants.find((p) => p.finalRank === 1)?.nickname ?? '—';
    const participants = s.participants.filter(
      (p) => p.status !== 'REMOVED' && p.status !== 'BLOCKED',
    ).length;
    totalParticipants += participants;
    totalAnswers += s._count.answers;
    totalCorrect += correct;
    totalScored += scored;
    const acc = scored ? `${Math.round((correct / scored) * 100)}%` : '—';
    return `• ${fmtDate(s.startedAt)} — ${s.quizVersion.title}: ${participants} participante(s), ${s._count.answers} resposta(s), acerto ${acc}, 1º lugar: ${winner}`;
  });
  const acc = totalScored ? `${Math.round((totalCorrect / totalScored) * 100)}%` : '—';
  return [
    `Sessões realizadas: ${sessions.length}`,
    `Participantes: ${totalParticipants}`,
    `Respostas: ${totalAnswers}`,
    `Taxa média de acerto: ${acc}`,
    '',
    ...lines,
  ].join('\n');
}
