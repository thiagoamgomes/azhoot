/**
 * Teste de carga: uma sala com N participantes simulados (padrão 200).
 *
 *   pnpm test:load                      # usa SEED_OWNER_EMAIL/SEED_OWNER_PASSWORD do .env
 *   LOAD_SPREAD_MS=0 (todos respondem no mesmo instante)
 *   LOAD_PARTICIPANTS=300 LOAD_API_URL=http://localhost:3333 pnpm test:load
 *
 * Mede: tempo de entrada no lobby, latência (p50/p95/p99) da confirmação de resposta,
 * respostas processadas por segundo, perdas/duplicidades e consistência final.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { io, type Socket } from 'socket.io-client';

const root = resolve(import.meta.dirname, '../../..');
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));

const API = process.env.LOAD_API_URL ?? 'http://localhost:3333';
const N = Number(process.env.LOAD_PARTICIPANTS ?? 200);
const EMAIL = process.env.LOAD_EMAIL ?? process.env.SEED_OWNER_EMAIL ?? 'owner@azhoot.local';
const PASSWORD = process.env.LOAD_PASSWORD ?? process.env.SEED_OWNER_PASSWORD ?? '';
const DUPLICATE_RATIO = 0.1;
const SPREAD_MS = Number(process.env.LOAD_SPREAD_MS ?? 3000);

const pct = (arr: number[], p: number) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! : NaN;
};
const fmt = (n: number) => `${n.toFixed(1)} ms`;

let cookie = '';
let csrf = '';
async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0]!;
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

function connect(): Promise<Socket> {
  return new Promise((ok, fail) => {
    const s = io(`${API}/game`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: cookie ? { Cookie: cookie } : {},
    });
    s.on('connect', () => ok(s));
    s.on('connect_error', fail);
  });
}

const env = (sessionId: string, payload: object) => ({
  v: 1,
  eventId: randomUUID(),
  sessionId,
  payload,
});

async function main() {
  if (!PASSWORD) throw new Error('Defina SEED_OWNER_PASSWORD (ou LOAD_PASSWORD).');
  console.log(`▶ Teste de carga: ${N} participantes em ${API}`);
  const cpu0 = process.cpuUsage();

  const login = await http<{ csrfToken: string }>('POST', '/auth/login', {
    email: EMAIL,
    password: PASSWORD,
  });
  csrf = login.csrfToken;
  const quiz = await http<{ id: string }>('POST', '/quizzes', {
    title: `Carga ${new Date().toISOString()}`,
  });
  await http('PUT', `/quizzes/${quiz.id}`, {
    title: 'Teste de carga',
    questions: [
      {
        type: 'SINGLE_CHOICE',
        prompt: 'Pergunta de carga',
        durationSeconds: 30,
        basePoints: 1000,
        options: [
          { text: 'Certa', isCorrect: true },
          { text: 'Errada', isCorrect: false },
          { text: 'Outra', isCorrect: false },
        ],
      },
    ],
  });
  const published = await http<{
    questions: { id: string; options: { id: string; isCorrect: boolean }[] }[];
  }>('POST', `/quizzes/${quiz.id}/publish`);
  const session = await http<{ id: string; pin: string }>('POST', '/sessions', {
    quizId: quiz.id,
    settings: { maxParticipants: Math.max(N, 2) },
  });

  const host = await connect();
  await host.timeout(5000).emitWithAck('host:join', env(session.id, {}));
  let joinedEvents = 0;
  host.on('lobby:participant-joined', () => joinedEvents++);

  // Entrada: REST + socket, em paralelo
  const hostCookie = cookie;
  cookie = '';
  const joinTimes: number[] = [];
  const t0 = performance.now();
  const players = await Promise.all(
    Array.from({ length: N }, async (_, i) => {
      const start = performance.now();
      const res = await fetch(`${API}/api/v1/join/${session.pin}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: `Jogador ${i + 1}` }),
      });
      if (!res.ok) throw new Error(`join ${i}: ${res.status} ${await res.text()}`);
      const j = (await res.json()) as { token: string };
      const s = await connect();
      const ack = await s
        .timeout(10000)
        .emitWithAck('participant:join', env(session.id, { token: j.token }));
      if (!ack.ok) throw new Error(`participant:join ${i}: ${JSON.stringify(ack)}`);
      joinTimes.push(performance.now() - start);
      return s;
    }),
  );
  const joinWall = performance.now() - t0;
  cookie = hostCookie;
  await new Promise((r) => setTimeout(r, 500));
  console.log(
    `✔ ${players.length} participantes no lobby em ${fmt(joinWall)} (por participante p50 ${fmt(pct(joinTimes, 50))}, p95 ${fmt(pct(joinTimes, 95))}); eventos no host: ${joinedEvents}`,
  );

  // Início: pula a contagem aguardando a pergunta
  const opened = new Promise<void>((r) => players[0]!.once('game:question-opened', () => r()));
  await host.timeout(5000).emitWithAck('host:start', env(session.id, {}));
  await opened;
  const openedAt = performance.now();

  const q = published.questions[0]!;
  const right = q.options.find((o) => o.isCorrect)!.id;
  const wrong = q.options.find((o) => !o.isCorrect)!.id;
  const latencies: number[] = [];
  let accepted = 0;
  let duplicates = 0;
  let rejected = 0;
  const answerStart = performance.now();
  await Promise.all(
    players.map(async (s, i) => {
      await new Promise((r) => setTimeout(r, Math.random() * SPREAD_MS)); // espalha as respostas
      const answerId = randomUUID();
      const payload = { answerId, questionId: q.id, optionIds: [i % 3 === 0 ? wrong : right] };
      const t = performance.now();
      const ack = await s
        .timeout(10000)
        .emitWithAck('participant:answer', env(session.id, payload));
      latencies.push(performance.now() - t);
      if (ack.ok) accepted++;
      else rejected++;
      if (Math.random() < DUPLICATE_RATIO) {
        const dup = await s
          .timeout(10000)
          .emitWithAck('participant:answer', env(session.id, payload));
        if (dup.ok && dup.data.duplicate) duplicates++;
        else rejected++;
      }
    }),
  );
  const answerWall = performance.now() - answerStart;
  console.log(
    `✔ respostas: ${accepted} aceitas, ${duplicates} reenvios idempotentes, ${rejected} recusadas em ${fmt(answerWall)} ` +
      `(${(accepted / (answerWall / 1000)).toFixed(0)} resp/s)`,
  );
  console.log(
    `  latência de confirmação: p50 ${fmt(pct(latencies, 50))} · p95 ${fmt(pct(latencies, 95))} · p99 ${fmt(pct(latencies, 99))}`,
  );

  // Todos responderam → a pergunta fecha sozinha; revela e encerra
  await new Promise((r) => setTimeout(r, 800));
  await host.timeout(5000).emitWithAck('host:reveal', env(session.id, {}));
  const finished = new Promise<void>((r) => host.once('game:finished', () => r()));
  await host.timeout(5000).emitWithAck('host:end', env(session.id, {}));
  await finished;

  const report = await http<{
    summary: { answers: number; participants: number };
    participants: { totalScore: number }[];
  }>('GET', `/reports/sessions/${session.id}`);
  const consistent =
    report.summary.answers === N && report.summary.participants === N && accepted === N;
  const metrics = await (await fetch(`${API}/metrics`)).text();
  const serverP95 = metrics
    .split('\n')
    .find((l) =>
      l.startsWith('azhoot_socket_event_ms{event="participant:answer",quantile="0.95"}'),
    );
  const cpu = process.cpuUsage(cpu0);

  console.log(
    `✔ relatório: ${report.summary.answers} respostas persistidas para ${report.summary.participants} participantes`,
  );
  if (serverP95) console.log(`  servidor (participant:answer p95): ${serverP95.split(' ')[1]} ms`);
  console.log(
    `  cliente de carga: CPU ${((cpu.user + cpu.system) / 1000).toFixed(0)} ms, RSS ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`,
  );
  console.log(`  tempo total da pergunta: ${fmt(performance.now() - openedAt)}`);

  for (const s of players) s.close();
  host.close();

  const p95 = pct(latencies, 95);
  const ok = consistent && p95 < 500 && rejected === 0;
  console.log(
    ok
      ? '✅ Metas atingidas (p95 < 500 ms, sem duplicidade, estado consistente).'
      : '❌ Metas NÃO atingidas.',
  );
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
