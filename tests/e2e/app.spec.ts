import { expect, test } from '@playwright/test';
import { E2E_ENV } from '../../playwright.config';
import { addVirtualAuthenticator, loginWithPassword, ready, USER } from './helpers';

test.describe.configure({ mode: 'serial' });

test('primeiro acesso: setup, passkey, bloqueio e desbloqueio com digital', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);

  await page.getByLabel('Token de configuração').fill(E2E_ENV.SETUP_TOKEN);
  await page.getByLabel('E-mail').fill(USER.email);
  await page.getByLabel('Senha', { exact: true }).fill(USER.password);
  await page.getByLabel('Confirme a senha').fill(USER.password);
  await page.getByRole('button', { name: 'Criar acesso' }).click();

  await expect(page).toHaveURL(/\/configuracoes\/seguranca\?bemvindo=1/);
  await expect(page.getByText('Acesso criado!')).toBeVisible();
  await ready(page);

  const { cdp, authenticatorId } = await addVirtualAuthenticator(page);
  await page.getByRole('button', { name: /Ativar entrada com digital/ }).click();
  await expect(page.getByRole('button', { name: /Remover passkey/ })).toBeVisible();
  const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
  expect(credentials).toHaveLength(1);
  expect(credentials[0]!.isResidentCredential).toBe(true);

  // Bloquear: nenhum valor visível; a digital desbloqueia automaticamente.
  await page.goto('/');
  await ready(page);
  const toUnlock = page.waitForURL(/\/unlock/);
  await page.getByRole('button', { name: 'Bloquear o app' }).first().click();
  await toUnlock;
  await expect(page).toHaveURL(/\/$|\/\?/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: /Conecte suas contas/ })).toBeVisible();
});

test('sair e entrar só com a digital (passkey descobrível)', async ({ page }) => {
  await loginWithPassword(page);
  const { cdp, authenticatorId } = await addVirtualAuthenticator(page);
  // registra uma passkey neste "dispositivo" novo (o anterior tinha outro autenticador virtual)
  await page.goto('/configuracoes/seguranca');
  await ready(page);
  await page.getByRole('button', { name: /Ativar entrada com digital/ }).click();
  await expect(page.getByRole('button', { name: /Remover passkey/ })).toHaveCount(2);
  expect((await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials).toHaveLength(
    1,
  );

  await page.goto('/configuracoes');
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await ready(page);
  await page.getByRole('button', { name: /Entrar com digital/ }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('senha errada não entra e não vaza se o e-mail existe', async ({ page }) => {
  await page.goto('/login');
  await ready(page);
  await page.getByLabel('E-mail').fill('outro@example.com');
  await page.getByLabel('Senha').fill('qualquer-coisa-123');
  await page.getByRole('button', { name: 'Entrar com senha' }).click();
  await expect(page.getByText('E-mail ou senha incorretos.')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('conectar instituições, sincronizar e classificar', async ({ page }) => {
  await loginWithPassword(page);
  await page.goto('/contas');
  await ready(page);
  await page.getByRole('button', { name: 'Itaú (demo)' }).click();
  await expect(page.getByRole('heading', { name: 'Itaú', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Nubank (demo)' }).click();
  await expect(page.getByRole('heading', { name: 'Nubank', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('12 meses carregados').first()).toBeVisible();

  // Painel com dados reais
  await page.goto('/');
  await expect(page.getByText('Saldo em conta')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Últimas transações' })).toBeVisible();

  // Transferência entre contas próprias detectada
  await page.goto('/transacoes?kind=internal_transfer');
  await expect(page.getByText('PIX TRANSF ENVIADA NU PAGAMENTOS').first()).toBeVisible();
  await expect(page.getByText('não conta como gasto').first()).toBeVisible();

  // Pagamento de fatura nunca é despesa
  await page.goto('/transacoes?kind=expense&q=fatura');
  await expect(page.getByText('Nenhuma transação encontrada')).toBeVisible();

  // Parcelas
  await page.goto('/transacoes?q=NOTEBOOK');
  await expect(page.getByText('3/10').first()).toBeVisible();

  // Edição manual vira "definido por você"
  await page.goto('/transacoes?q=PADARIA');
  await page
    .getByRole('link', { name: /PADARIA SAO JORGE/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Editar' })).toBeVisible();
  await ready(page);
  await page.getByLabel('Tipo').selectOption('adjustment');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Salvo.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('definido por você')).toBeVisible();
});

test('modo ocultar valores', async ({ page }) => {
  await loginWithPassword(page);
  await page.goto('/');
  await ready(page);
  const saldo = page.locator('.money-value').first();
  await expect(saldo).toBeVisible();
  await page.getByRole('button', { name: 'Ocultar valores' }).first().click();
  await expect(saldo).toBeHidden();
  await expect(page.getByLabel('valor oculto').first()).toBeVisible();
  await page.getByRole('button', { name: 'Mostrar valores' }).first().click();
});

test('bloqueado não entrega nenhum valor do servidor', async ({ page }) => {
  await loginWithPassword(page);
  await ready(page);
  await page.getByRole('button', { name: 'Bloquear o app' }).first().click();
  await expect(page).toHaveURL(/\/unlock/);
  for (const path of ['/', '/transacoes', '/contas']) {
    const res = await page.request.get(path, { maxRedirects: 0 });
    expect([302, 303, 307, 200]).toContain(res.status());
    const html = await res.text();
    expect(html).not.toMatch(/R\$\s?\d/);
  }
});

test('webhook: header secreto obrigatório e idempotência', async ({ request }) => {
  const body = {
    event: 'connector/status_updated',
    eventId: 'e2e-evt-1',
    data: { status: 'ONLINE' },
  };
  expect((await request.post('/api/webhooks/pluggy', { data: body })).status()).toBe(401);
  const ok = await request.post('/api/webhooks/pluggy', {
    data: body,
    headers: { 'x-lastfinance-webhook-secret': E2E_ENV.PLUGGY_WEBHOOK_SECRET },
  });
  expect(ok.status()).toBe(200);
  const dup = await request.post('/api/webhooks/pluggy', {
    data: body,
    headers: { 'x-lastfinance-webhook-secret': E2E_ENV.PLUGGY_WEBHOOK_SECRET },
  });
  expect(await dup.json()).toMatchObject({ status: 'duplicate' });
});

test('PWA: manifest instalável e service worker', async ({ request }) => {
  const m = await (await request.get('/manifest.webmanifest')).json();
  expect(m).toMatchObject({ display: 'standalone', start_url: '/', lang: 'pt-BR' });
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  expect((await request.get('/sw.js')).status()).toBe(200);
  expect((await request.get('/icons/icon-512.png')).status()).toBe(200);
});
