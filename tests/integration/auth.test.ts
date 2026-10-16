import { eq } from 'drizzle-orm';
import { TOTP, Secret } from 'otpauth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { checkAllowed, recordAttempt } from '@/server/auth/rate-limit';
import {
  createSession,
  listActiveSessions,
  lockSession,
  revokeOtherSessions,
  unlockSession,
  validateSessionToken,
} from '@/server/auth/session';
import {
  consumeRecoveryCode,
  enableTotp,
  newTotpSecret,
  regenerateRecoveryCodes,
  verifyTotpForUser,
} from '@/server/auth/totp';
import { schema, type Db } from '@/server/db/client';
import { decrypt } from '@/server/security/crypto';
import { createTestDb } from './helpers/db';

let db: Db;
let close: () => Promise<void>;
let userId: string;
const client = { userAgent: 'vitest', ipPrefix: '10.0.0.0/24' };

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const [u] = await db
    .insert(schema.appUser)
    .values({
      email: 'eu@example.com',
      passwordHash: await hashPassword('Senha-Forte-123'),
      settings: { lockTimeoutMinutes: 5 },
    })
    .returning();
  userId = u!.id;
});
afterEach(() => close());

describe('senha', () => {
  it('Argon2id verifica a correta e rejeita a errada', async () => {
    const h = await hashPassword('Correta-Cavalo-9');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(h, 'Correta-Cavalo-9')).toBe(true);
    expect(await verifyPassword(h, 'errada')).toBe(false);
  });
});

describe('sessões', () => {
  it('cria, valida e guarda só o hash do token', async () => {
    const s = await createSession(userId, client);
    const state = await validateSessionToken(s.token);
    expect(state).toMatchObject({
      locked: false,
      stepUpFresh: true,
      user: { email: 'eu@example.com' },
    });
    const rows = await db.select().from(schema.session);
    expect(rows[0]!.tokenHash).not.toBe(s.token);
    expect(await validateSessionToken('token-invalido')).toBeNull();
  });

  it('bloqueia por inatividade e desbloqueia', async () => {
    const s = await createSession(userId, client);
    const later = new Date(Date.now() + 6 * 60_000);
    expect((await validateSessionToken(s.token, later))!.locked).toBe(true);
    await lockSession(s.sessionId);
    expect((await validateSessionToken(s.token))!.locked).toBe(true);
    await unlockSession(s.sessionId, 5);
    expect((await validateSessionToken(s.token))!.locked).toBe(false);
  });

  it('uso contínuo estende o desbloqueio (inatividade conta do último uso)', async () => {
    const s = await createSession(userId, client);
    const t1 = new Date(Date.now() + 4 * 60_000);
    expect((await validateSessionToken(s.token, t1))!.locked).toBe(false); // estende até t1 + 5 min
    const t2 = new Date(Date.now() + 8 * 60_000);
    expect((await validateSessionToken(s.token, t2))!.locked).toBe(false);
  });

  it('reautenticação expira em 5 minutos', async () => {
    const s = await createSession(userId, client);
    expect(
      (await validateSessionToken(s.token, new Date(Date.now() + 2 * 60_000)))!.stepUpFresh,
    ).toBe(true);
    expect(
      (await validateSessionToken(s.token, new Date(Date.now() + 6 * 60_000)))!.stepUpFresh,
    ).toBe(false);
  });

  it('sessões independentes por dispositivo; encerrar as outras', async () => {
    const phone = await createSession(userId, { userAgent: 'Android', ipPrefix: null });
    const pc = await createSession(userId, { userAgent: 'Windows', ipPrefix: null });
    expect(await listActiveSessions(userId)).toHaveLength(2);
    await revokeOtherSessions(pc.sessionId, userId);
    expect(await validateSessionToken(phone.token)).toBeNull();
    expect(await validateSessionToken(pc.token)).not.toBeNull();
  });

  it('sessão expirada é rejeitada', async () => {
    const s = await createSession(userId, client);
    expect(await validateSessionToken(s.token, new Date(Date.now() + 31 * 86_400_000))).toBeNull();
  });
});

describe('limite de tentativas', () => {
  const ids = { account: 'login:eu@example.com', ip: 'ip:10.0.0.1' };
  it('bloqueia após 5 falhas e libera depois de um sucesso', async () => {
    for (let i = 0; i < 4; i++) await recordAttempt(ids, false);
    expect((await checkAllowed(ids)).allowed).toBe(true);
    await recordAttempt(ids, false);
    const r = await checkAllowed(ids);
    expect(r.allowed).toBe(false);
    await recordAttempt(ids, true);
    expect((await checkAllowed(ids)).allowed).toBe(true);
  });
});

describe('TOTP e códigos de recuperação', () => {
  it('aceita o código atual uma única vez (anti-replay)', async () => {
    const { secret } = newTotpSecret('eu@example.com');
    await enableTotp(userId, secret);
    const [u] = await db.select().from(schema.appUser).where(eq(schema.appUser.id, userId));
    expect(u!.totpSecretEnc).not.toContain(secret);
    expect(decrypt(u!.totpSecretEnc!)).toBe(secret);

    const code = new TOTP({ secret: Secret.fromBase32(secret) }).generate();
    expect(await verifyTotpForUser(userId, code)).toBe(true);
    expect(await verifyTotpForUser(userId, code)).toBe(false);
    expect(await verifyTotpForUser(userId, '000000')).toBe(false);
  });

  it('código de recuperação vale uma vez', async () => {
    const codes = await regenerateRecoveryCodes(userId);
    expect(codes).toHaveLength(10);
    expect(codes[0]).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(await consumeRecoveryCode(userId, codes[0]!.toLowerCase())).toBe(true);
    expect(await consumeRecoveryCode(userId, codes[0]!)).toBe(false);
  });
});
