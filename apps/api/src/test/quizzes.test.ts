import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RunningServer } from '../server';
import {
  createPublishedQuiz,
  createUser,
  login,
  resetDb,
  sampleDraft,
  startTestServer,
  type Client,
} from './helpers';

let server: RunningServer;
let owner: Client;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  await resetDb(server);
  const u = await createUser(server);
  owner = await login(server, u.email);
});

describe('quizzes', () => {
  it('cria, salva rascunho e lista', async () => {
    const created = await owner.post('/api/v1/quizzes', { title: 'Meu quiz' }).expect(201);
    expect(created.body.status).toBe('DRAFT');
    expect(created.body.questions).toEqual([]);
    const saved = await owner
      .put(`/api/v1/quizzes/${created.body.id}`, sampleDraft({ title: 'Meu quiz' }))
      .expect(200);
    expect(saved.body.questions).toHaveLength(4);
    expect(saved.body.savedAt).toBeTruthy();
    // IDs preservados em novo autosave
    const again = await owner
      .put(`/api/v1/quizzes/${created.body.id}`, {
        ...sampleDraft(),
        questions: saved.body.questions,
      })
      .expect(200);
    expect(again.body.questions.map((q: { id: string }) => q.id)).toEqual(
      saved.body.questions.map((q: { id: string }) => q.id),
    );
    const list = await owner.get('/api/v1/quizzes?search=teste').expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].questionCount).toBe(4);
  });

  it('reordena perguntas e alternativas', async () => {
    const created = await owner.post('/api/v1/quizzes', { title: 'Ordem' }).expect(201);
    const saved = await owner.put(`/api/v1/quizzes/${created.body.id}`, sampleDraft()).expect(200);
    const qs = saved.body.questions;
    const reordered = [qs[2], qs[0], qs[1], qs[3]];
    reordered[1].options = [...reordered[1].options].reverse();
    const r = await owner
      .put(`/api/v1/quizzes/${created.body.id}`, { ...sampleDraft(), questions: reordered })
      .expect(200);
    expect(r.body.questions.map((q: { id: string }) => q.id)).toEqual(
      reordered.map((q: { id: string }) => q.id),
    );
    expect(r.body.questions[1].options.map((o: { text: string }) => o.text)).toEqual([
      '22',
      '5',
      '4',
    ]);
  });

  it('publicação bloqueia conteúdo inválido e lista problemas', async () => {
    const created = await owner.post('/api/v1/quizzes', { title: 'Inválido' }).expect(201);
    await owner
      .put(`/api/v1/quizzes/${created.body.id}`, {
        title: 'Inválido',
        questions: [
          {
            type: 'SINGLE_CHOICE',
            prompt: 'x',
            durationSeconds: 20,
            basePoints: 1000,
            options: [{ text: 'a', isCorrect: false }],
          },
        ],
      })
      .expect(200);
    const res = await owner.post(`/api/v1/quizzes/${created.body.id}/publish`).expect(422);
    expect(res.body.error.code).toBe('QUIZ_INVALID');
    expect(res.body.error.details.issues.length).toBeGreaterThanOrEqual(3);
    // Rascunho não pode iniciar sessão
    const s = await owner.post('/api/v1/sessions', { quizId: created.body.id }).expect(422);
    expect(s.body.error.code).toBe('QUIZ_NOT_PUBLISHED');
  });

  it('rejeita valores fora das listas permitidas', async () => {
    const created = await owner.post('/api/v1/quizzes', { title: 'Tempo' }).expect(201);
    const bad = sampleDraft();
    bad.questions[0]!.durationSeconds = 7;
    const res = await owner.put(`/api/v1/quizzes/${created.body.id}`, bad).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('versão publicada usada em sessão permanece imutável', async () => {
    const quiz = await createPublishedQuiz(owner);
    const session = await owner.post('/api/v1/sessions', { quizId: quiz.id }).expect(201);
    const v1 = await server.ctx.prisma.gameSession.findUniqueOrThrow({
      where: { id: session.body.id },
    });

    // Editar gera novo rascunho (v2)
    const edited = sampleDraft({ title: 'Quiz editado' });
    edited.questions[0]!.prompt = 'Pergunta alterada?';
    await owner.put(`/api/v1/quizzes/${quiz.id}`, edited).expect(200);
    const detail = await owner.get(`/api/v1/quizzes/${quiz.id}`).expect(200);
    expect(detail.body.hasDraft).toBe(true);
    expect(detail.body.editingVersionNumber).toBe(2);
    expect(detail.body.publishedVersionNumber).toBe(1);

    const oldQuestions = await server.ctx.prisma.question.findMany({
      where: { quizVersionId: v1.quizVersionId },
    });
    expect(oldQuestions.find((q) => q.position === 0)?.prompt).toBe('Quanto é 2 + 2?');

    await owner.post(`/api/v1/quizzes/${quiz.id}/publish`).expect(200);
    const s2 = await owner.post('/api/v1/sessions', { quizId: quiz.id }).expect(201);
    expect(s2.body.quizVersionNumber).toBe(2);
    const stillOld = await server.ctx.prisma.question.findMany({
      where: { quizVersionId: v1.quizVersionId },
    });
    expect(stillOld.find((q) => q.position === 0)?.prompt).toBe('Quanto é 2 + 2?');
  });

  it('duplica, arquiva e protege exclusão de quiz usado', async () => {
    const quiz = await createPublishedQuiz(owner);
    const dup = await owner.post(`/api/v1/quizzes/${quiz.id}/duplicate`).expect(201);
    expect(dup.body.title).toContain('(cópia)');
    expect(dup.body.status).toBe('DRAFT');
    expect(dup.body.questions).toHaveLength(4);
    expect(dup.body.questions[0].id).not.toBe(quiz.questions[0]!.id);

    await owner.post('/api/v1/sessions', { quizId: quiz.id }).expect(201);
    const del = await owner.del(`/api/v1/quizzes/${quiz.id}`).expect(409);
    expect(del.body.error.code).toBe('QUIZ_IN_USE');
    const archived = await owner.post(`/api/v1/quizzes/${quiz.id}/archive`).expect(200);
    expect(archived.body.status).toBe('ARCHIVED');
    await owner.put(`/api/v1/quizzes/${quiz.id}`, sampleDraft()).expect(422);
    await owner.post('/api/v1/sessions', { quizId: quiz.id }).expect(422);
    await owner.post(`/api/v1/quizzes/${quiz.id}/unarchive`).expect(200);
    await owner.del(`/api/v1/quizzes/${dup.body.id}`).expect(204);
  });

  it('apresentador vê somente quizzes publicados', async () => {
    await createPublishedQuiz(owner);
    await owner.post('/api/v1/quizzes', { title: 'Rascunho secreto' }).expect(201);
    const p = await createUser(server, 'PRESENTER');
    const pc = await login(server, p.email);
    const list = await pc.get('/api/v1/quizzes').expect(200);
    expect(list.body.items.map((q: { title: string }) => q.title)).toEqual(['Quiz de teste']);
  });
});

describe('uploads', () => {
  it('aceita imagem válida e re-codifica em WebP', async () => {
    const png = await sharp({
      create: { width: 64, height: 48, channels: 3, background: '#2563EB' },
    })
      .png()
      .toBuffer();
    const res = await owner.agent
      .post('/api/v1/uploads/images')
      .set('X-CSRF-Token', owner.csrf)
      .attach('file', png, { filename: 'a.png', contentType: 'image/png' })
      .expect(201);
    expect(res.body.url).toMatch(/^\/uploads\/[a-f0-9-]+\.webp$/);
    const file = await owner.agent.get(res.body.url).expect(200);
    expect(file.headers['content-type']).toBe('image/webp');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
  });

  it('recusa conteúdo que não é imagem, mesmo com MIME de imagem', async () => {
    const res = await owner.agent
      .post('/api/v1/uploads/images')
      .set('X-CSRF-Token', owner.csrf)
      .attach('file', Buffer.from('<script>alert(1)</script>'), {
        filename: 'x.png',
        contentType: 'image/png',
      })
      .expect(422);
    expect(res.body.error.code).toBe('UPLOAD_INVALID');
  });
});
