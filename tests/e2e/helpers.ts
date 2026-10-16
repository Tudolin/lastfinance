import type { Page } from '@playwright/test';

export const USER = { email: 'eu@example.com', password: 'Correta-Cavalo-Bateria-42' };

/** Autenticador WebAuthn virtual do Chromium: simula a digital (verificação do usuário sempre ok). */
export async function addVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

/** Espera o React hidratar a página (antes disso, interações podem ser desfeitas pela hidratação). */
export async function ready(page: Page) {
  await page.locator('html[data-hydrated="true"]').waitFor({ state: 'attached' });
}

export async function loginWithPassword(page: Page) {
  await page.goto('/login');
  await ready(page);
  await page.getByLabel('E-mail').fill(USER.email);
  await page.getByLabel('Senha', { exact: true }).fill(USER.password);
  await page.getByRole('button', { name: 'Entrar com senha' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}
