import { expect, test } from '@playwright/test';
import { loginWithPassword, ready } from './helpers';

// Roda depois de app.spec.ts (mesmo servidor e banco): as instituições demo já estão conectadas.
test.describe.configure({ mode: 'serial' });

test('categorização automática na lista e no painel', async ({ page }) => {
  await loginWithPassword(page);
  await page.goto('/transacoes?q=IFOOD');
  await expect(page.getByRole('link', { name: /IFD\*IFOOD/ }).first()).toContainText(
    'Alimentação › Delivery',
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Para onde foi o dinheiro' })).toBeVisible();
});

test('corrigir categoria cria regra e vale para o estabelecimento inteiro', async ({ page }) => {
  await loginWithPassword(page);
  await page.goto('/transacoes?q=POSTO SHELL');
  await page
    .getByRole('link', { name: /POSTO SHELL/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Categoria' })).toBeVisible();
  await ready(page);
  const veiculo = page
    .getByLabel('Categoria', { exact: true })
    .locator('option', { hasText: 'Manutenção, IPVA e seguro do veículo' });
  await page
    .getByLabel('Categoria', { exact: true })
    .selectOption({ value: (await veiculo.getAttribute('value'))! });
  await page.getByRole('button', { name: 'Salvar categoria' }).click();
  await expect(
    page.getByText(/Categoria salva\. .*parecidas atualizadas\. Regra criada/),
  ).toBeVisible();

  await page.goto('/regras');
  await expect(page.getByText(/“POSTO SHELL” \(correção\)/)).toBeVisible();
  await page.goto('/transacoes?q=POSTO SHELL');
  const rows = page.getByRole('link', { name: /POSTO SHELL/ });
  await expect(rows.first()).toContainText('Transporte › Manutenção, IPVA e seguro do veículo');
  for (const row of await rows.all()) await expect(row).not.toContainText('Combustível');
});

test('criar regra manual com prévia e aplicar às antigas', async ({ page }) => {
  await loginWithPassword(page);
  await page.goto('/regras');
  await ready(page);
  await page.getByLabel('Nome da regra').fill('Drogasil é farmácia');
  await page.getByLabel(/Se a descrição contém/).fill('drogasil');
  const opt = page.getByLabel('Então: categoria').locator('option', { hasText: 'Farmácia' });
  await page
    .getByLabel('Então: categoria')
    .selectOption({ value: (await opt.getAttribute('value'))! });
  await page.getByRole('button', { name: 'Criar regra' }).click();
  await expect(page.getByText(/Regra criada\./)).toBeVisible();
  await expect(page.getByText('Drogasil é farmácia')).toBeVisible();
});

test('dividir uma transação em duas categorias', async ({ page }) => {
  await loginWithPassword(page);
  await page.goto('/transacoes?q=MERCADO EXTRA');
  await page
    .getByRole('link', { name: /MERCADO EXTRA/ })
    .first()
    .click();
  await ready(page);
  const total = (await page.locator('h1 + span').first().textContent()) ?? '';
  expect(total).toBeTruthy();
  await page.getByRole('button', { name: 'Dividir em várias categorias' }).click();
  const first = page.getByLabel('Valor da parte 1');
  const value = Number((await first.inputValue()).replace(',', '.'));
  await first.fill((value - 10).toFixed(2));
  await page.getByLabel('Valor da parte 2').fill('10.00');
  for (const [i, label] of [
    [1, 'Mercado'],
    [2, 'Casa e decoração'],
  ] as const) {
    const sel = page.getByLabel(`Categoria da parte ${i}`);
    await sel.selectOption({
      value: (await sel.locator('option', { hasText: label }).first().getAttribute('value'))!,
    });
  }
  await page.getByRole('button', { name: 'Salvar divisão' }).click();
  await expect(page.getByText('Divisão salva.')).toBeVisible();
});

test('orçamento com barra de progresso e ritmo', async ({ page }) => {
  await loginWithPassword(page);
  await page.goto('/orcamentos');
  await ready(page);
  const sel = page.getByLabel('Categoria', { exact: true });
  await sel.selectOption({
    value: (await sel.locator('option', { hasText: 'Alimentação' }).first().getAttribute('value'))!,
  });
  await page.getByLabel('Limite no mês (R$)').fill('50');
  await page.getByRole('button', { name: 'Salvar orçamento' }).click();
  await expect(page.getByRole('progressbar', { name: /Alimentação/ })).toBeVisible();
  await expect(page.getByText(/Estourou em|No ritmo atual/).first()).toBeVisible();
});

test('cartões: melhor dia de compra, parcelas futuras e comprometimento', async ({ page }) => {
  await loginWithPassword(page);
  await page.goto('/cartoes');
  await expect(page.getByText(/Melhor dia de compra: 28/)).toBeVisible();
  await expect(page.getByText(/Próximas faturas/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Comprometimento futuro' })).toBeVisible();
  await page
    .getByText(/Ver parcelas/)
    .first()
    .click();
  await expect(page.getByText(/NOTEBOOK DELL \d+\/10/).first()).toBeVisible();
});

test('fixas × variáveis × eventuais', async ({ page }) => {
  await loginWithPassword(page);
  await page.goto('/analise');
  await expect(page.getByRole('heading', { name: 'Fixa', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Variável recorrente' })).toBeVisible();
  await expect(
    page
      .getByText('NETFLIX COM')
      .or(page.getByText(/^NETFLIX/))
      .first(),
  ).toBeVisible();
});

test('preferências: meta de poupança e uso da IA', async ({ page }) => {
  await loginWithPassword(page);
  await page.goto('/configuracoes/preferencias');
  await expect(page.getByText(/Gasto neste mês: US\$/)).toBeVisible();
  await ready(page);
  await page.getByLabel('Meta de taxa de poupança (%)').fill('30');
  await page.getByRole('button', { name: 'Salvar preferências' }).click();
  await expect(page.getByText('Salvo.')).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('· meta 30%')).toBeVisible();
});
