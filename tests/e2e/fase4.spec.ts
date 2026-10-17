import { expect, test } from '@playwright/test';
import { loginWithPassword, ready } from './helpers';

// Roda depois das fases anteriores (mesmo servidor e banco): as instituições demo já estão conectadas.
test.describe.configure({ mode: 'serial' });

test('caixinhas: investimentos, reserva de emergência, metas e simulador', async ({ page }) => {
  await loginWithPassword(page);
  await page.goto('/caixinhas');
  await ready(page);
  await expect(page.getByRole('region', { name: 'Investimentos' })).toContainText(
    'Caixinha Reserva de emergência',
  );
  await expect(page.getByTestId('emergency-months')).toContainText(/meses/);

  await page.getByLabel('Meses de reserva').selectOption('12');
  await expect(page.getByRole('region', { name: 'Reserva de emergência' })).toContainText(
    /para 12 meses|Meta de/,
  );

  const form = page.getByRole('form', { name: 'Nova meta' });
  await form.getByLabel('Nome').fill('Viagem');
  await form.getByLabel('Quanto quer juntar (R$)').fill('6000');
  await form.getByLabel('Já guardado (R$)').fill('1500');
  await form.getByRole('button', { name: 'Criar meta' }).click();
  const row = page.getByTestId('goal-row').filter({ hasText: 'Viagem' });
  await expect(row).toContainText('25%');

  await row.getByRole('button', { name: 'Atualizar valor guardado de Viagem' }).click();
  await row.getByLabel('Guardado (R$)').fill('3000');
  await row.getByRole('button', { name: 'Salvar' }).click();
  await expect(row).toContainText('50%');

  await page.getByLabel('Quero chegar a (R$)').fill('20000');
  await expect(page.getByTestId('yield-result')).toContainText('Você aportou');
  await expect(page.getByTestId('yield-needed')).toContainText('por mês');

  await row.getByRole('button', { name: 'Apagar Viagem' }).click();
  await expect(page.getByTestId('goal-row').filter({ hasText: 'Viagem' })).toHaveCount(0);
});

test('patrimônio e assinaturas', async ({ page }) => {
  await loginWithPassword(page);
  await page.goto('/patrimonio');
  await ready(page);
  await expect(page.getByTestId('net-worth')).toContainText('R$');
  await expect(page.getByText('Caixinha Reserva de emergência')).toBeVisible();

  await page.goto('/assinaturas');
  await ready(page);
  await expect(page.getByTestId('subs-monthly')).toContainText('por mês');
});

test('assistente responde sobre a reserva', async ({ page }) => {
  await loginWithPassword(page);
  await page.goto('/assistente');
  await ready(page);
  const chat = page.getByRole('region', { name: 'Conversa com o assistente' });
  await chat.getByLabel('Sua pergunta').fill('Minha reserva de emergência está boa?');
  await chat.getByLabel('Sua pergunta').press('Enter');
  await expect(chat.locator('[data-role="answer"]').first()).toContainText('Investido');
});

test('relatório do mês, visão anual e exportação CSV', async ({ page }) => {
  await loginWithPassword(page);
  await page.goto('/relatorios');
  await ready(page);
  await expect(page.getByTestId('report-expense')).toContainText('R$');
  await expect(page.getByRole('region', { name: 'Gastos por categoria' })).toBeVisible();

  await page.getByRole('link', { name: 'Período anterior' }).click();
  await expect(page).toHaveURL(/\/relatorios\?m=\d{4}-\d{2}/);

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Exportar CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^transacoes_\d{4}-\d{2}-01_\d{4}-\d{2}-\d{2}\.csv$/);
  const chunks: Buffer[] = [];
  for await (const c of (await file.createReadStream())!) chunks.push(c as Buffer);
  const csv = Buffer.concat(chunks).toString('utf8');
  expect(csv.startsWith('﻿Data;Data da compra;Descrição;Valor')).toBe(true);
  expect(csv.split('\r\n').length).toBeGreaterThan(3);

  await page.getByRole('link', { name: 'Ano', exact: true }).click();
  await expect(page).toHaveURL(/\/relatorios\/anual/);
  await expect(page.getByTestId('year-expense')).toContainText('R$');
  await expect(page.getByRole('region', { name: 'Mês a mês' })).toContainText('Total');
});
