import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { E2E_ENV } from '../../playwright.config';
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

test('celular estreito: nome longo de conta não alarga a página nem esconde conteúdo', async ({
  page,
}) => {
  const db = new Client({ connectionString: E2E_ENV.DATABASE_URL });
  await db.connect();
  const { rows } = await db.query<{ id: string; name: string }>(
    "select id, name from account where kind <> 'credit_card' order by name limit 1",
  );
  const acc = rows[0]!;
  // Nome como a Pluggy devolve para a conta pré-paga do Nubank.
  await db.query('update account set name = $1 where id = $2', [
    'Nu Pagamentos S.A. - Instituição de Pagamento (Conta Pré-paga)',
    acc.id,
  ]);
  try {
    await page.setViewportSize({ width: 360, height: 740 });
    await loginWithPassword(page);
    for (const path of ['/transacoes', '/previsao?dias=30', '/posso-gastar']) {
      await page.goto(path);
      const m = await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        const navEl = document.querySelector('nav[aria-label="Navegação"]')!;
        const nav = navEl.getBoundingClientRect();
        const content = navEl.previousElementSibling!.firstElementChild!.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          width: window.innerWidth,
          height: window.innerHeight,
          navTop: nav.top,
          navBottom: nav.bottom,
          contentBottom: content.bottom,
        };
      });
      expect(m.width, path).toBe(360);
      expect(m.overflow, path).toBeLessThanOrEqual(0);
      expect(m.navBottom, path).toBe(m.height);
      // rolando até o fim, o último conteúdo fica acima da barra
      expect(m.contentBottom, path).toBeLessThanOrEqual(m.navTop);
    }
  } finally {
    await db.query('update account set name = $1 where id = $2', [acc.name, acc.id]);
    await db.end();
  }
});
