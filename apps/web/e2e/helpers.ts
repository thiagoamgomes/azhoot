import { devices, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const OWNER_EMAIL =
  process.env.E2E_EMAIL ?? process.env.SEED_OWNER_EMAIL ?? 'owner@azhoot.local';
export const OWNER_PASSWORD = process.env.E2E_PASSWORD ?? process.env.SEED_OWNER_PASSWORD ?? '';

export const uid = () => Math.random().toString(36).slice(2, 7);

export async function login(page: Page) {
  if (!OWNER_PASSWORD)
    throw new Error('Defina SEED_OWNER_PASSWORD (ou E2E_PASSWORD) no .env para os testes E2E.');
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(OWNER_EMAIL);
  await page.getByLabel('Senha').fill(OWNER_PASSWORD);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL('**/dashboard');
}

async function csrf(page: Page) {
  const me = await page.request.get('/api/v1/auth/me');
  return ((await me.json()) as { csrfToken: string }).csrfToken;
}

interface Q {
  type: 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'POLL';
  prompt: string;
  durationSeconds?: number;
  basePoints?: number;
  options: [string, boolean][];
}

/** Cria e publica um quiz pela API (mesma sessão autenticada da página). */
export async function createQuizViaApi(page: Page, title: string, questions: Q[]) {
  const token = await csrf(page);
  const headers = { 'X-CSRF-Token': token };
  const created = await page.request.post('/api/v1/quizzes', { data: { title }, headers });
  expect(created.ok()).toBeTruthy();
  const { id } = (await created.json()) as { id: string };
  const saved = await page.request.put(`/api/v1/quizzes/${id}`, {
    headers,
    data: {
      title,
      questions: questions.map((q) => ({
        type: q.type,
        prompt: q.prompt,
        durationSeconds: q.durationSeconds ?? 20,
        basePoints: q.basePoints ?? (q.type === 'POLL' ? 0 : 1000),
        options: q.options.map(([text, isCorrect]) => ({ text, isCorrect })),
      })),
    },
  });
  expect(saved.ok()).toBeTruthy();
  const pub = await page.request.post(`/api/v1/quizzes/${id}/publish`, { headers });
  expect(pub.ok()).toBeTruthy();
  return id;
}

/** Abre uma sala para o quiz e retorna PIN e sessionId, já no lobby do apresentador. */
export async function openRoom(page: Page, quizId: string, settings: Record<string, unknown> = {}) {
  const token = await csrf(page);
  const res = await page.request.post('/api/v1/sessions', {
    data: { quizId, settings },
    headers: { 'X-CSRF-Token': token },
  });
  expect(res.ok()).toBeTruthy();
  const s = (await res.json()) as { id: string; pin: string };
  await page.goto(`/apresentar/${s.id}/lobby`);
  await expect(page.getByText('Aguardando participantes…')).toBeVisible();
  return s;
}

export async function newPlayer(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    ...devices['Pixel 7'],
    launchOptions: undefined,
  } as never);
  const page = await ctx.newPage();
  return { ctx, page };
}

export async function joinAs(page: Page, pin: string, nickname: string) {
  await page.goto(`/entrar?pin=${pin}`);
  await page.getByLabel('Seu apelido').fill(nickname);
  await page.getByRole('button', { name: 'Entrar na sala' }).click();
  await expect(page.getByRole('heading', { name: 'Você está na sala!' })).toBeVisible();
}
