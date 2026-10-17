import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { todaySP } from '@/domain/dates/local-date';
import { setAiForTests } from '@/server/adapters/ai/client';
import { FakeAiGateway } from '@/server/adapters/ai/fake';
import { setPluggyForTests } from '@/server/adapters/pluggy/client';
import { FakePluggy } from '@/server/adapters/pluggy/fake';
import { FakePushSender, setPushForTests } from '@/server/adapters/push/sender';
import { parseSettings } from '@/server/auth/settings';
import { runAsSystem } from '@/server/auth/system';
import { schema, type Db } from '@/server/db/client';
import { inlineStep } from '@/server/jobs/step';
import { detectAlerts, evaluateAlerts } from '@/server/services/alerts';
import { runItemSync } from '@/server/services/item-sync';
import { createTestDb } from './helpers/db';

// sem sessão: os alertas rodam como sistema (runAsSystem), não pelo cookie
vi.mock('@/server/auth/request', async () => {
  const { systemSession } = await import('@/server/auth/system');
  return {
    requireUnlocked: async () => {
      const s = systemSession();
      if (!s) throw new Error('sem sessão');
      return s;
    },
    requireSession: async () => systemSession(),
  };
});

let db: Db;
let close: () => Promise<void>;
let push: FakePushSender;

// meio-dia em São Paulo (fora do silêncio padrão 22h–7h)
const NOON = new Date(`${todaySP()}T15:00:00Z`);
const NIGHT = new Date(`${todaySP()}T04:00:00Z`);

async function setSettings(patch: Record<string, unknown>) {
  const [u] = await db.select().from(schema.appUser);
  if (u)
    await db
      .update(schema.appUser)
      .set({ settings: { ...parseSettings(u.settings), ...patch } })
      .where(eq(schema.appUser.id, u.id));
  else
    await db.insert(schema.appUser).values({
      email: 'eu@example.com',
      passwordHash: 'x',
      settings: { ...parseSettings({}), ...patch },
    } as typeof schema.appUser.$inferInsert);
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const pluggy = new FakePluggy(todaySP());
  pluggy.seedInstitution('itau');
  pluggy.seedInstitution('nubank');
  setPluggyForTests(pluggy);
  setAiForTests(new FakeAiGateway());
  for (const id of ['fake-item-itau', 'fake-item-nubank'])
    await runItemSync(inlineStep, {
      pluggyItemId: id,
      mode: 'backfill',
      trigger: 'manual',
      runId: id,
    });
  push = new FakePushSender();
  setPushForTests(push);
  await db.insert(schema.pushSubscription).values({
    endpoint: 'https://push.example/celular',
    p256dh: 'p256dh-key-xx',
    auth: 'auth-key',
  });
});

afterEach(async () => {
  setPluggyForTests(undefined);
  setAiForTests(undefined);
  setPushForTests(undefined);
  await close();
});

describe('alertas', () => {
  it('detecta gasto grande pelo limite das preferências e não repete', async () => {
    await setSettings({ alertLargeExpenseCents: 100 });
    const first = await evaluateAlerts(NOON);
    expect(first.created).toBeGreaterThan(0);
    const rows = await db.select().from(schema.alertEvent);
    expect(rows.some((r) => r.type === 'large_expense')).toBe(true);
    expect(push.sent.length).toBe(Math.min(20, rows.length));
    expect(push.sent[0]!.msg.url).toMatch(/^\//);

    const again = await evaluateAlerts(NOON);
    expect(again.created).toBe(0);
    expect(push.sent.length).toBe(Math.min(20, rows.length));
  });

  it('tipos desligados não geram alerta', async () => {
    await setSettings({ alertLargeExpenseCents: 100, alertsOff: ['large_expense'] });
    const found = await runAsSystem(() => detectAlerts());
    expect(found.some((a) => a.type === 'large_expense')).toBe(false);
  });

  it('no horário de silêncio guarda e envia depois', async () => {
    await setSettings({ alertLargeExpenseCents: 100 });
    const night = await evaluateAlerts(NIGHT);
    expect(night.quiet).toBe(true);
    expect(push.sent).toHaveLength(0);
    const pending = await db.select().from(schema.alertEvent);
    expect(pending.every((a) => a.sentAt === null)).toBe(true);

    const morning = await evaluateAlerts(NOON);
    expect(morning.sent).toBeGreaterThan(0);
  });

  it('apaga a inscrição que o navegador revogou', async () => {
    await setSettings({ alertLargeExpenseCents: 100 });
    push.gone.add('https://push.example/celular');
    await evaluateAlerts(NOON);
    expect(await db.select().from(schema.pushSubscription)).toHaveLength(0);
    // o alerta continua na caixa de entrada
    expect((await db.select().from(schema.alertEvent)).length).toBeGreaterThan(0);
  });

  it('avisa conexão com erro', async () => {
    await db
      .update(schema.institutionConnection)
      .set({ status: 'LOGIN_ERROR' })
      .where(eq(schema.institutionConnection.pluggyItemId, 'fake-item-itau'));
    const found = await runAsSystem(() => detectAlerts());
    expect(found.find((a) => a.type === 'connection_error')?.url).toBe('/contas');
  });
});
