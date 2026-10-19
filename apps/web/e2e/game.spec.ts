import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { io } from 'socket.io-client';
import { createQuizViaApi, joinAs, login, newPlayer, openRoom, uid } from './helpers';

const BASIC = [
  {
    type: 'SINGLE_CHOICE' as const,
    prompt: 'Quanto é 2 + 2?',
    options: [
      ['4', true],
      ['5', false],
      ['6', false],
    ] as [string, boolean][],
  },
  {
    type: 'TRUE_FALSE' as const,
    prompt: 'O Sol é uma estrela?',
    options: [
      ['Verdadeiro', true],
      ['Falso', false],
    ] as [string, boolean][],
  },
];

test('1. administrador cria, publica e abre um quiz', async ({ page }) => {
  await login(page);
  const title = `E2E Criação ${uid()}`;
  await page.getByRole('link', { name: 'Criar quiz' }).click();
  await page.getByLabel('Título').fill(title);
  await page.getByRole('button', { name: 'Criar e editar perguntas' }).click();
  await page.waitForURL('**/editar');

  await page.getByRole('button', { name: 'Adicionar a primeira pergunta' }).click();
  await page.getByLabel('Enunciado').fill('Qual é a cor do céu num dia limpo?');
  await page.getByLabel('Texto da alternativa 1').fill('Azul');
  await page.getByLabel('Texto da alternativa 2').fill('Verde');
  await expect(page.getByText(/Rascunho salvo/)).toBeVisible();

  await page.getByRole('button', { name: /^Publicar/ }).click();
  await expect(page.getByText('Tudo certo! O quiz pode ser publicado.')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Publicar', exact: true }).click();
  await expect(page.getByText('Versão 1 publicada!')).toBeVisible();

  await page.getByRole('link', { name: 'Apresentar' }).last().click();
  await page.getByRole('button', { name: 'Abrir sala' }).click();
  await page.waitForURL('**/lobby');
  await expect(page.getByText('Aguardando participantes…')).toBeVisible();
  await expect(page.getByAltText(/QR Code/)).toBeVisible();
});

test('1b. publicação bloqueia conteúdo inválido e lista os problemas', async ({ page }) => {
  await login(page);
  await page.goto('/quizzes/novo');
  await page.getByLabel('Título').fill(`E2E Inválido ${uid()}`);
  await page.getByRole('button', { name: 'Criar e editar perguntas' }).click();
  await page.waitForURL('**/editar');
  await page.getByRole('button', { name: 'Adicionar a primeira pergunta' }).click();
  await page.getByRole('button', { name: /^Publicar/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/Corrija \d+ problema/)).toBeVisible();
  await expect(dialog.getByText(/Pergunta 1: o enunciado/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Publicar', exact: true })).toBeDisabled();
});

test('2. dois participantes entram, respondem e veem o resultado', async ({ page, browser }) => {
  await login(page);
  const quizId = await createQuizViaApi(page, `E2E Partida ${uid()}`, BASIC);
  const { pin } = await openRoom(page, quizId);
  const a = await newPlayer(browser);
  const b = await newPlayer(browser);
  await joinAs(a.page, pin, 'Ana');
  await joinAs(b.page, pin, 'Beto');
  await expect(page.getByRole('button', { name: /^Ana/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Beto/ })).toBeVisible();

  await page.getByRole('button', { name: /Iniciar partida/ }).click();
  await expect(a.page.getByRole('radio', { name: /4/ })).toBeVisible({ timeout: 15_000 });
  await a.page.getByRole('radio', { name: /^A/ }).click();
  await expect(a.page.getByRole('heading', { name: 'Resposta enviada' })).toBeVisible();
  await b.page.getByRole('radio', { name: /^B/ }).click();

  // Todos responderam: fecha sozinho e o host revela
  await expect(page.getByRole('button', { name: /Revelar resposta/ })).toBeVisible();
  await page.getByRole('button', { name: /Revelar resposta/ }).click();
  await expect(a.page.getByRole('heading', { name: 'Correto!' })).toBeVisible();
  await expect(b.page.getByRole('heading', { name: 'Não foi dessa vez' })).toBeVisible();
  await expect(a.page.getByText('Você está em 1º lugar')).toBeVisible();

  await page.getByRole('button', { name: /Classificação/ }).click();
  await expect(page.getByRole('list', { name: 'Classificação' }).getByText('Ana')).toBeVisible();
  await page.getByRole('button', { name: /Próxima pergunta/ }).click();
  await a.page.getByRole('radio', { name: /Verdadeiro/ }).click();
  await b.page.getByRole('radio', { name: /Verdadeiro/ }).click();
  await page.getByRole('button', { name: /Revelar resposta/ }).click();
  await page.getByRole('button', { name: /Classificação/ }).click();
  await page.getByRole('button', { name: /Encerrar e ver pódio/ }).click();
  await expect(page.getByRole('heading', { name: 'Pódio' })).toBeVisible();
  await expect(a.page.getByRole('heading', { name: 'Fim de jogo!' })).toBeVisible();
  await expect(a.page.getByText('Você terminou em 1º lugar')).toBeVisible();
  await expect(b.page.getByText('Você terminou em 2º lugar')).toBeVisible();
  await a.ctx.close();
  await b.ctx.close();
});

test('3. participante atualiza a página e retoma a sessão', async ({ page, browser }) => {
  await login(page);
  const quizId = await createQuizViaApi(page, `E2E Retomada ${uid()}`, BASIC);
  const { pin } = await openRoom(page, quizId);
  const a = await newPlayer(browser);
  await joinAs(a.page, pin, 'Carla');
  await page.getByRole('button', { name: /Iniciar partida/ }).click();
  await expect(a.page.getByRole('radio', { name: /^A/ })).toBeVisible({ timeout: 15_000 });
  await a.page.getByRole('radio', { name: /^A/ }).click();
  await expect(a.page.getByRole('heading', { name: 'Resposta enviada' })).toBeVisible();
  await a.page.reload();
  // Após recarregar, continua como Carla e a resposta registrada é mantida (sem permitir outra)
  await expect(a.page.getByText('Carla')).toBeVisible();
  await expect(a.page.getByRole('heading', { name: 'Resposta enviada' })).toBeVisible();
  await expect(a.page.getByRole('radio')).toHaveCount(0);
  await a.ctx.close();
});

test('4. resposta após o prazo é recusada', async ({ page, browser }) => {
  await login(page);
  const quizId = await createQuizViaApi(page, `E2E Prazo ${uid()}`, [
    {
      type: 'SINGLE_CHOICE',
      prompt: 'Pergunta relâmpago?',
      durationSeconds: 5,
      options: [
        ['Sim', true],
        ['Não', false],
      ],
    },
  ]);
  const { pin, id } = await openRoom(page, quizId);
  const a = await newPlayer(browser);
  const b = await newPlayer(browser);
  await joinAs(a.page, pin, 'Davi');
  await joinAs(b.page, pin, 'Eva');
  await page.getByRole('button', { name: /Iniciar partida/ }).click();
  await expect(a.page.getByRole('radio', { name: /Sim/ })).toBeVisible({ timeout: 15_000 });
  // Ninguém responde: o servidor fecha no prazo
  await expect(a.page.getByRole('heading', { name: 'O tempo acabou' })).toBeVisible({
    timeout: 12_000,
  });
  await expect(a.page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByText('Tempo encerrado')).toBeVisible();
  // Tentativa direta após o prazo, com o token real do participante: o servidor recusa
  const stored = JSON.parse(
    (await a.page.evaluate((sid) => sessionStorage.getItem(`azhoot:participant:${sid}`), id))!,
  );
  const socket = io(process.env.E2E_API_URL ?? 'http://localhost:3333/game', {
    transports: ['websocket'],
    forceNew: true,
  });
  await new Promise<void>((r) => socket.on('connect', () => r()));
  const env = (payload: object) => ({ v: 1, eventId: randomUUID(), sessionId: id, payload });
  const resume = await socket
    .timeout(5000)
    .emitWithAck('participant:resume', env({ token: stored.token }));
  const questionId = resume.data.question.id as string;
  const optionId = resume.data.question.options[0].id as string;
  const late = await socket
    .timeout(5000)
    .emitWithAck(
      'participant:answer',
      env({ answerId: randomUUID(), questionId, optionIds: [optionId] }),
    );
  expect(late.ok).toBe(false);
  expect(late.error.code).toBe('QUESTION_CLOSED');
  socket.close();
  await a.ctx.close();
  await b.ctx.close();
});

test('5. host desconecta e recupera o controle', async ({ page, browser }) => {
  await login(page);
  const quizId = await createQuizViaApi(page, `E2E Host ${uid()}`, BASIC);
  const { pin, id } = await openRoom(page, quizId);
  const a = await newPlayer(browser);
  await joinAs(a.page, pin, 'Fábio');
  await page.getByRole('button', { name: /Iniciar partida/ }).click();
  await expect(page.getByRole('button', { name: /Encerrar respostas/ })).toBeVisible({
    timeout: 15_000,
  });
  // Queda do host: fecha a aba e abre de novo
  const context = page.context();
  await page.close();
  const host2 = await context.newPage();
  await host2.goto(`/apresentar/${id}`);
  await expect(host2).toHaveURL(new RegExp(`/apresentar/${id}/jogo`));
  await expect(host2.getByRole('button', { name: /Encerrar respostas/ })).toBeVisible();
  await host2.getByRole('button', { name: /Encerrar respostas/ }).click();
  await expect(a.page.getByRole('heading', { name: 'O tempo acabou' })).toBeVisible();
  await a.ctx.close();
});

test('6. participante removido não retorna com o mesmo token', async ({ page, browser }) => {
  await login(page);
  const quizId = await createQuizViaApi(page, `E2E Remoção ${uid()}`, BASIC);
  const { pin, id } = await openRoom(page, quizId);
  const a = await newPlayer(browser);
  await joinAs(a.page, pin, 'Gil');
  const stored = await a.page.evaluate(
    (sid) => sessionStorage.getItem(`azhoot:participant:${sid}`),
    id,
  );
  expect(stored).toBeTruthy();

  await page.getByRole('button', { name: /^Gil/ }).click();
  await page.getByRole('button', { name: 'Remover e bloquear apelido' }).click();
  await expect(a.page.getByRole('heading', { name: 'Você foi removido da sala' })).toBeVisible();
  await expect(page.getByText('Aguardando participantes…')).toBeVisible();

  // Restaura o mesmo token e recarrega: continua recusado
  await a.page.evaluate(
    ([sid, value]) => sessionStorage.setItem(`azhoot:participant:${sid}`, value!),
    [id, stored] as const,
  );
  await a.page.goto(`/jogar/${id}`);
  await expect(a.page.getByRole('heading', { name: 'Você foi removido da sala' })).toBeVisible();

  // Apelido bloqueado nesta sala
  const other = await newPlayer(browser);
  await other.page.goto(`/entrar?pin=${pin}`);
  await other.page.getByLabel('Seu apelido').fill('gil');
  await other.page.getByRole('button', { name: 'Entrar na sala' }).click();
  await expect(other.page.getByText('Este apelido não é permitido.')).toBeVisible();
  await a.ctx.close();
  await other.ctx.close();
});

test('7. relatório apresenta respostas e exporta arquivo', async ({ page, browser }) => {
  await login(page);
  const title = `E2E Relatório ${uid()}`;
  const quizId = await createQuizViaApi(page, title, BASIC.slice(0, 1));
  const { pin, id } = await openRoom(page, quizId);
  const a = await newPlayer(browser);
  await joinAs(a.page, pin, 'Helena');
  await page.getByRole('button', { name: /Iniciar partida/ }).click();
  await a.page.getByRole('radio', { name: /^A/ }).click({ timeout: 15_000 });
  await page.getByRole('button', { name: /Revelar resposta/ }).click();
  await page
    .getByRole('button', { name: /Encerrar e ver pódio|Classificação/ })
    .first()
    .click();
  const finish = page.getByRole('button', { name: /Encerrar e ver pódio/ });
  if (await finish.isVisible()) await finish.click();
  await expect(page.getByRole('heading', { name: 'Pódio' })).toBeVisible();
  await page.getByRole('link', { name: 'Ver relatório' }).click();
  await expect(page).toHaveURL(new RegExp(`/relatorios/${id}`));
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Helena' })).toBeVisible();
  await expect(page.getByText('100%').first()).toBeVisible();

  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'CSV' }).click(),
  ]);
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);
  const content = await (await csv.createReadStream()).toArray();
  const text = Buffer.concat(content as Buffer[]).toString('utf8');
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text).toContain('Helena');

  const [xlsx] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'XLSX' }).click(),
  ]);
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
  await a.ctx.close();
});

test('fluxos principais funcionam em 360 px', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const page = await ctx.newPage();
  await page.goto('/entrar');
  await expect(page.getByRole('heading', { name: 'Digite o PIN da sala' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await login(page);
  const overflowDash = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflowDash).toBe(false);
  await ctx.close();
});
