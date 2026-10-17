import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ymd } from '@/domain/dates/local-date';
import { resetEnvCache } from '@/lib/env';
import { setPluggyForTests } from '@/server/adapters/pluggy/client';
import { FakePluggy } from '@/server/adapters/pluggy/fake';
import { getWebhookStatus, registerWebhook } from './pluggy-webhook';
import { WEBHOOK_SECRET_HEADER } from './webhook-auth';

const ENV = {
  DATABASE_URL: 'postgres://u:p@host/db',
  SESSION_SECRET: 'x'.repeat(40),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  APP_URL: 'https://app.example',
  PLUGGY_WEBHOOK_SECRET: 's'.repeat(32),
};

describe('webhook da Pluggy', () => {
  let fake: FakePluggy;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    resetEnvCache();
    fake = new FakePluggy(ymd(2026, 10, 17));
    setPluggyForTests(fake);
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetEnvCache();
    setPluggyForTests(undefined);
  });

  it('aponta que não há webhook registrado', async () => {
    expect(await getWebhookStatus()).toEqual({
      expectedUrl: 'https://app.example/api/webhooks/pluggy',
      registered: false,
      others: [],
      secretSet: true,
    });
  });

  it('substitui webhooks antigos deste app e envia o header secreto', async () => {
    await fake.createWebhook('https://velho.ngrok.app/api/webhooks/pluggy', {});
    await fake.createWebhook('https://outro-sistema.example/hook', {});

    const status = await registerWebhook();

    expect(status).toMatchObject({ registered: true, others: [] });
    expect(fake.webhooks.map((w) => w.url)).toEqual([
      'https://outro-sistema.example/hook',
      'https://app.example/api/webhooks/pluggy',
    ]);
    expect(fake.webhooks[1]?.headers).toEqual({
      [WEBHOOK_SECRET_HEADER]: ENV.PLUGGY_WEBHOOK_SECRET,
    });
  });

  it('recusa registrar sem PLUGGY_WEBHOOK_SECRET', async () => {
    delete process.env.PLUGGY_WEBHOOK_SECRET;
    resetEnvCache();
    await expect(registerWebhook()).rejects.toThrow(/PLUGGY_WEBHOOK_SECRET/);
    expect(fake.webhooks).toEqual([]);
  });
});
