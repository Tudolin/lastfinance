import { expect, test } from '@playwright/test';
import { loginWithPassword } from './helpers';

test('celular: barra inferior e telas principais', async ({ page }) => {
  await loginWithPassword(page);
  const nav = page.getByRole('navigation', { name: 'Navegação' });
  await expect(nav).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Menu principal' })).toBeHidden();
  await nav.getByRole('link', { name: 'Transações' }).click();
  await expect(page).toHaveURL(/\/transacoes/);
  await nav.getByRole('link', { name: 'Mais' }).click();
  await expect(page.getByRole('link', { name: 'Contas conectadas' })).toBeVisible();
  // sem rolagem horizontal
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
