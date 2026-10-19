import { expect, test } from '@playwright/test';
import { login, uid } from './helpers';

/**
 * Fluxos SaaS com o provedor de pagamento simulado (sem chave do Asaas em dev):
 * cadastro → upgrade → pagamento → cancelamento agendado → exclusão de conta.
 */
test('cadastro, upgrade pago, cancelamento e exclusão da conta', async ({ page }) => {
  const email = `e2e-${uid()}@azhoot.local`;
  const password = 'SenhaForte!123';

  await page.goto('/cadastro');
  await page.getByLabel('Seu nome').fill('Cliente E2E');
  await page.getByLabel('Empresa ou escola (opcional)').fill(`Escola E2E ${uid()}`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByText('Aceito os termos de uso').click();
  await page.getByRole('button', { name: 'Criar minha conta' }).click();
  await page.waitForURL('**/dashboard');

  // Widget do plano no menu lateral leva à página de planos
  await page
    .getByRole('link', { name: /Fazer upgrade/ })
    .first()
    .click();
  await page.waitForURL('**/planos');
  await expect(page.getByText('Seu plano atual', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Fazer upgrade para Mensal' }).click();
  await page.getByLabel('Nome completo ou razão social').fill('Cliente E2E');
  await page.getByLabel('CPF ou CNPJ').fill('529.982.247-25');
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: /Ir para o pagamento/ }).click();
  const invoice = await popupPromise;
  await invoice.getByRole('button', { name: /Pagar .* \(simulação\)/ }).click();
  await expect(invoice.getByText('Pagamento confirmado!')).toBeVisible();
  await invoice.close();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mensal' }).first()).toBeVisible();
  await expect(page.getByText('Pago').first()).toBeVisible();

  // Cancelamento: fluxo emocional, vale até o fim do período
  await page.getByRole('button', { name: 'Cancelar plano' }).click();
  await expect(page.getByText('Tem certeza que quer cancelar?')).toBeVisible();
  await page.getByRole('button', { name: 'Quero cancelar mesmo assim' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar plano' }).click();
  await expect(page.getByText(/agendad/i).first()).toBeVisible();

  // Exclusão da conta
  await page.goto('/configuracoes');
  const del = page.getByRole('button', { name: 'Excluir minha conta' });
  await expect(del).toBeDisabled();
  await page.getByText('Entendo que todos os dados da conta serão apagados').click();
  await del.click();
  await page.getByLabel('Digite sua senha para confirmar').fill(password);
  await page.getByRole('button', { name: 'Excluir definitivamente' }).click();
  await page.waitForURL(/\/(login|cadastro)?$/);

  // Não consegue mais entrar
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
});

test('painel master: todas as seções carregam', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Painel master' }).click();
  await expect(page.getByRole('heading', { name: 'Visão geral' })).toBeVisible();
  await expect(page.getByText('MRR').first()).toBeVisible();

  const master = page.getByRole('navigation', { name: 'Painel master' });
  for (const [link, heading] of [
    ['Usuários', 'Usuários'],
    ['Receitas', 'Receitas'],
    ['Despesas', 'Despesas'],
    ['Analíticos', 'Analíticos'],
    ['Afiliados', 'Afiliados'],
    ['Configurações', 'Configurações'],
  ] as const) {
    await master.getByRole('link', { name: link }).click();
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
  }

  // Lançar uma despesa de marketing
  await master.getByRole('link', { name: 'Despesas' }).click();
  await page.getByRole('button', { name: 'Nova despesa' }).click();
  const desc = `Anúncio E2E ${uid()}`;
  await page.getByLabel('Descrição').fill(desc);
  await page.getByLabel('Valor (R$)').fill('150,00');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByText(desc)).toBeVisible();
  await page.getByRole('button', { name: `Excluir ${desc}` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir' }).click();
  await expect(page.getByText(desc)).toHaveCount(0);

  // Detalhe de uma conta
  await master.getByRole('link', { name: 'Usuários' }).click();
  await page.getByRole('table').getByRole('link').first().click();
  for (const tab of ['Dados', 'Pagamentos', 'Plano', 'Afiliado']) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  }
});

test('landing: planos da API e “Assinar” leva à contratação após o cadastro', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('jogo ao vivo');
  const planos = page.locator('#planos');
  await expect(planos.getByRole('heading', { name: 'Mensal' })).toBeVisible();
  await expect(planos.getByText('R$ 9,90')).toBeVisible();
  await planos.getByRole('link', { name: 'Assinar Mensal' }).click();
  await page.waitForURL('**/cadastro?plano=MONTHLY');
  await page.getByLabel('Seu nome').fill('Visitante Landing');
  await page.getByLabel('E-mail').fill(`landing-${uid()}@azhoot.local`);
  await page.getByLabel('Senha').fill('SenhaForte!123');
  await page.getByText('Aceito os termos de uso').click();
  await page.getByRole('button', { name: 'Criar minha conta' }).click();
  await page.waitForURL('**/planos');
  await expect(page.getByRole('button', { name: 'Fazer upgrade para Mensal' })).toBeVisible();
  // Logado, a landing oferece voltar ao painel
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Ir para o painel' }).first()).toBeVisible();
});

test('logout leva à tela de login e bloqueia rotas privadas', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Sair' }).click();
  await page.waitForURL('**/login');
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  // rota privada deslogada volta para o login
  await page.goto('/dashboard');
  await page.waitForURL('**/login');
});

test('IA: página de créditos mostra saldo e o editor gera perguntas', async ({ page }) => {
  const email = `ia-${uid()}@azhoot.local`;
  await page.goto('/cadastro');
  await page.getByLabel('Seu nome').fill('Criador IA');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('SenhaForte!123');
  await page.getByText('Aceito os termos de uso').click();
  await page.getByRole('button', { name: 'Criar minha conta' }).click();
  await page.waitForURL('**/dashboard');

  // Plano Gratuito concede 3 créditos; a página dedicada mostra saldo e pacotes
  await page.goto('/creditos');
  await expect(page.getByText('Saldo atual')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Comprar' }).first()).toBeVisible();

  // Cria um quiz e gera perguntas com IA (provedor simulado)
  await page.goto('/quizzes/novo');
  await page.getByLabel('Título').fill('Quiz com IA');
  await page.getByRole('button', { name: 'Criar e editar perguntas' }).click();
  await page.waitForURL('**/editar');
  await page.getByRole('button', { name: 'Gerar com IA' }).click();
  await page.getByRole('textbox', { name: 'Tema' }).fill('Sistema Solar');
  await page.getByLabel('Quantidade').fill('3');

  // Anexa uma imagem: o custo passa a 2 créditos e o botão reflete isso.
  const dialog = page.getByRole('dialog');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMQqfiAFTEMLQkA5+RfAe11ZGYAAAAASUVORK5CYII=',
    'base64',
  );
  await dialog
    .locator('input[type=file]')
    .setInputFiles({ name: 'diagrama.png', mimeType: 'image/png', buffer: png });
  await expect(dialog.getByText('diagrama.png')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /2 créditos/ })).toBeVisible();

  await dialog.getByRole('button', { name: /Gerar 3 · 2 créditos/ }).click();
  await expect(page.getByText(/Restam 1/)).toBeVisible();
  // As perguntas geradas entraram na lista
  await expect(page.getByText('Sistema Solar: pergunta de exemplo 1?').first()).toBeVisible();
});
