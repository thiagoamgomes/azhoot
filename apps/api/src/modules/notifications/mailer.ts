import type { AppContext } from '../../context';
import { getEmailSettings } from '../platform/settings';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** E-mails "enviados" pelo provedor de log (desenvolvimento/testes). */
export const outbox: OutgoingEmail[] = [];

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Converte o texto do template em HTML simples com a identidade do AZhoot. */
export function toHtml(subject: string, text: string): string {
  const linkify = (s: string) =>
    s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#2563EB">$1</a>');
  const paragraphs = text
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;line-height:1.55">${linkify(escape(p)).replace(/\n/g, '<br>')}</p>`,
    )
    .join('');
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F8FAFC;font-family:Inter,Arial,sans-serif;color:#0F172A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0">
<tr><td style="background:#0F172A;padding:20px 28px;color:#fff;font-size:22px;font-weight:700">AZ<span style="color:#60A5FA">hoot</span></td></tr>
<tr><td style="padding:28px"><h1 style="font-size:20px;margin:0 0 16px">${escape(subject)}</h1>${paragraphs}</td></tr>
<tr><td style="padding:16px 28px;background:#F1F5F9;color:#475569;font-size:12px">Você recebeu este e-mail porque tem uma conta no AZhoot.</td></tr>
</table></td></tr></table></body></html>`;
}

/** Envia pelo SendGrid (Mail Send API v3) ou registra em log, conforme configuração do master. */
export async function sendEmail(
  ctx: AppContext,
  email: OutgoingEmail,
): Promise<{ status: 'SENT' | 'LOGGED' }> {
  const s = await getEmailSettings(ctx);
  if (s.provider !== 'sendgrid' || !s.apiKey || !s.fromEmail) {
    outbox.push(email);
    if (outbox.length > 500) outbox.splice(0, outbox.length - 500);
    ctx.logger.info(
      { to: email.to, subject: email.subject },
      'e-mail registrado (provedor de log)',
    );
    return { status: 'LOGGED' };
  }
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: email.to }] }],
      from: { email: s.fromEmail, name: s.fromName || 'AZhoot' },
      ...(s.replyTo ? { reply_to: { email: s.replyTo } } : {}),
      subject: email.subject,
      content: [
        { type: 'text/plain', value: email.text },
        { type: 'text/html', value: email.html },
      ],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SendGrid ${res.status}: ${body.slice(0, 300)}`);
  }
  return { status: 'SENT' };
}
