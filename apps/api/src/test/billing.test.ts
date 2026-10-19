import ExcelJS from 'exceljs';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AffiliateOverview, BillingOverview } from '@azhoot/contracts';
import { runWeeklyReports } from '../modules/billing/jobs';
import { runBillingCycle } from '../modules/billing/service';
import { resolveReferral } from '../modules/affiliate/service';
import { outbox } from '../modules/notifications/mailer';
import type { RunningServer } from '../server';
import {
  createAccount,
  createPublishedQuiz,
  createUser,
  login,
  PASSWORD,
  resetDb,
  startTestServer,
  type Client,
} from './helpers';

let server: RunningServer;
const DAY = 86_400_000;
// CPF válido de teste (gerado para testes)
const CPF = '52998224725';

beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  await resetDb(server);
});

async function signup(name: string, email: string, ref?: string) {
  const agent = request.agent(server.http);
  const res = await agent
    .post('/api/v1/auth/signup')
    .send({ name, email, password: PASSWORD, acceptTerms: true, ...(ref ? { ref } : {}) })
    .expect(201);
  const csrf = res.body.csrfToken as string;
  const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  const c: Client = {
    agent,
    csrf,
    cookie,
    get: (url) => agent.get(url),
    post: (url, body = {}) => agent.post(url).set('X-CSRF-Token', csrf).send(body),
    put: (url, body = {}) => agent.put(url).set('X-CSRF-Token', csrf).send(body),
    patch: (url, body = {}) => agent.patch(url).set('X-CSRF-Token', csrf).send(body),
    del: (url) => agent.delete(url).set('X-CSRF-Token', csrf),
  };
  return { client: c, user: res.body.user as { id: string; accountId: string } };
}

const billing = async (c: Client) =>
  (await c.get('/api/v1/account/billing').expect(200)).body as BillingOverview;

async function payOpen(c: Client) {
  const b = await billing(c);
  const p = b.checkoutPayment ?? b.openPayment;
  expect(p?.invoiceUrl).toBeTruthy();
  const providerId = p!.invoiceUrl!.split('/').pop()!;
  // V3: pagamento simulado exige sessão autenticada do dono da conta.
  await c.post(`/api/v1/billing/simulated/${providerId}/pay`, { billingType: 'PIX' }).expect(200);
}

async function subscribe(c: Client, planId: 'MONTHLY' | 'YEARLY') {
  const res = await c
    .post('/api/v1/account/checkout', {
      planId,
      billingName: 'Cliente Teste',
      billingDocument: CPF,
    })
    .expect(201);
  expect(res.body.invoiceUrl).toContain('/pagamento-simulado/');
  await payOpen(c);
}

async function master() {
  const acc = await createAccount(server, { name: 'Conta principal' });
  const u = await createUser(server, 'OWNER', 'master@azhoot.local', {
    accountId: acc.id,
    isMaster: true,
    name: 'Master',
  });
  return login(server, u.email);
}

describe('cadastro e planos', () => {
  it('planos públicos para a landing (sem autenticação)', async () => {
    const res = await request(server.http).get('/api/v1/public/plans').expect(200);
    expect(res.body.items.map((p: { id: string }) => p.id)).toEqual(['FREE', 'MONTHLY', 'YEARLY']);
    expect(res.body.items[1].priceCents).toBe(990);
  });

  it('novo cadastro entra no Gratuito, recebe boas-vindas e fica isolado', async () => {
    const { client, user } = await signup('Maria Silva', 'maria@teste.local');
    const b = await billing(client);
    expect(b.plan.id).toBe('FREE');
    expect(b.plan.effectiveLimits).toEqual({ maxQuizzes: 5, maxParticipants: 5, maxUsers: 1 });
    expect(
      outbox.some((e) => e.to === 'maria@teste.local' && e.subject.includes('Boas-vindas')),
    ).toBe(true);
    const notes = await client.get('/api/v1/account/notifications').expect(200);
    expect(notes.body.unread).toBe(1);

    // Outra conta não enxerga os quizzes
    const quiz = await client.post('/api/v1/quizzes', { title: 'Quiz da Maria' }).expect(201);
    const other = await signup('João', 'joao@teste.local');
    await other.client.get(`/api/v1/quizzes/${quiz.body.id}`).expect(404);
    const list = await other.client.get('/api/v1/quizzes').expect(200);
    expect(list.body.items).toHaveLength(0);
    expect(user.accountId).not.toBe(other.user.accountId);
  });

  it('e-mail repetido é recusado', async () => {
    await signup('Ana', 'ana@teste.local');
    await request(server.http)
      .post('/api/v1/auth/signup')
      .send({ name: 'Ana 2', email: 'ANA@teste.local', password: PASSWORD, acceptTerms: true })
      .expect(409);
  });

  it('limites do Gratuito: 5 quizzes, 1 usuário, 5 pessoas por sessão', async () => {
    const { client } = await signup('Limite', 'limite@teste.local');
    for (let i = 0; i < 5; i++)
      await client.post('/api/v1/quizzes', { title: `Quiz ${i + 1}` }).expect(201);
    const sixth = await client.post('/api/v1/quizzes', { title: 'Quiz 6' }).expect(402);
    expect(sixth.body.error.code).toBe('PLAN_LIMIT_QUIZZES');
    const user = await client
      .post('/api/v1/users', {
        name: 'Outro',
        email: 'outro@teste.local',
        password: 'senha-do-outro-1',
        role: 'ADMIN',
      })
      .expect(402);
    expect(user.body.error.code).toBe('PLAN_LIMIT_USERS');

    // Arquivar libera espaço
    const list = await client.get('/api/v1/quizzes').expect(200);
    await client.post(`/api/v1/quizzes/${list.body.items[0].id}/archive`).expect(200);
    await client.post('/api/v1/quizzes', { title: 'Quiz 6' }).expect(201);
  });

  it('sessão respeita o limite de participantes do plano', async () => {
    const { client } = await signup('Sala', 'sala@teste.local');
    const quiz = await createPublishedQuiz(client);
    const s = await client
      .post('/api/v1/sessions', { quizId: quiz.id, settings: { maxParticipants: 200 } })
      .expect(201);
    expect(s.body.settings.maxParticipants).toBe(5);
  });
});

describe('assinatura', () => {
  it('upgrade para o Mensal só vale após o pagamento; limites e notificação mudam', async () => {
    const { client } = await signup('Pagante', 'pagante@teste.local');
    const res = await client
      .post('/api/v1/account/checkout', {
        planId: 'MONTHLY',
        billingName: 'Pagante',
        billingDocument: '111.111.111-11',
      })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    await client
      .post('/api/v1/account/checkout', {
        planId: 'MONTHLY',
        billingName: 'Pagante',
        billingDocument: CPF,
      })
      .expect(201);
    let b = await billing(client);
    expect(b.plan.id).toBe('FREE');
    expect(b.checkoutPayment?.amountCents).toBe(990);
    // Idempotente: repetir devolve a mesma fatura
    const again = await client
      .post('/api/v1/account/checkout', {
        planId: 'MONTHLY',
        billingName: 'Pagante',
        billingDocument: CPF,
      })
      .expect(201);
    expect(again.body.payment.id).toBe(b.checkoutPayment!.id);
    await payOpen(client);
    b = await billing(client);
    expect(b.plan.id).toBe('MONTHLY');
    expect(b.plan.effectiveLimits.maxQuizzes).toBe(20);
    expect(b.currentPeriodEnd).toBeTruthy();
    expect(outbox.some((e) => e.subject.includes('Plano Mensal ativado'))).toBe(true);
  });

  it('Mensal → Anual imediato no pagamento; Anual → Mensal agendado para a renovação com exclusões', async () => {
    const { client, user } = await signup('Upgrader', 'up@teste.local');
    await subscribe(client, 'MONTHLY');
    await subscribe(client, 'YEARLY');
    let b = await billing(client);
    expect(b.plan.id).toBe('YEARLY');
    const acc = await server.ctx.prisma.account.findUniqueOrThrow({
      where: { id: user.accountId },
    });
    const oldPayments = await server.ctx.prisma.payment.count({
      where: { accountId: acc.id, planId: 'MONTHLY', status: 'RECEIVED' },
    });
    expect(oldPayments).toBe(1);

    // Cria 22 quizzes (Anual é ilimitado) e tenta voltar ao Mensal (20)
    for (let i = 0; i < 22; i++)
      await client.post('/api/v1/quizzes', { title: `Quiz ${i}` }).expect(201);
    const denied = await client.post('/api/v1/account/plan', { planId: 'MONTHLY' }).expect(422);
    expect(denied.body.error.code).toBe('PLAN_REMOVALS_REQUIRED');
    expect(denied.body.error.details.quizzes).toBe(2);
    const cands = (await client.get('/api/v1/account/removal-candidates').expect(200)).body;
    const toRemove = cands.quizzes.slice(0, 2).map((q: { id: string }) => q.id);
    const ok = await client
      .post('/api/v1/account/plan', { planId: 'MONTHLY', removeQuizIds: toRemove })
      .expect(200);
    expect(ok.body.scheduled).toBe(true);
    b = await billing(client);
    expect(b.plan.id).toBe('YEARLY');
    expect(b.pendingPlanId).toBe('MONTHLY');

    // Na data da renovação a mudança é aplicada
    await runBillingCycle(server.ctx, new Date(new Date(b.currentPeriodEnd!).getTime() + 60_000));
    b = await billing(client);
    expect(b.plan.id).toBe('MONTHLY');
    expect(b.usage.quizzes).toBe(20);
    expect(await server.ctx.prisma.quiz.count({ where: { id: { in: toRemove } } })).toBe(0);
    expect(b.openPayment?.amountCents).toBe(990);
  });

  it('desfazer um cancelamento agendado mantém o plano', async () => {
    const { client } = await signup('Volta', 'volta@teste.local');
    await subscribe(client, 'MONTHLY');
    await client.post('/api/v1/account/cancel', { reason: 'teste' }).expect(200);
    let b = await billing(client);
    expect(b.pendingPlanId).toBe('FREE');
    await client.post('/api/v1/account/plan/revert').expect(200);
    b = await billing(client);
    expect(b.pendingPlanId).toBeNull();
    expect(b.plan.id).toBe('MONTHLY');
  });

  it('cancelamento volta ao Gratuito na renovação', async () => {
    const { client } = await signup('Cancela', 'cancela@teste.local');
    await subscribe(client, 'MONTHLY');
    await client.post('/api/v1/quizzes', { title: 'Quiz 1' }).expect(201);
    const b0 = await billing(client);
    await client.post('/api/v1/account/cancel', {}).expect(200);
    await runBillingCycle(server.ctx, new Date(new Date(b0.currentPeriodEnd!).getTime() + 1000));
    const b = await billing(client);
    expect(b.plan.id).toBe('FREE');
    expect(b.openPayment).toBeNull();
    expect(outbox.some((e) => e.subject.includes('alterado para Gratuito'))).toBe(true);
  });

  it('inadimplência: lembretes D-5, D0, D+1 e congelamento em D+5; pagamento libera', async () => {
    const { client } = await signup('Atrasado', 'atrasado@teste.local');
    await subscribe(client, 'MONTHLY');
    const end = new Date((await billing(client)).currentPeriodEnd!);
    outbox.length = 0;

    await runBillingCycle(server.ctx, new Date(end.getTime() - 5 * DAY));
    expect(outbox.map((e) => e.subject)).toContain('Sua fatura do AZhoot vence em 5 dias');
    // Não repete no mesmo dia
    await runBillingCycle(server.ctx, new Date(end.getTime() - 5 * DAY + 3600_000));
    expect(outbox.filter((e) => e.subject.includes('vence em 5 dias'))).toHaveLength(1);

    await runBillingCycle(server.ctx, end);
    expect(outbox.map((e) => e.subject)).toContain('Sua fatura do AZhoot vence hoje');

    await runBillingCycle(server.ctx, new Date(end.getTime() + 1 * DAY));
    expect(outbox.map((e) => e.subject)).toContain('Fatura do AZhoot em atraso');
    expect((await billing(client)).subscriptionStatus).toBe('PAST_DUE');

    await runBillingCycle(server.ctx, new Date(end.getTime() + 5 * DAY));
    expect(outbox.map((e) => e.subject)).toContain('Sua conta AZhoot foi congelada');
    const frozen = await billing(client);
    expect(frozen.subscriptionStatus).toBe('FROZEN');
    const blocked = await client.post('/api/v1/quizzes', { title: 'Bloqueado' }).expect(402);
    expect(blocked.body.error.code).toBe('ACCOUNT_FROZEN');
    // Painel continua acessível
    await client.get('/api/v1/dashboard').expect(200);

    await payOpen(client);
    const back = await billing(client);
    expect(back.subscriptionStatus).toBe('ACTIVE');
    await client.post('/api/v1/quizzes', { title: 'Liberado' }).expect(201);
  });

  it('conta congelada pode voltar ao Gratuito imediatamente', async () => {
    const { client, user } = await signup('Congela', 'congela@teste.local');
    await subscribe(client, 'MONTHLY');
    for (let i = 0; i < 7; i++)
      await client.post('/api/v1/quizzes', { title: `Quiz ${i}` }).expect(201);
    await server.ctx.prisma.account.update({
      where: { id: user.accountId },
      data: { subscriptionStatus: 'FROZEN' },
    });
    const denied = await client.post('/api/v1/account/cancel', {}).expect(422);
    expect(denied.body.error.details.quizzes).toBe(2);
    const cands = (await client.get('/api/v1/account/removal-candidates').expect(200)).body;
    const res = await client
      .post('/api/v1/account/cancel', {
        removeQuizIds: cands.quizzes.slice(0, 2).map((q: { id: string }) => q.id),
      })
      .expect(200);
    expect(res.body.scheduled).toBe(false);
    const b = await billing(client);
    expect(b.plan.id).toBe('FREE');
    expect(b.subscriptionStatus).toBe('ACTIVE');
    expect(b.usage.quizzes).toBe(5);
  });

  it('webhook do Asaas exige token e processa renovação', async () => {
    const m = await master();
    await m
      .put('/api/v1/master/settings/asaas', {
        environment: 'sandbox',
        webhookToken: 'token-secreto-do-webhook-123',
      })
      .expect(200);
    const { client, user } = await signup('Webhook', 'wh@teste.local');
    await subscribe(client, 'MONTHLY');
    const acc = await server.ctx.prisma.account.findUniqueOrThrow({
      where: { id: user.accountId },
    });
    const payload = {
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: 'pay_renovacao_1',
        subscription: acc.asaasSubscriptionId,
        status: 'RECEIVED',
        value: 9.9,
        netValue: 9.4,
        dueDate: acc.currentPeriodEnd!.toISOString().slice(0, 10),
        paymentDate: acc.currentPeriodEnd!.toISOString().slice(0, 10),
        billingType: 'PIX',
        invoiceUrl: 'https://sandbox.asaas.com/i/abc',
      },
    };
    await request(server.http).post('/api/v1/webhooks/asaas').send(payload).expect(401);
    await request(server.http)
      .post('/api/v1/webhooks/asaas')
      .set('asaas-access-token', 'token-secreto-do-webhook-123')
      .send(payload)
      .expect(200);
    await request(server.http)
      .post('/api/v1/webhooks/asaas')
      .set('asaas-access-token', 'token-secreto-do-webhook-123')
      .send(payload)
      .expect(200);
    const payments = await server.ctx.prisma.payment.findMany({
      where: { accountId: acc.id, status: 'RECEIVED' },
    });
    expect(payments).toHaveLength(2);
    const after = await server.ctx.prisma.account.findUniqueOrThrow({ where: { id: acc.id } });
    expect(after.currentPeriodEnd!.getTime()).toBeGreaterThan(acc.currentPeriodEnd!.getTime());
  });

  it('excluir conta exige senha, remove tudo e envia e-mail', async () => {
    const { client, user } = await signup('Tchau', 'tchau@teste.local');
    await client.post('/api/v1/quizzes', { title: 'Vai sumir' }).expect(201);
    const summary = await client.get('/api/v1/account/deletion-summary').expect(200);
    expect(summary.body.quizzes).toBe(1);
    await client.agent
      .delete('/api/v1/account')
      .set('X-CSRF-Token', client.csrf)
      .send({ password: 'errada', confirm: true })
      .expect(401);
    const res = await client.agent
      .delete('/api/v1/account')
      .set('X-CSRF-Token', client.csrf)
      .send({ password: PASSWORD, confirm: true })
      .expect(204);
    expect(String(res.headers['set-cookie'])).toContain('azh_sid=;');
    expect(
      await server.ctx.prisma.account.findUnique({ where: { id: user.accountId } }),
    ).toBeNull();
    expect(await server.ctx.prisma.user.count({ where: { email: 'tchau@teste.local' } })).toBe(0);
    expect(outbox.some((e) => e.to === 'tchau@teste.local' && e.subject.includes('excluída'))).toBe(
      true,
    );
    await client.get('/api/v1/auth/me').expect(401);
  });
});

describe('afiliados', () => {
  it('indicação paga gera comissão com o percentual do afiliado; master paga manualmente', async () => {
    const m = await master();
    const aff = await signup('Afiliada Top', 'afiliada@teste.local');
    await aff.client.get('/api/v1/account/affiliate').expect(403);
    await m
      .patch(`/api/v1/master/accounts/${aff.user.accountId}`, {
        affiliateEnabled: true,
        affiliatePercentBp: 3000,
      })
      .expect(204);
    const ov = (await aff.client.get('/api/v1/account/affiliate').expect(200))
      .body as AffiliateOverview;
    expect(ov.percentBp).toBe(3000);
    expect(ov.link).toContain(`/cadastro?ref=${ov.code}`);
    await aff.client
      .put('/api/v1/account/affiliate/pix', { pixKeyType: 'EMAIL', pixKey: 'afiliada@teste.local' })
      .expect(200);

    const friend = await signup('Amigo Indicado', 'amigo@teste.local', ov.code);
    await subscribe(friend.client, 'YEARLY');
    const after = (await aff.client.get('/api/v1/account/affiliate').expect(200))
      .body as AffiliateOverview;
    expect(after.totals.referrals).toBe(1);
    expect(after.totals.paying).toBe(1);
    expect(after.totals.pendingCents).toBe(2970); // 30% de R$ 99,00
    expect(after.referrals[0]!.name).toBe('Amigo I.');

    const list = (await m.get('/api/v1/master/commissions?status=PENDING').expect(200)).body;
    expect(list.affiliates[0].pixKey).toBe('afiliada@teste.local');
    await m
      .post('/api/v1/master/commissions/pay', {
        affiliateAccountId: aff.user.accountId,
        note: 'PIX 123',
      })
      .expect(200);
    const paid = (await aff.client.get('/api/v1/account/affiliate').expect(200))
      .body as AffiliateOverview;
    expect(paid.totals.paidCents).toBe(2970);
    expect(paid.totals.pendingCents).toBe(0);
  });
});

describe('painel master', () => {
  it('somente master acessa', async () => {
    const { client } = await signup('Comum', 'comum@teste.local');
    const res = await client.get('/api/v1/master/dashboard').expect(403);
    expect(res.body.error.code).toBe('MASTER_ONLY');
  });

  it('dashboard, analíticos (MRR, ARR, CAC, ROAS), receitas e despesas', async () => {
    const m = await master();
    const a = await signup('Cliente A', 'a@teste.local');
    await subscribe(a.client, 'MONTHLY');
    const b = await signup('Cliente B', 'b@teste.local');
    await subscribe(b.client, 'YEARLY');
    await signup('Cliente C', 'c@teste.local');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    await m
      .post('/api/v1/master/expenses', {
        description: 'Anúncios',
        category: 'MARKETING',
        amountCents: 5000,
        date: today,
      })
      .expect(201);
    await m
      .post('/api/v1/master/expenses', {
        description: 'Servidor',
        category: 'INFRA',
        amountCents: 2000,
        date: today,
      })
      .expect(201);

    const d = (await m.get('/api/v1/master/dashboard').expect(200)).body;
    expect(d.mrrCents).toBe(990 + 825);
    expect(d.arrCents).toBe((990 + 825) * 12);
    expect(d.payingAccounts).toBe(2);
    expect(d.revenueMonthCents).toBe(990 + 9900);

    const an = (await m.get('/api/v1/master/analytics').expect(200)).body;
    expect(an.signups).toBe(3);
    expect(an.newPaying).toBe(2);
    expect(an.cacCents).toBe(2500);
    expect(an.roas).toBeCloseTo((990 + 9900) / 5000);
    expect(an.expensesCents).toBe(7000);
    expect(an.roi).toBeCloseTo((10890 - 7000) / 7000);
    expect(an.series.at(-1).mrrCents).toBe(1815);

    const pays = (await m.get('/api/v1/master/payments?status=PAID').expect(200)).body;
    expect(pays.total).toBe(2);

    const accounts = (await m.get('/api/v1/master/accounts?search=cliente').expect(200)).body;
    expect(accounts.total).toBe(3);
  });

  it('override de limites, plano cortesia, reset de senha e inativação', async () => {
    const m = await master();
    const { client, user } = await signup('Especial', 'especial@teste.local');
    await m
      .patch(`/api/v1/master/accounts/${user.accountId}`, { overrides: { maxQuizzes: 8 } })
      .expect(204);
    expect((await billing(client)).plan.effectiveLimits.maxQuizzes).toBe(8);
    await m
      .post(`/api/v1/master/accounts/${user.accountId}/plan`, { planId: 'YEARLY', exempt: true })
      .expect(204);
    const b = await billing(client);
    expect(b.plan.id).toBe('YEARLY');
    expect(b.billingExempt).toBe(true);

    const reset = (
      await m
        .post(`/api/v1/master/accounts/${user.accountId}/reset-password`, { sendEmail: true })
        .expect(200)
    ).body;
    await client.get('/api/v1/auth/me').expect(401);
    await login(server, 'especial@teste.local', reset.temporaryPassword);

    await m.patch(`/api/v1/master/accounts/${user.accountId}`, { active: false }).expect(204);
    await request(server.http)
      .post('/api/v1/auth/login')
      .send({ email: 'especial@teste.local', password: reset.temporaryPassword })
      .expect(401);
  });

  it('planos editáveis e configurações de e-mail com template', async () => {
    const m = await master();
    await m
      .put('/api/v1/master/plans/MONTHLY', {
        name: 'Mensal',
        description: null,
        priceCents: 1490,
        maxQuizzes: 25,
        maxParticipants: 30,
        maxUsers: 3,
        features: ['Até 25 quizzes'],
        aiCreditsIncluded: 20,
        active: true,
      })
      .expect(200);
    const { client } = await signup('Novo', 'novo@teste.local');
    const b = await billing(client);
    expect(b.plans.find((p) => p.id === 'MONTHLY')!.effectivePriceCents).toBe(1490);

    const s = (await m.get('/api/v1/master/settings/email').expect(200)).body;
    await m
      .put('/api/v1/master/settings/email', {
        ...s,
        provider: 'log',
        apiKey: 'SG.chave-de-teste-123',
        templates: {
          ...s.templates,
          welcome: { enabled: true, subject: 'Olá {{nome}}, bem-vindo!', body: 'Oi {{nome}}' },
        },
      })
      .expect(200);
    const after = (await m.get('/api/v1/master/settings/email').expect(200)).body;
    expect(after.apiKeyMasked).toBe('••••••-123');
    await signup('Bruno Alves', 'bruno@teste.local');
    expect(outbox.some((e) => e.subject === 'Olá Bruno, bem-vindo!')).toBe(true);
  });
});

describe('relatório semanal', () => {
  it('envia resumo dos quizzes da semana para contas com sessões', async () => {
    const owner = await createUser(server);
    const c = await login(server, owner.email);
    const quiz = await createPublishedQuiz(c);
    const s = await c.post('/api/v1/sessions', { quizId: quiz.id }).expect(201);
    await server.ctx.prisma.gameSession.update({
      where: { id: s.body.id },
      data: { status: 'FINISHED', startedAt: new Date(Date.now() - 2 * DAY), endedAt: new Date() },
    });
    const sent = await runWeeklyReports(server.ctx, new Date(), true);
    expect(sent).toBe(1);
    expect(
      outbox.some(
        (e) => e.subject.includes('quizzes da semana') && e.text.includes('Sessões realizadas: 1'),
      ),
    ).toBe(true);
    expect(await runWeeklyReports(server.ctx, new Date(), true)).toBe(0);
  });
});

describe('reforços de segurança (auditoria 2026-09)', () => {
  it('V3: pagamento simulado exige sessão e só o dono paga', async () => {
    const a = await signup('Dono A', 'dono-a@teste.local');
    const res = await a.client
      .post('/api/v1/account/checkout', {
        planId: 'MONTHLY',
        billingName: 'Dono A',
        billingDocument: CPF,
      })
      .expect(201);
    const providerId = (res.body.invoiceUrl as string).split('/').pop()!;

    // sem sessão → 401
    await request(server.http)
      .post(`/api/v1/billing/simulated/${providerId}/pay`)
      .send({ billingType: 'PIX' })
      .expect(401);

    // outra conta não enxerga o pagamento → 404
    const b = await signup('Dono B', 'dono-b@teste.local');
    await b.client
      .post(`/api/v1/billing/simulated/${providerId}/pay`, { billingType: 'PIX' })
      .expect(404);

    // o dono paga → 200
    await a.client
      .post(`/api/v1/billing/simulated/${providerId}/pay`, { billingType: 'PIX' })
      .expect(200);
  });

  it('V1: webhook não sobrescreve o valor de um pagamento já conhecido', async () => {
    const m = await master();
    await m
      .put('/api/v1/master/settings/asaas', {
        environment: 'sandbox',
        webhookToken: 'token-secreto-do-webhook-123',
      })
      .expect(200);
    const a = await signup('Cliente V1', 'v1@teste.local');
    const res = await a.client
      .post('/api/v1/account/checkout', {
        planId: 'MONTHLY',
        billingName: 'Cliente V1',
        billingDocument: CPF,
      })
      .expect(201);
    const providerId = (res.body.invoiceUrl as string).split('/').pop()!;
    const before = await server.ctx.prisma.payment.findUniqueOrThrow({ where: { providerId } });

    // provedor simulado nos testes: webhook usa o corpo, mas não deve alterar o valor cobrado
    await request(server.http)
      .post('/api/v1/webhooks/asaas')
      .set('asaas-access-token', 'token-secreto-do-webhook-123')
      .send({
        event: 'PAYMENT_CONFIRMED',
        payment: {
          id: providerId,
          status: 'CONFIRMED',
          value: 999.99,
          billingType: 'PIX',
          dueDate: new Date().toISOString().slice(0, 10),
          paymentDate: new Date().toISOString().slice(0, 10),
        },
      })
      .expect(200);

    const after = await server.ctx.prisma.payment.findUniqueOrThrow({ where: { providerId } });
    expect(after.amountCents).toBe(before.amountCents); // 990, não 99999
  });

  it('V6: evento de webhook repetido é ignorado (idempotência)', async () => {
    const m = await master();
    await m
      .put('/api/v1/master/settings/asaas', {
        environment: 'sandbox',
        webhookToken: 'token-secreto-do-webhook-123',
      })
      .expect(200);
    const a = await signup('Cliente V6', 'v6@teste.local');
    const res = await a.client
      .post('/api/v1/account/checkout', {
        planId: 'MONTHLY',
        billingName: 'Cliente V6',
        billingDocument: CPF,
      })
      .expect(201);
    const providerId = (res.body.invoiceUrl as string).split('/').pop()!;
    const payload = {
      id: 'evt_fixo_1',
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: providerId,
        status: 'CONFIRMED',
        value: 9.9,
        billingType: 'PIX',
        dueDate: new Date().toISOString().slice(0, 10),
        paymentDate: new Date().toISOString().slice(0, 10),
      },
    };
    await request(server.http)
      .post('/api/v1/webhooks/asaas')
      .set('asaas-access-token', 'token-secreto-do-webhook-123')
      .send(payload)
      .expect(200);
    const dup = await request(server.http)
      .post('/api/v1/webhooks/asaas')
      .set('asaas-access-token', 'token-secreto-do-webhook-123')
      .send(payload)
      .expect(200);
    expect(dup.body.duplicate).toBe(true);
    expect(await server.ctx.prisma.webhookEvent.count({ where: { eventId: 'evt_fixo_1' } })).toBe(
      1,
    );
  });

  it('V4: reset pelo master obriga troca de senha antes de agir', async () => {
    const m = await master();
    const a = await signup('Usuária V4', 'v4@teste.local');
    const r = await m
      .post(`/api/v1/master/accounts/${a.user.accountId}/reset-password`, {})
      .expect(200);
    const temp = r.body.temporaryPassword as string;

    // login com a senha temporária funciona, mas /me sinaliza mustChangePassword
    const c = await login(server, 'v4@teste.local', temp);
    const me = (await c.get('/api/v1/auth/me').expect(200)).body;
    expect(me.user.mustChangePassword).toBe(true);

    // ação que altera estado é bloqueada
    await c
      .post('/api/v1/quizzes', { title: 'Bloqueado' })
      .expect(403)
      .expect((res) => expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED'));

    // após trocar a senha, libera
    await c
      .post('/api/v1/auth/password', { currentPassword: temp, newPassword: 'NovaSenha!2026' })
      .expect(204);
    const c2 = await login(server, 'v4@teste.local', 'NovaSenha!2026');
    await c2.post('/api/v1/quizzes', { title: 'Agora vai' }).expect(201);
  });

  it('V11: resolveReferral bloqueia auto-indicação (e-mail do próprio afiliado)', async () => {
    const m = await master();
    const aff = await signup('Afiliada V11', 'v11@teste.local');
    await m
      .patch(`/api/v1/master/accounts/${aff.user.accountId}`, { affiliateEnabled: true })
      .expect(204);
    const ov = (await aff.client.get('/api/v1/account/affiliate').expect(200))
      .body as AffiliateOverview;

    // e-mail de um terceiro é aceito; o e-mail do próprio afiliado é recusado
    expect(await resolveReferral(server.ctx, ov.code, 'outra-pessoa@teste.local')).toBe(
      aff.user.accountId,
    );
    expect(await resolveReferral(server.ctx, ov.code, 'v11@teste.local')).toBeNull();
  });
});

describe('IA e créditos', () => {
  it('cadastro no Gratuito recebe créditos grátis e gera perguntas consumindo 1 crédito', async () => {
    const a = await signup('Criadora IA', 'ia@teste.local');
    let ov = (await a.client.get('/api/v1/account/credits').expect(200)).body;
    expect(ov.balance).toBe(3); // FREE inclui 3
    expect(ov.packs.length).toBe(5);

    const gen = (
      await a.client
        .post('/api/v1/account/ai/generate', {
          theme: 'Sistema Solar',
          level: '5º ano do ensino fundamental',
          count: 4,
          type: 'SINGLE_CHOICE',
        })
        .expect(200)
    ).body;
    expect(gen.questions).toHaveLength(4);
    expect(gen.questions[0].type).toBe('SINGLE_CHOICE');
    expect(
      gen.questions[0].options.filter((o: { isCorrect: boolean }) => o.isCorrect),
    ).toHaveLength(1);
    expect(gen.creditsRemaining).toBe(2);
    expect(gen.creditsUsed).toBe(1);

    ov = (await a.client.get('/api/v1/account/credits').expect(200)).body;
    expect(ov.balance).toBe(2);
    expect(ov.transactions[0].reason).toBe('GENERATION');
    expect(ov.transactions[0].delta).toBe(-1);
  });

  it('geração com anexo (imagem + planilha) consome 2 créditos', async () => {
    const a = await signup('IA anexo', 'ia-anexo@teste.local');

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Dados');
    ws.addRow(['Termo', 'Definição']);
    ws.addRow(['Fotossíntese', 'Processo das plantas']);
    const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
    const png = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 20, g: 120, b: 240 } },
    })
      .png()
      .toBuffer();

    const res = await a.client.agent
      .post('/api/v1/account/ai/generate')
      .set('X-CSRF-Token', a.client.csrf)
      .field('theme', 'Biologia')
      .field('count', '2')
      .field('type', 'VARIED')
      .attach('files', png, { filename: 'diagrama.png', contentType: 'image/png' })
      .attach('files', xlsx, {
        filename: 'glossario.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(200);

    expect(res.body.questions).toHaveLength(2);
    expect(res.body.creditsUsed).toBe(2);
    expect(res.body.creditsRemaining).toBe(1); // 3 → 1

    const ov = (await a.client.get('/api/v1/account/credits').expect(200)).body;
    expect(ov.balance).toBe(1);
    expect(ov.transactions[0].reason).toBe('GENERATION');
    expect(ov.transactions[0].delta).toBe(-2);

    const gen = await server.ctx.prisma.aiGeneration.findFirst({
      where: { accountId: a.user.accountId },
    });
    expect(gen?.attachments).toBe(2);
    expect(gen?.creditsUsed).toBe(2);
  });

  it('sem saldo para o custo do anexo (2), recusa mesmo com 1 crédito', async () => {
    const a = await signup('IA anexo sem saldo', 'ia-anexo-sem@teste.local');
    // Consome 2 dos 3 créditos com gerações de texto → sobra 1
    for (let i = 0; i < 2; i++)
      await a.client
        .post('/api/v1/account/ai/generate', { theme: 'Tema', count: 1, type: 'VARIED' })
        .expect(200);
    const png = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    const res = await a.client.agent
      .post('/api/v1/account/ai/generate')
      .set('X-CSRF-Token', a.client.csrf)
      .field('theme', 'Tema com imagem')
      .field('count', '1')
      .field('type', 'VARIED')
      .attach('files', png, { filename: 'x.png', contentType: 'image/png' })
      .expect(402);
    expect(res.body.error.code).toBe('NO_AI_CREDITS');
    // O saldo de 1 crédito permanece intacto (débito só após sucesso)
    const ov = (await a.client.get('/api/v1/account/credits').expect(200)).body;
    expect(ov.balance).toBe(1);
  });

  it('sem créditos, a geração é recusada (402 NO_AI_CREDITS)', async () => {
    const a = await signup('Sem crédito', 'semcredito@teste.local');
    // zera o saldo (3 → 0) fazendo 3 gerações
    for (let i = 0; i < 3; i++)
      await a.client
        .post('/api/v1/account/ai/generate', { theme: 'Tema', count: 1, type: 'VARIED' })
        .expect(200);
    const res = await a.client
      .post('/api/v1/account/ai/generate', { theme: 'Tema', count: 1, type: 'VARIED' })
      .expect(402);
    expect(res.body.error.code).toBe('NO_AI_CREDITS');
  });

  it('compra de pacote credita a conta ao pagar', async () => {
    const a = await signup('Compra', 'compra@teste.local');
    const packs = (await a.client.get('/api/v1/account/credits').expect(200)).body.packs;
    const pack = packs.find((p: { credits: number }) => p.credits === 50);
    const res = await a.client
      .post(`/api/v1/account/credits/packs/${pack.id}/checkout`, {
        billingName: 'Compra Teste',
        billingDocument: CPF,
      })
      .expect(201);
    expect(res.body.invoiceUrl).toContain('/pagamento-simulado/');
    const providerId = (res.body.invoiceUrl as string).split('/').pop()!;
    await a.client
      .post(`/api/v1/billing/simulated/${providerId}/pay`, { billingType: 'PIX' })
      .expect(200);
    const ov = (await a.client.get('/api/v1/account/credits').expect(200)).body;
    expect(ov.balance).toBe(3 + 50);
    expect(ov.transactions[0].reason).toBe('PURCHASE');
  });

  it('master ajusta créditos e gerencia pacotes; conta reflete no detalhe', async () => {
    const m = await master();
    const a = await signup('Ajuste', 'ajuste@teste.local');
    const r = await m
      .post(`/api/v1/master/accounts/${a.user.accountId}/credits`, { delta: 10, note: 'cortesia' })
      .expect(200);
    expect(r.body.balance).toBe(13);
    const detail = (await m.get(`/api/v1/master/accounts/${a.user.accountId}`).expect(200)).body;
    expect(detail.account.aiCreditsBalance).toBe(13);
    expect(detail.creditTransactions[0].reason).toBe('MASTER_ADJUST');

    // CRUD de pacotes
    const created = (
      await m
        .post('/api/v1/master/credit-packs', {
          name: '1000 créditos',
          credits: 1000,
          priceCents: 150000,
          sortOrder: 5,
        })
        .expect(201)
    ).body;
    await m
      .put(`/api/v1/master/credit-packs/${created.id}`, {
        name: '1000 créditos',
        credits: 1000,
        priceCents: 149900,
        active: true,
        sortOrder: 5,
      })
      .expect(200);
    const list = (await m.get('/api/v1/master/credit-packs').expect(200)).body;
    expect(list.items.some((p: { credits: number }) => p.credits === 1000)).toBe(true);
    await m.del(`/api/v1/master/credit-packs/${created.id}`).expect(204);
  });
});
