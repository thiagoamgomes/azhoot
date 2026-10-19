import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { JoinResponse, SessionReport, SessionSnapshot } from '@azhoot/contracts';
import type { RunningServer } from '../server';
import {
  connectSocket,
  createPublishedQuiz,
  createUser,
  login,
  resetDb,
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
  for (const s of sockets) s.close();
  await server.close();
});
beforeEach(async () => {
  await resetDb(server);
  const u = await createUser(server);
  owner = await login(server, u.email);
});

/** Executa uma partida curta: 2 participantes respondem à primeira pergunta e a sessão é encerrada. */
async function playShortGame() {
  const quiz = await createPublishedQuiz(owner);
  const session = (await owner.post('/api/v1/sessions', { quizId: quiz.id }).expect(201)).body;
  const host = await connectSocket(server, owner.cookie);
  sockets.push(host);
  await host.emit('host:join', session.id, {});
  const players: { s: TestSocket; j: JoinResponse }[] = [];
  for (const nick of ['Zé Ação', 'Márcia']) {
    const j = (
      await request(server.http)
        .post(`/api/v1/join/${session.pin}`)
        .send({ nickname: nick })
        .expect(201)
    ).body;
    const s = await connectSocket(server);
    sockets.push(s);
    await s.emit('participant:join', j.sessionId, { token: j.token });
    players.push({ s, j });
  }
  // Pula a contagem regressiva para acelerar o teste
  await host.emit('host:start', session.id, {});
  await server.engine.command(session.id, 'countdownDone');
  await players[0]!.s.waitFor<SessionSnapshot>('game:question-opened');
  const q = quiz.questions[0]!;
  const right = q.options.find((o) => o.isCorrect)!.id;
  const wrong = q.options.find((o) => !o.isCorrect)!.id;
  await players[0]!.s.emit('participant:answer', session.id, {
    answerId: randomUUID(),
    questionId: q.id,
    optionIds: [right],
  });
  await players[1]!.s.emit('participant:answer', session.id, {
    answerId: randomUUID(),
    questionId: q.id,
    optionIds: [wrong],
  });
  await host.waitFor('game:question-locked');
  await host.emit('host:end', session.id, {});
  await host.waitFor('game:finished');
  return { session, quiz };
}

describe('relatórios', () => {
  it('relatório confere com respostas persistidas', async () => {
    const { session } = await playShortGame();
    const res = await owner.get(`/api/v1/reports/sessions/${session.id}`).expect(200);
    const report = res.body as SessionReport;
    expect(report.summary.participants).toBe(2);
    const dbAnswers = await server.ctx.prisma.answer.count({
      where: { gameSessionId: session.id },
    });
    expect(report.summary.answers).toBe(dbAnswers);
    expect(report.answers).toHaveLength(dbAnswers);
    expect(report.summary.averageAccuracy).toBe(0.5);
    expect(report.participants[0]!.nickname).toBe('Zé Ação');
    expect(report.participants[0]!.rank).toBe(1);
    const q1 = report.questions[0]!;
    expect(q1.totalAnswers).toBe(2);
    expect(q1.correctAnswers).toBe(1);
    expect(q1.options.reduce((a, o) => a + o.count, 0)).toBe(2);
    const sumScores = report.participants.reduce((a, p) => a + p.totalScore, 0);
    const dbSum = await server.ctx.prisma.answer.aggregate({
      where: { gameSessionId: session.id },
      _sum: { scoreAwarded: true },
    });
    expect(sumScores).toBe(dbSum._sum.scoreAwarded);
  }, 20000);

  it('exporta CSV UTF-8 com BOM e XLSX com as abas exigidas', async () => {
    const { session } = await playShortGame();
    const csv = await owner.agent
      .get(`/api/v1/reports/sessions/${session.id}/export?format=csv`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const buf = csv.body as Buffer;
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = buf.toString('utf8');
    expect(text).toContain('Zé Ação');
    expect(text).toContain('Márcia');
    expect(text.split('\r\n')[0]).toContain('Posição;Apelido;Pontuação');

    const xlsx = await owner.agent
      .get(`/api/v1/reports/sessions/${session.id}/export?format=xlsx`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Resumo', 'Participantes', 'Perguntas']);
    expect(wb.getWorksheet('Participantes')!.getRow(2).getCell(2).value).toBe('Zé Ação');
    expect(await server.ctx.prisma.auditLog.count({ where: { action: 'report.exported' } })).toBe(
      2,
    );
  }, 20000);

  it('exclusão anonimiza participantes e dashboard reflete os totais', async () => {
    const { session } = await playShortGame();
    const dash = await owner.get('/api/v1/dashboard').expect(200);
    expect(dash.body.totals.sessions).toBe(1);
    expect(dash.body.totals.participants).toBe(2);
    expect(dash.body.averageAccuracy).toBe(0.5);
    expect(dash.body.topQuizzes[0].sessions).toBe(1);

    await owner.del(`/api/v1/reports/sessions/${session.id}?mode=ANONYMIZE`).expect(204);
    const report = (await owner.get(`/api/v1/reports/sessions/${session.id}`).expect(200))
      .body as SessionReport;
    expect(report.participants.map((p) => p.nickname).sort()).toEqual([
      'Participante 1',
      'Participante 2',
    ]);
    await owner.del(`/api/v1/reports/sessions/${session.id}?mode=DELETE`).expect(204);
    await owner.get(`/api/v1/reports/sessions/${session.id}`).expect(404);
  }, 20000);

  it('apresentador não vê relatório de sessão alheia', async () => {
    const { session } = await playShortGame();
    const p = await createUser(server, 'PRESENTER');
    const pc = await login(server, p.email);
    await pc.get(`/api/v1/reports/sessions/${session.id}`).expect(403);
    const list = await pc.get('/api/v1/reports/sessions').expect(200);
    expect(list.body.items).toHaveLength(0);
  }, 20000);
});
