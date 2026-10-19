import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { JoinResponse, SessionSnapshot } from '@azhoot/contracts';
import { GameEngine } from '../modules/game/engine';
import type { RunningServer } from '../server';
import {
  connectSocket,
  createPublishedQuiz,
  createUser,
  login,
  resetDb,
  sampleDraft,
  sleep,
  startTestServer,
  type Client,
  type TestSocket,
} from './helpers';

let server: RunningServer;
let owner: Client;
const sockets: TestSocket[] = [];

beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  await resetDb(server);
  const u = await createUser(server, 'OWNER', undefined, { isMaster: true });
  owner = await login(server, u.email);
});

async function setupSession(settings: Record<string, unknown> = {}, draft = sampleDraft()) {
  const quiz = await createPublishedQuiz(owner, draft);
  const session = await owner.post('/api/v1/sessions', { quizId: quiz.id, settings }).expect(201);
  const host = await connectSocket(server, owner.cookie);
  sockets.push(host);
  const ack = await host.emit<SessionSnapshot>('host:join', session.body.id, {});
  expect(ack.ok).toBe(true);
  return {
    quiz,
    session: session.body as { id: string; pin: string; qrSvgDataUri: string; joinUrl: string },
    host,
  };
}

async function joinPlayer(pin: string, nickname: string) {
  const res = await request(server.http).post(`/api/v1/join/${pin}`).send({ nickname });
  if (res.status !== 201) return { res, player: null as never, join: null as never };
  const join = res.body as JoinResponse;
  const player = await connectSocket(server);
  sockets.push(player);
  const ack = await player.emit<SessionSnapshot>('participant:join', join.sessionId, {
    token: join.token,
  });
  expect(ack.ok).toBe(true);
  return { res, player, join };
}

const snap = (s: TestSocket, event: string, pred?: (p: SessionSnapshot) => boolean) =>
  s.waitFor<SessionSnapshot>(event, pred);

describe('sala e lobby', () => {
  it('gera PIN de 6 dígitos, QR Code e aceita entrada por apelido', async () => {
    const { session, host } = await setupSession();
    expect(session.pin).toMatch(/^[1-9]\d{5}$/);
    expect(session.joinUrl).toContain(`/entrar?pin=${session.pin}`);
    expect(session.qrSvgDataUri).toMatch(/^data:image\/svg\+xml;base64,/);

    const lookup = await request(server.http).get(`/api/v1/join/${session.pin}`).expect(200);
    expect(lookup.body.acceptingJoins).toBe(true);

    const { join } = await joinPlayer(session.pin, 'Ana');
    const joined = await host.waitFor<{
      participant: { nickname: string };
      participantCount: number;
    }>('lobby:participant-joined');
    expect(joined.participant.nickname).toBe('Ana');
    expect(joined.participantCount).toBe(1);
    expect(join.token.length).toBeGreaterThan(30);
  });

  it('recusa apelido inválido, repetido (normalizado) e bloqueado', async () => {
    const { session } = await setupSession();
    await owner.put('/api/v1/settings', { nicknameBlocklist: ['palavrao'] }).expect(200);
    await joinPlayer(session.pin, 'João Silva');
    const dup = await request(server.http)
      .post(`/api/v1/join/${session.pin}`)
      .send({ nickname: '  joao   SILVA ' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('NICKNAME_TAKEN');
    const invalid = await request(server.http)
      .post(`/api/v1/join/${session.pin}`)
      .send({ nickname: '<b>x</b>' });
    expect(invalid.body.error.code).toBe('NICKNAME_INVALID');
    const blocked = await request(server.http)
      .post(`/api/v1/join/${session.pin}`)
      .send({ nickname: 'Pala.vrao' });
    expect(blocked.body.error.code).toBe('NICKNAME_BLOCKED');
  });

  it('PIN inexistente é recusado', async () => {
    const res = await request(server.http).get('/api/v1/join/123456').expect(404);
    expect(res.body.error.code).toBe('PIN_INVALID');
    await request(server.http).get('/api/v1/join/abc').expect(404);
  });

  it('saída aparece no lobby e reconexão recupera a participação', async () => {
    const { session, host } = await setupSession();
    const { player, join } = await joinPlayer(session.pin, 'Bia');
    await host.waitFor('lobby:participant-joined');
    player.close();
    const left = await host.waitFor<{ reason: string }>('lobby:participant-left');
    expect(left.reason).toBe('disconnected');
    // "Atualizar a página": nova conexão com o mesmo token
    const again = await connectSocket(server);
    sockets.push(again);
    const ack = await again.emit<SessionSnapshot>('participant:resume', join.sessionId, {
      token: join.token,
      lastSeq: 0,
    });
    expect(ack.ok).toBe(true);
    if (ack.ok) expect(ack.data.me?.nickname).toBe('Bia');
  });

  it('host remove e bloqueia participante; token não volta a funcionar', async () => {
    const { session, host } = await setupSession();
    const { player, join } = await joinPlayer(session.pin, 'Carlos');
    const errorP = player.waitFor<{ code: string }>('session:error');
    const ack = await host.emit('host:remove-participant', session.id, {
      participantId: join.participantId,
      block: true,
    });
    expect(ack.ok).toBe(true);
    expect((await errorP).code).toBe('PARTICIPANT_REMOVED');
    const again = await connectSocket(server);
    sockets.push(again);
    const r = await again.emit('participant:resume', join.sessionId, { token: join.token });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('PARTICIPANT_REMOVED');
    const rejoin = await request(server.http)
      .post(`/api/v1/join/${session.pin}`)
      .send({ nickname: 'carlos' });
    expect(rejoin.body.error.code).toBe('NICKNAME_BLOCKED');
  });

  it('somente o host autorizado controla a sessão', async () => {
    const { session } = await setupSession();
    const other = await createUser(server, 'ADMIN');
    const oc = await login(server, other.email);
    const s = await connectSocket(server, oc.cookie);
    sockets.push(s);
    const r = await s.emit('host:start', session.id, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
    const anon = await connectSocket(server);
    sockets.push(anon);
    const r2 = await anon.emit('host:start', session.id, {});
    if (!r2.ok) expect(r2.error.code).toBe('UNAUTHENTICATED');
    await oc.post(`/api/v1/sessions/${session.id}/start`).expect(403);
  });

  it('payload inválido é recusado sem alterar estado', async () => {
    const { session, host } = await setupSession();
    const bad = await host.socket
      .timeout(3000)
      .emitWithAck('host:start', { v: 99, sessionId: session.id, payload: {} });
    expect(bad.ok).toBe(false);
    const invalid = await host.emit('host:reveal', session.id, {});
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe('INVALID_TRANSITION');
    const s = await server.ctx.prisma.gameSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(s.status).toBe('LOBBY');
  });
});

describe('partida', () => {
  it('fluxo completo com dois participantes, pontuação, ranking e pódio', async () => {
    const { session, host, quiz } = await setupSession();
    const a = await joinPlayer(session.pin, 'Alice');
    const b = await joinPlayer(session.pin, 'Bruno');
    await sleep(100);

    const start = await host.emit<{ seq: number }>('host:start', session.id, {});
    expect(start.ok).toBe(true);
    const cd = await snap(a.player, 'game:countdown');
    expect(cd.countdownEndsAt).toBeTruthy();

    // Pergunta aberta após a contagem (5 s) — mesmo payload público para todos
    const qa = await snap(a.player, 'game:question-opened', undefined);
    const qb = await snap(b.player, 'game:question-opened');
    expect(qa.question?.id).toBe(qb.question?.id);
    expect(qa.question?.closesAt).toBe(qb.question?.closesAt);
    const raw = JSON.stringify(a.player.events.filter((e) => e.event === 'game:question-opened'));
    expect(raw).not.toContain('isCorrect');
    expect(raw).not.toContain('correctOptionIds');
    expect(raw).not.toContain('Aritmética básica');

    const q1 = quiz.questions[0]!;
    const correct = q1.options.find((o) => o.isCorrect)!.id;
    const wrong = q1.options.find((o) => !o.isCorrect)!.id;
    const answerId = randomUUID();
    const r1 = await a.player.emit<{ duplicate: boolean }>('participant:answer', session.id, {
      answerId,
      questionId: q1.id,
      optionIds: [correct],
    });
    expect(r1.ok).toBe(true);
    // Reenvio idempotente
    const r1b = await a.player.emit<{ duplicate: boolean }>('participant:answer', session.id, {
      answerId,
      questionId: q1.id,
      optionIds: [correct],
    });
    expect(r1b.ok && r1b.data.duplicate).toBe(true);
    // Segunda resposta com outro ID é recusada
    const r1c = await a.player.emit('participant:answer', session.id, {
      answerId: randomUUID(),
      questionId: q1.id,
      optionIds: [wrong],
    });
    expect(!r1c.ok && r1c.error.code).toBe('ALREADY_ANSWERED');
    // Alternativa de outra pergunta é recusada
    const foreign = quiz.questions[1]!.options[0]!.id;
    const bad = await b.player.emit('participant:answer', session.id, {
      answerId: randomUUID(),
      questionId: q1.id,
      optionIds: [foreign],
    });
    expect(!bad.ok && bad.error.code).toBe('ANSWER_INVALID');

    await b.player.emit('participant:answer', session.id, {
      answerId: randomUUID(),
      questionId: q1.id,
      optionIds: [wrong],
    });

    // Todos responderam → fecha automaticamente
    const locked = await snap(host, 'game:question-locked');
    expect(locked.answeredCount).toBe(2);
    expect(locked.participants?.find((p) => p.nickname === 'Alice')?.totalScore).toBe(0); // ainda oculto

    // Resposta após o prazo é recusada
    const late = await a.player.emit('participant:answer', session.id, {
      answerId: randomUUID(),
      questionId: q1.id,
      optionIds: [correct],
    });
    expect(late.ok).toBe(false);

    await host.emit('host:reveal', session.id, {});
    const revA = await snap(a.player, 'game:reveal');
    expect(revA.reveal?.correctOptionIds).toEqual([correct]);
    expect(revA.reveal?.explanation).toBe('Aritmética básica.');
    expect(revA.me?.lastResult?.isCorrect).toBe(true);
    const scoreA = revA.me!.lastResult!.scoreAwarded;
    expect(scoreA).toBeGreaterThan(500);
    expect(scoreA).toBeLessThanOrEqual(1000);
    const revB = await snap(b.player, 'game:reveal');
    expect(revB.me?.lastResult?.isCorrect).toBe(false);
    expect(revB.me?.lastResult?.scoreAwarded).toBe(0);
    expect(revB.reveal?.distribution.find((d) => d.optionId === wrong)?.count).toBe(1);
    // Participante não recebe dados de outros
    expect(revB.participants).toBeNull();

    // Fórmula conferida contra o banco
    const stored = await server.ctx.prisma.answer.findFirstOrThrow({
      where: { clientAnswerId: answerId },
    });
    const s = await server.ctx.prisma.gameSession.findUniqueOrThrow({ where: { id: session.id } });
    const opened = s.questionOpenedAt!.getTime();
    const expected = Math.round(
      1000 *
        (0.5 +
          0.5 * Math.min(1, Math.max(0, (opened + 20000 - stored.receivedAt.getTime()) / 20000))),
    );
    expect(stored.scoreAwarded).toBe(expected);

    await host.emit('host:show-leaderboard', session.id, {});
    const lb = await snap(a.player, 'game:leaderboard');
    expect(lb.leaderboard?.[0]?.nickname).toBe('Alice');
    expect(lb.me?.rank).toBe(1);

    // Avança pelas demais perguntas (sem respostas) até o fim
    for (let i = 1; i < 4; i++) {
      const cur = await server.ctx.prisma.gameSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      const n = await host.emit('host:next-question', session.id, {
        expectedSeq: cur.stateVersion,
      });
      expect(n.ok).toBe(true);
      await host.waitFor<SessionSnapshot>('game:question-opened', (p) => p.currentIndex === i);
      await host.emit('host:reveal', session.id, {});
      await host.waitFor<SessionSnapshot>('game:reveal', (p) => p.currentIndex === i);
    }
    const lastSnap = host.events.filter((e) => e.event === 'game:reveal').at(-1)!.env
      .payload as SessionSnapshot;
    expect(lastSnap.isLastQuestion).toBe(true);
    await host.emit('host:next-question', session.id, {});
    const fin = await snap(a.player, 'game:finished');
    expect(fin.status).toBe('FINISHED');
    expect(fin.podium?.[0]?.nickname).toBe('Alice');
    expect(fin.me?.rank).toBe(1);

    const parts = await server.ctx.prisma.participant.findMany({
      where: { gameSessionId: session.id },
      orderBy: { finalRank: 'asc' },
    });
    expect(parts.map((p) => [p.nickname, p.finalRank])).toEqual([
      ['Alice', 1],
      ['Bruno', 2],
    ]);
    const ended = await server.ctx.prisma.gameSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(ended.pin).toBeNull();
    expect(ended.endedAt).toBeTruthy();
    await request(server.http).get(`/api/v1/join/${session.pin}`).expect(404);
    const events = await server.ctx.prisma.sessionEvent.findMany({
      where: { gameSessionId: session.id },
      orderBy: { sequence: 'asc' },
    });
    expect(events.map((e) => e.sequence)).toEqual(events.map((_, i) => i + 1));
  }, 30000);

  it('comando duplicado com o mesmo eventId é idempotente e expectedSeq antigo é recusado', async () => {
    const { session, host } = await setupSession();
    const eventId = randomUUID();
    const env = { v: 1, eventId, sessionId: session.id, payload: { expectedSeq: 0 } };
    const r1 = await host.socket.timeout(5000).emitWithAck('host:start', env);
    const r2 = await host.socket.timeout(5000).emitWithAck('host:start', env);
    expect(r1).toEqual(r2);
    expect(r1.ok).toBe(true);
    const r3 = await host.emit('host:start', session.id, { expectedSeq: 0 });
    expect(!r3.ok && r3.error.code).toBe('CONFLICT');
    await host.emit('host:end', session.id, {});
  });

  it('resposta após o prazo do servidor é recusada; reconexão não permite duplicar', async () => {
    const draft = sampleDraft();
    draft.questions = [{ ...draft.questions[0]!, durationSeconds: 5 }];
    const { session, host, quiz } = await setupSession({}, draft);
    const a = await joinPlayer(session.pin, 'Dora');
    const b = await joinPlayer(session.pin, 'Enzo');
    await host.emit('host:start', session.id, {});
    await snap(a.player, 'game:question-opened');
    const q = quiz.questions[0]!;
    const opt = q.options[0]!.id;
    await a.player.emit('participant:answer', session.id, {
      answerId: randomUUID(),
      questionId: q.id,
      optionIds: [opt],
    });

    // Reconexão durante a pergunta: snapshot traz a resposta registrada
    a.player.close();
    const again = await connectSocket(server);
    sockets.push(again);
    const res = await again.emit<SessionSnapshot>('participant:resume', session.id, {
      token: a.join.token,
    });
    expect(res.ok && res.data.me?.currentAnswer?.selectedOptionIds).toEqual([opt]);
    const dup = await again.emit('participant:answer', session.id, {
      answerId: randomUUID(),
      questionId: q.id,
      optionIds: [opt],
    });
    expect(!dup.ok && dup.error.code).toBe('ALREADY_ANSWERED');

    // Timer do servidor fecha a pergunta; resposta tardia recusada
    await snap(host, 'game:question-locked');
    const late = await b.player.emit('participant:answer', session.id, {
      answerId: randomUUID(),
      questionId: q.id,
      optionIds: [opt],
    });
    expect(!late.ok && late.error.code).toBe('QUESTION_CLOSED');
    expect(await server.ctx.prisma.answer.count({ where: { gameSessionId: session.id } })).toBe(1);
  }, 20000);

  it('host desconecta e recupera o controle com snapshot', async () => {
    const { session, host } = await setupSession();
    await joinPlayer(session.pin, 'Fábio');
    await host.emit('host:start', session.id, {});
    host.close();
    const again = await connectSocket(server, owner.cookie);
    sockets.push(again);
    const ack = await again.emit<SessionSnapshot>('host:join', session.id, {});
    expect(ack.ok).toBe(true);
    if (ack.ok) {
      expect(['COUNTDOWN', 'QUESTION_OPEN']).toContain(ack.data.status);
      expect(ack.data.pin).toBe(session.pin);
      expect(ack.data.participants).toHaveLength(1);
    }
    const end = await again.emit('host:end', session.id, {});
    expect(end.ok).toBe(true);
  });

  it('após reinício, o motor reconstrói o prazo a partir do banco', async () => {
    const { session, host } = await setupSession();
    await host.emit('host:start', session.id, {});
    // Simula perda do processo: para os timers e cria um novo motor
    server.engine.stop();
    const fresh = new GameEngine(server.ctx);
    // Força prazo vencido da contagem
    await server.ctx.prisma.gameSession.update({
      where: { id: session.id },
      data: { countdownEndsAt: new Date(Date.now() - 1000) },
    });
    expect(await fresh.recover()).toBe(1);
    await sleep(500);
    const s = await server.ctx.prisma.gameSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(s.status).toBe('QUESTION_OPEN');
    fresh.stop();
    // Restaura o motor original para os próximos testes
    (server.engine as unknown as { stopped: boolean }).stopped = false;
  });

  it('entrada tardia pode ser desabilitada e limite de participantes respeitado', async () => {
    const { session, host } = await setupSession({ allowLateJoin: false, maxParticipants: 2 });
    await joinPlayer(session.pin, 'Um');
    await joinPlayer(session.pin, 'Dois');
    const full = await request(server.http)
      .post(`/api/v1/join/${session.pin}`)
      .send({ nickname: 'Três' });
    expect(full.body.error.code).toBe('SESSION_FULL');
    await host.emit('host:start', session.id, {});
    const late = await request(server.http)
      .post(`/api/v1/join/${session.pin}`)
      .send({ nickname: 'Quatro' });
    expect(['SESSION_STARTED', 'SESSION_FULL']).toContain(late.body.error.code);
    await host.emit('host:end', session.id, {});
  });

  it('classificação intermediária oculta quando configurado', async () => {
    const { session, host } = await setupSession({ hideIntermediateLeaderboard: true });
    await joinPlayer(session.pin, 'Gi');
    await host.emit('host:start', session.id, {});
    await snap(host, 'game:question-opened');
    await host.emit('host:reveal', session.id, {});
    const r = await host.emit('host:show-leaderboard', session.id, {});
    expect(!r.ok && r.error.code).toBe('LEADERBOARD_HIDDEN');
    await host.emit('host:end', session.id, {});
  }, 15000);

  it('encerrar no lobby cancela a sessão e libera o PIN', async () => {
    const { session } = await setupSession();
    await owner.post(`/api/v1/sessions/${session.id}/end`).expect(200);
    const s = await server.ctx.prisma.gameSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(s.status).toBe('CANCELLED');
    expect(s.pin).toBeNull();
  });
});
