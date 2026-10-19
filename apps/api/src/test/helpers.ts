import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import argon2 from 'argon2';
import { io as ioClient, type Socket } from 'socket.io-client';
import request from 'supertest';
import {
  CONTRACT_VERSION,
  type Ack,
  type QuizDraftInput,
  type SessionSnapshot,
  type ServerEnvelope,
} from '@azhoot/contracts';
import '../config/env';
import { startServer, type RunningServer } from '../server';
import { clearSettingsCache } from '../modules/settings/service';
import { clearPlanCache } from '../modules/billing/plans';
import { outbox } from '../modules/notifications/mailer';
import { clearPlatformCache } from '../modules/platform/settings';

export const PASSWORD = 'senha-segura-123';

export async function startTestServer(): Promise<RunningServer> {
  const db = process.env.TEST_DATABASE_URL;
  const redis = process.env.TEST_REDIS_URL;
  if (!db || !redis) throw new Error('Defina TEST_DATABASE_URL e TEST_REDIS_URL (.env)');
  return startServer(
    {
      NODE_ENV: 'test',
      DATABASE_URL: db,
      REDIS_URL: redis,
      WEB_ORIGIN: 'http://localhost:5173',
      UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'azhoot-up-')),
      SESSION_SECRET: 'test-secret-test-secret-test-secret-000',
      LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    },
    0,
  );
}

export async function resetDb(server: RunningServer) {
  const { prisma, redis } = server.ctx;
  await prisma.$executeRawUnsafe(
    `TRUNCATE "Answer","SessionEvent","SessionBan","Participant","GameSession","Option","Question","QuizVersion","Quiz","AdminSession","AuditLog","AppSetting","User","Account","Payment","SubscriptionEvent","Commission","Expense","Notification","NotificationDelivery","WebhookEvent","CreditTransaction","AiGeneration","CreditPack" RESTART IDENTITY CASCADE`,
  );
  // Restaura os planos padrão (testes do master podem alterá-los)
  const plans = [
    {
      id: 'FREE',
      name: 'Gratuito',
      priceCents: 0,
      maxQuizzes: 5,
      maxParticipants: 5,
      maxUsers: 1,
      aiCreditsIncluded: 3,
    },
    {
      id: 'MONTHLY',
      name: 'Mensal',
      priceCents: 990,
      maxQuizzes: 20,
      maxParticipants: 20,
      maxUsers: 3,
      aiCreditsIncluded: 20,
    },
    {
      id: 'YEARLY',
      name: 'Anual',
      priceCents: 9900,
      maxQuizzes: null,
      maxParticipants: 200,
      maxUsers: 10,
      aiCreditsIncluded: 100,
    },
  ];
  for (const p of plans)
    await prisma.plan.update({ where: { id: p.id }, data: { ...p, active: true } });
  // Re-semeia os pacotes de créditos padrão (o TRUNCATE apaga a tabela).
  await prisma.creditPack.createMany({
    data: [
      { name: '5 créditos', credits: 5, priceCents: 1990, sortOrder: 0 },
      { name: '10 créditos', credits: 10, priceCents: 3490, sortOrder: 1 },
      { name: '50 créditos', credits: 50, priceCents: 14900, sortOrder: 2 },
      { name: '100 créditos', credits: 100, priceCents: 24900, sortOrder: 3 },
      { name: '500 créditos', credits: 500, priceCents: 99900, sortOrder: 4 },
    ],
  });
  defaultAccountId = null;
  outbox.length = 0;
  clearPlatformCache();
  clearPlanCache();
  await redis.flushdb();
  clearSettingsCache();
}

let defaultAccountId: string | null = null;

/** Cria uma conta (padrão: Anual cortesia, para não esbarrar em limites nos testes gerais). */
export async function createAccount(
  server: RunningServer,
  opts: { planId?: 'FREE' | 'MONTHLY' | 'YEARLY'; billingExempt?: boolean; name?: string } = {},
) {
  const a = await server.ctx.prisma.account.create({
    data: {
      name: opts.name ?? 'Conta de teste',
      planId: opts.planId ?? 'YEARLY',
      billingExempt: opts.billingExempt ?? true,
    },
  });
  return a;
}

export async function createUser(
  server: RunningServer,
  role: 'OWNER' | 'ADMIN' | 'PRESENTER' = 'OWNER',
  email = `${role.toLowerCase()}-${randomUUID().slice(0, 8)}@teste.local`,
  opts: { accountId?: string; isMaster?: boolean; name?: string } = {},
) {
  let accountId = opts.accountId;
  if (!accountId) {
    defaultAccountId ??= (await createAccount(server)).id;
    accountId = defaultAccountId;
  }
  return server.ctx.prisma.user.create({
    data: {
      accountId,
      isMaster: opts.isMaster ?? false,
      name: opts.name ?? `Usuário ${role}`,
      email,
      role,
      canViewAllReports: role === 'OWNER',
      passwordHash: await argon2.hash(PASSWORD, {
        type: argon2.argon2id,
        memoryCost: 4096,
        timeCost: 1,
      }),
    },
  });
}

export interface Client {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  cookie: string;
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  put: (url: string, body?: object) => request.Test;
  patch: (url: string, body?: object) => request.Test;
  del: (url: string) => request.Test;
}

export async function login(
  server: RunningServer,
  email: string,
  password = PASSWORD,
): Promise<Client> {
  const agent = request.agent(server.http);
  const res = await agent.post('/api/v1/auth/login').send({ email, password }).expect(200);
  const csrf = res.body.csrfToken as string;
  const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  return {
    agent,
    csrf,
    cookie,
    get: (url) => agent.get(url),
    post: (url, body = {}) => agent.post(url).set('X-CSRF-Token', csrf).send(body),
    put: (url, body = {}) => agent.put(url).set('X-CSRF-Token', csrf).send(body),
    patch: (url, body = {}) => agent.patch(url).set('X-CSRF-Token', csrf).send(body),
    del: (url) => agent.delete(url).set('X-CSRF-Token', csrf),
  };
}

export function sampleDraft(over: Partial<QuizDraftInput> = {}): QuizDraftInput {
  return {
    title: 'Quiz de teste',
    description: 'Descrição',
    category: 'Geral',
    questions: [
      {
        type: 'SINGLE_CHOICE',
        prompt: 'Quanto é 2 + 2?',
        durationSeconds: 20,
        basePoints: 1000,
        explanation: 'Aritmética básica.',
        options: [
          { text: '4', isCorrect: true },
          { text: '5', isCorrect: false },
          { text: '22', isCorrect: false },
        ],
      },
      {
        type: 'MULTIPLE_CHOICE',
        prompt: 'Quais são números pares?',
        durationSeconds: 30,
        basePoints: 2000,
        options: [
          { text: '2', isCorrect: true },
          { text: '3', isCorrect: false },
          { text: '8', isCorrect: true },
        ],
      },
      {
        type: 'TRUE_FALSE',
        prompt: 'O céu é azul?',
        durationSeconds: 10,
        basePoints: 500,
        options: [
          { text: 'Verdadeiro', isCorrect: true },
          { text: 'Falso', isCorrect: false },
        ],
      },
      {
        type: 'POLL',
        prompt: 'Qual sua cor favorita?',
        durationSeconds: 15,
        basePoints: 0,
        options: [
          { text: 'Azul', isCorrect: false },
          { text: 'Verde', isCorrect: false },
        ],
      },
    ],
    ...over,
  };
}

export async function createPublishedQuiz(client: Client, draft = sampleDraft()) {
  const created = await client.post('/api/v1/quizzes', { title: draft.title }).expect(201);
  await client.put(`/api/v1/quizzes/${created.body.id}`, draft).expect(200);
  const published = await client.post(`/api/v1/quizzes/${created.body.id}/publish`).expect(200);
  return published.body as {
    id: string;
    questions: { id: string; options: { id: string; isCorrect: boolean }[] }[];
  };
}

/* ---------------------------- Socket helpers ---------------------------- */

export interface TestSocket {
  socket: Socket;
  events: { event: string; env: ServerEnvelope<unknown> }[];
  emit: <T = unknown>(event: string, sessionId: string, payload: object) => Promise<Ack<T>>;
  waitFor: <T = SessionSnapshot>(
    event: string,
    predicate?: (p: T) => boolean,
    timeoutMs?: number,
  ) => Promise<T>;
  close: () => void;
}

export function connectSocket(server: RunningServer, cookie?: string): Promise<TestSocket> {
  const socket = ioClient(`http://127.0.0.1:${server.port}/game`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    extraHeaders: cookie ? { Cookie: cookie } : undefined,
  });
  const events: TestSocket['events'] = [];
  const waiters: { event: string; pred: (p: unknown) => boolean; resolve: (p: unknown) => void }[] =
    [];
  socket.onAny((event: string, env: ServerEnvelope<unknown>) => {
    events.push({ event, env });
    for (const w of [...waiters]) {
      if (w.event === event && w.pred(env.payload)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(env.payload);
      }
    }
  });
  const api: TestSocket = {
    socket,
    events,
    emit: (event, sessionId, payload) =>
      socket
        .timeout(5000)
        .emitWithAck(event, { v: CONTRACT_VERSION, eventId: randomUUID(), sessionId, payload }),
    waitFor: (event, predicate = () => true, timeoutMs = 8000) =>
      new Promise((resolve, reject) => {
        const existing = events.find((e) => e.event === event && predicate(e.env.payload as never));
        if (existing) return resolve(existing.env.payload as never);
        const w = {
          event,
          pred: predicate as (p: unknown) => boolean,
          resolve: resolve as (p: unknown) => void,
        };
        waiters.push(w);
        setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) {
            waiters.splice(i, 1);
            reject(new Error(`timeout aguardando ${event}`));
          }
        }, timeoutMs);
      }),
    close: () => socket.close(),
  };
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(api));
    socket.on('connect_error', reject);
  });
}

export function clearEvents(s: TestSocket) {
  s.events.length = 0;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
