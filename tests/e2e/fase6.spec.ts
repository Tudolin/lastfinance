import { expect, test } from '@playwright/test';
import { loginWithPassword, ready } from './helpers';

// Roda depois das fases anteriores (mesmo servidor e banco): as instituições demo já estão conectadas.
test.describe.configure({ mode: 'serial' });

test('assistente responde consultando os dados e guarda a conversa', async ({ page }) => {
  await loginWithPassword(page);
  await page.goto('/assistente');
  await ready(page);
  const chat = page.getByRole('region', { name: 'Conversa com o assistente' });

  await chat.getByRole('button', { name: 'Quanto gastei este mês?' }).click();
  const first = chat.locator('[data-role="answer"]').first();
  await expect(first).toContainText('Somando gastos por categoria');
  await expect(first).toContainText(/Onde você mais gastou|Não encontrei gastos/);
  await expect(page).toHaveURL(/\/assistente\?c=/);

  await chat.getByLabel('Sua pergunta').fill('Qual é o meu saldo?');
  await chat.getByLabel('Sua pergunta').press('Enter');
  await expect(chat.locator('[data-role="answer"]').nth(1)).toContainText('Saldo em conta');

  await page.reload();
  await expect(chat.getByText('Qual é o meu saldo?')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Conversas' })).toContainText(
    'Quanto gastei este mês?',
  );

  await page.getByRole('button', { name: 'Apagar esta conversa' }).click();
  await page.waitForURL((u) => u.pathname === '/assistente' && !u.search);
  await expect(page.getByRole('region', { name: 'Conversas' })).not.toContainText(
    'Quanto gastei este mês?',
  );
});
