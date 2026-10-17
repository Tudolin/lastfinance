import { expect, test } from '@playwright/test';
import { loginWithPassword, ready } from './helpers';

// Roda depois das fases anteriores (mesmo servidor e banco): as instituições demo já estão conectadas.
test.describe.configure({ mode: 'serial' });

test('alertas: preferências, verificação e caixa de entrada', async ({ page }) => {
  await loginWithPassword(page);
  await page.goto('/alertas');
  await ready(page);
  // sem chaves VAPID no E2E: a tela explica, mas a caixa de entrada funciona
  await expect(page.getByText('Notificações no celular')).toBeVisible();

  const prefs = page.getByRole('form', { name: 'Preferências de alertas' });
  await prefs.getByLabel('Gasto grande a partir de (R$)').fill('1');
  await prefs.getByRole('button', { name: 'Salvar preferências' }).click();
  await expect(prefs.getByText('Preferências salvas.')).toBeVisible();

  await page.getByRole('button', { name: 'Verificar agora' }).click();
  await expect(page.getByText(/alerta\(s\) novo\(s\)/)).toBeVisible();
  const rows = page.getByTestId('alert-row');
  await expect(rows.first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Caixa de alertas' })).toContainText('Gasto de');

  await page.getByRole('button', { name: 'Verificar agora' }).click();
  await expect(page.getByText('Nada novo por enquanto.')).toBeVisible();

  await page.getByRole('button', { name: 'Marcar todos como lidos' }).click();
  await expect(page.getByLabel('não lido')).toHaveCount(0);

  // volta o limite padrão para não poluir as próximas fases
  await prefs.getByLabel('Gasto grande a partir de (R$)').fill('500');
  await prefs.getByRole('button', { name: 'Salvar preferências' }).click();
  await expect(prefs.getByText('Preferências salvas.')).toBeVisible();
});
