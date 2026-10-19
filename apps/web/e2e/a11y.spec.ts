import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createQuizViaApi, joinAs, login, newPlayer, openRoom, uid } from './helpers';

async function audit(page: Page, name: string) {
  const res = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const serious = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const summary = serious.map(
    (v) =>
      `${v.id}: ${v.help} (${v.nodes
        .map((n) => n.target.join(' '))
        .slice(0, 3)
        .join(', ')})`,
  );
  expect(summary, `${name}\n${summary.join('\n')}`).toEqual([]);
}

test('acessibilidade AA nas telas principais', async ({ page, browser }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await audit(page, 'landing');
  await page.goto('/login');
  await audit(page, 'login');
  await page.goto('/entrar');
  await audit(page, 'entrar');
  await page.goto('/cadastro');
  await audit(page, 'cadastro');
  await login(page);
  for (const [path, name] of [
    ['/planos', 'planos'],
    ['/master', 'master dashboard'],
    ['/master/usuarios', 'master usuários'],
    ['/master/receitas', 'master receitas'],
    ['/master/despesas', 'master despesas'],
    ['/master/analiticos', 'master analíticos'],
    ['/master/afiliados', 'master afiliados'],
    ['/master/configuracoes', 'master configurações'],
  ] as const) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await audit(page, name);
  }
  await audit(page, 'dashboard');
  await page.goto('/quizzes');
  await page.waitForLoadState('networkidle');
  await audit(page, 'quizzes');
  const quizId = await createQuizViaApi(page, `A11y ${uid()}`, [
    {
      type: 'SINGLE_CHOICE',
      prompt: 'Pergunta acessível?',
      options: [
        ['Sim', true],
        ['Não', false],
      ],
    },
  ]);
  await page.goto(`/quizzes/${quizId}/editar`);
  await expect(page.getByLabel('Enunciado')).toBeVisible();
  await audit(page, 'editor');
  await page.goto('/configuracoes');
  await page.waitForLoadState('networkidle');
  await audit(page, 'configurações');
  const { pin, id } = await openRoom(page, quizId);
  const p = await newPlayer(browser);
  await joinAs(p.page, pin, 'Ivo');
  await audit(p.page, 'participante lobby');
  await audit(page, 'apresentador lobby');
  await page.getByRole('button', { name: /Iniciar partida/ }).click();
  await expect(p.page.getByRole('radio', { name: /Sim/ })).toBeVisible({ timeout: 15_000 });
  await audit(p.page, 'participante pergunta');
  await audit(page, 'apresentador pergunta');
  await page.goto(`/relatorios/${id}`);
  await p.ctx.close();
});

test('navegação por teclado no login e foco visível', async ({ page }) => {
  await page.goto('/login');
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.id);
  expect(['email', 'password']).toContain(focused);
  const outline = await page.evaluate(
    () =>
      getComputedStyle(document.activeElement!).outlineStyle +
      getComputedStyle(document.activeElement!).boxShadow,
  );
  expect(outline).not.toBe('none' + 'none');
});
