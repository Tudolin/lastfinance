import { expect, test } from '@playwright/test';
import { loginWithPassword, ready } from './helpers';

// Roda depois de app.spec.ts e fase2.spec.ts (mesmo servidor e banco): as instituições demo já estão conectadas.
test.describe.configure({ mode: 'serial' });

test('cadastrar renda CLT mostra o líquido com INSS, IRRF e a redução da Lei 15.270', async ({
  page,
}) => {
  await loginWithPassword(page);
  await page.goto('/renda');
  await ready(page);
  const form = page.getByRole('form', { name: 'Nova fonte de renda' });
  await form.getByLabel('Nome').fill('ACME');
  await form.getByLabel('Salário bruto (R$)').fill('6000');
  await form.getByLabel('Pagador / empregador').fill('ACME');
  const acc = form.getByLabel('Conta onde cai').locator('option', { hasText: /ita/i });
  await form
    .getByLabel('Conta onde cai')
    .selectOption({ value: (await acc.first().getAttribute('value'))! });
  await form.getByLabel('Início').fill('2025-01-01');
  await form.getByRole('button', { name: 'Adicionar fonte de renda' }).click();

  const card = page.getByTestId('income-source').filter({ hasText: 'ACME' });
  await expect(card).toBeVisible();
  await expect(card.getByTestId('income-net')).toContainText('R$ 4.973,39');
  await expect(card).toContainText('Redução Lei 15.270');
  await expect(card).toContainText('5º dia útil do mês seguinte');
  await expect(page.getByText('Ajuste anual estimado do IR')).toBeVisible();
});

test('simulador de salário recalcula no navegador', async ({ page }) => {
  await loginWithPassword(page);
  await page.goto('/renda');
  await ready(page);
  await page.getByLabel('Bruto (R$)', { exact: true }).fill('5000');
  await expect(page.getByTestId('sim-net')).toContainText('R$ 4.498,49'); // IR zerado até R$ 5 mil
});

test('previsão mostra veredito, livre por dia, gráfico e o próximo salário', async ({ page }) => {
  await loginWithPassword(page);
  await page.goto('/previsao?dias=60');
  await expect(page.getByRole('heading', { name: 'Previsão de caixa' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Veredito' })).toContainText(
    'Menor saldo previsto',
  );
  await expect(page.getByText('Livre para gastar por dia')).toBeVisible();
  await expect(
    page.getByRole('img', { name: /Saldo realizado nos últimos 30 dias/ }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Próximos movimentos' })).toBeVisible();
  await expect(page.getByText('ACME', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Previsto × Realizado por mês' })).toBeVisible();

  await page.goto('/');
  await expect(page.getByTestId('dashboard-verdict')).toBeVisible();
});

test('salário real é conciliado com o previsto', async ({ page }) => {
  await loginWithPassword(page);
  await page.goto('/previsao/conciliacao');
  const acme = page.getByTestId('reconcile-row').filter({ hasText: 'ACME' });
  await expect(acme.first()).toBeVisible();
  await expect(acme.filter({ hasText: 'realizado' }).first()).toContainText('SALARIO ACME');
});

test('confirmar uma recorrência sugerida', async ({ page }) => {
  await loginWithPassword(page);
  await page.goto('/recorrencias');
  await ready(page);
  const row = page
    .getByTestId('recurring-row')
    .filter({ hasText: /IMOBILIARIA/ })
    .first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /^Confirmar/ }).click();
  await expect(page.getByRole('heading', { name: 'Confirmadas' })).toBeVisible();
  await expect(page.getByText('Fixas confirmadas: 1')).toBeVisible();
  // A renda cadastrada (ACME) não aparece também como recorrência sugerida.
  await expect(page.getByTestId('recurring-row').filter({ hasText: 'SALARIO ACME' })).toHaveCount(
    0,
  );
});

test('Posso gastar? responde com veredito e parcelas no crédito', async ({ page }) => {
  await loginWithPassword(page);
  await page.goto('/posso-gastar');
  await ready(page);
  await page.getByLabel('Valor (R$)').fill('50');
  await page.getByRole('button', { name: 'Posso gastar?' }).click();
  await expect(page.getByTestId('verdict')).toBeVisible();

  await page.getByLabel('Valor (R$)').fill('900000');
  await page.getByRole('button', { name: 'Posso gastar?' }).click();
  await expect(page.getByTestId('verdict')).toHaveAttribute('data-verdict', 'no');
  await expect(page.getByTestId('verdict')).toContainText('negativo');

  await page.getByLabel('Valor (R$)').fill('1200');
  await page.getByLabel('Forma de pagamento').selectOption('credit');
  await page.getByLabel('Parcelas').fill('3');
  await page.getByRole('button', { name: 'Posso gastar?' }).click();
  await expect(page.getByTestId('verdict')).toContainText('as 3 parcelas saem');
  await page.getByRole('button', { name: 'Vou comprar: adicionar aos planejados' }).click();
  await expect(page.getByRole('button', { name: 'Adicionado aos planejados' })).toBeVisible();

  await page.goto('/planejados');
  await expect(page.getByTestId('planned-row').filter({ hasText: 'Crédito 3×' })).toBeVisible();
});

test('planejar um gasto no Pix', async ({ page }) => {
  await loginWithPassword(page);
  await page.goto('/planejados');
  await ready(page);
  const form = page.getByRole('form', { name: 'Planejar gasto' });
  await form.getByLabel('Descrição').fill('IPVA');
  await form.getByLabel('Valor total (R$)').fill('1500');
  await form.getByRole('button', { name: 'Planejar' }).click();
  await expect(page.getByTestId('planned-row').filter({ hasText: 'IPVA' })).toBeVisible();
});
