import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RunningServer } from '../server';
import { createUser, login, PASSWORD, resetDb, startTestServer } from './helpers';

let server: RunningServer;
beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  await resetDb(server);
});

describe('autenticação', () => {
  it('proprietário autentica, consulta /me e encerra a sessão', async () => {
    const owner = await createUser(server, 'OWNER');
    const client = await login(server, owner.email);
    expect(client.cookie).toMatch(/^azh_sid=/);
    const me = await client.get('/api/v1/auth/me').expect(200);
    expect(me.body.user.email).toBe(owner.email);
    expect(me.body.user.role).toBe('OWNER');
    await client.post('/api/v1/auth/logout').expect(204);
    await client.get('/api/v1/auth/me').expect(401);
    const audit = await server.ctx.prisma.auditLog.findMany({ where: { actorId: owner.id } });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['auth.login', 'auth.logout']),
    );
  });

  it('cookie é HttpOnly e SameSite=Lax', async () => {
    const owner = await createUser(server);
    const res = await request(server.http)
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: PASSWORD });
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('credenciais inválidas retornam 401 padronizado e registram falha', async () => {
    const owner = await createUser(server);
    const res = await request(server.http)
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: 'errada-errada' })
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(res.body.error.requestId).toBeTruthy();
    expect(res.headers['x-request-id']).toBe(res.body.error.requestId);
    expect(await server.ctx.prisma.auditLog.count({ where: { action: 'auth.login_failed' } })).toBe(
      1,
    );
  });

  it('bloqueia o e-mail após 10 falhas, mas logins válidos não contam', async () => {
    const owner = await createUser(server);
    for (let i = 0; i < 12; i++) await login(server, owner.email); // sucesso não bloqueia
    for (let i = 0; i < 10; i++)
      await request(server.http)
        .post('/api/v1/auth/login')
        .send({ email: owner.email, password: 'errada-errada' })
        .expect(401);
    const res = await request(server.http)
      .post('/api/v1/auth/login')
      .send({ email: owner.email, password: PASSWORD })
      .expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('usuário inativo não autentica', async () => {
    const u = await createUser(server, 'ADMIN');
    await server.ctx.prisma.user.update({ where: { id: u.id }, data: { active: false } });
    await request(server.http)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: PASSWORD })
      .expect(401);
  });

  it('operações que alteram estado exigem token CSRF', async () => {
    const owner = await createUser(server);
    const client = await login(server, owner.email);
    const res = await client.agent.post('/api/v1/quizzes').send({ title: 'Sem CSRF' }).expect(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
    await client.agent
      .post('/api/v1/quizzes')
      .set('X-CSRF-Token', 'invalido')
      .send({ title: 'x' })
      .expect(403);
    await client.post('/api/v1/quizzes', { title: 'Com CSRF' }).expect(201);
  });

  it('rejeita origem não autorizada', async () => {
    const owner = await createUser(server);
    await request(server.http)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://malicioso.example')
      .send({ email: owner.email, password: PASSWORD })
      .expect(403);
  });

  it('rotas privadas exigem autenticação', async () => {
    for (const path of [
      '/api/v1/quizzes',
      '/api/v1/dashboard',
      '/api/v1/users',
      '/api/v1/sessions',
      '/api/v1/reports/sessions',
    ]) {
      const res = await request(server.http).get(path);
      expect(res.status, path).toBe(401);
    }
  });
});

describe('autorização', () => {
  it('apresentador recebe 403 em rotas sem permissão', async () => {
    const presenter = await createUser(server, 'PRESENTER');
    const c = await login(server, presenter.email);
    expect((await c.get('/api/v1/users')).status).toBe(403);
    expect((await c.post('/api/v1/quizzes', { title: 'Não pode' })).status).toBe(403);
    expect((await c.put('/api/v1/settings', { nicknameBlocklist: [] })).status).toBe(403);
    expect((await c.get('/api/v1/quizzes')).status).toBe(200);
  });

  it('administrador não gerencia usuários', async () => {
    const admin = await createUser(server, 'ADMIN');
    const c = await login(server, admin.email);
    expect((await c.get('/api/v1/users')).status).toBe(403);
    expect((await c.post('/api/v1/quizzes', { title: 'Pode criar' })).status).toBe(201);
  });

  it('proprietário cria e desativa administradores', async () => {
    const owner = await createUser(server);
    const c = await login(server, owner.email);
    const created = await c
      .post('/api/v1/users', {
        name: 'Ana',
        email: 'ANA@Teste.local',
        password: 'senha-da-ana-1',
        role: 'ADMIN',
      })
      .expect(201);
    expect(created.body.email).toBe('ana@teste.local');
    await c
      .post('/api/v1/users', {
        name: 'Ana 2',
        email: 'ana@teste.local',
        password: 'senha-da-ana-1',
        role: 'ADMIN',
      })
      .expect(409);
    const ana = await login(server, 'ana@teste.local', 'senha-da-ana-1');
    await c.patch(`/api/v1/users/${created.body.id}`, { active: false }).expect(200);
    await ana.get('/api/v1/auth/me').expect(401);
    await c.patch(`/api/v1/users/${owner.id}`, { role: 'ADMIN' }).expect(403);
  });
});

describe('health', () => {
  it('liveness e readiness separados', async () => {
    const live = await request(server.http).get('/health/live').expect(200);
    expect(live.body.status).toBe('ok');
    const ready = await request(server.http).get('/health/ready').expect(200);
    expect(ready.body.checks.postgres.ok).toBe(true);
    expect(ready.body.checks.redis.ok).toBe(true);
  });

  it('métricas expostas', async () => {
    await request(server.http).get('/health/live');
    const m = await request(server.http).get('/metrics').expect(200);
    expect(m.text).toContain('azhoot_http_requests_total');
  });
});
