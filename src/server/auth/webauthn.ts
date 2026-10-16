import 'server-only';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { and, eq } from 'drizzle-orm';
import { env } from '@/lib/env';
import { getDb, schema } from '@/server/db/client';
import { consumeChallenge, createChallenge } from './challenge';

const { webauthnCredential, appUser } = schema;

/** rpID = domínio da APP_URL. Passkeys valem só nesse domínio (em previews da Vercel, use a senha). */
export function relyingParty() {
  const url = new URL(env().appUrl);
  return { rpID: url.hostname, origin: url.origin, rpName: 'lastfinance' };
}

export async function registrationOptions(userId: string) {
  const db = getDb();
  const [user] = await db.select().from(appUser).where(eq(appUser.id, userId));
  if (!user) throw new Error('Usuário não encontrado');
  const existing = await db
    .select()
    .from(webauthnCredential)
    .where(eq(webauthnCredential.userId, userId));
  const rp = relyingParty();
  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: user.email,
    userDisplayName: user.email,
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: c.transports })),
    // Passkey "descobrível" + verificação do usuário (digital/rosto/PIN do aparelho).
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  const challengeId = await createChallenge('webauthn_register', options.challenge, userId);
  return { challengeId, options };
}

export async function verifyRegistration(
  userId: string,
  challengeId: string,
  response: RegistrationResponseJSON,
  deviceName: string,
) {
  const ch = await consumeChallenge(challengeId, 'webauthn_register');
  if (!ch || ch.userId !== userId) throw new Error('Desafio inválido ou expirado');
  const rp = relyingParty();
  const v = await verifyRegistrationResponse({
    response,
    expectedChallenge: ch.challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: true,
  });
  if (!v.verified) throw new Error('Não foi possível verificar a passkey');
  const { credential, credentialBackedUp } = v.registrationInfo;
  await getDb()
    .insert(webauthnCredential)
    .values({
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      deviceName: deviceName.slice(0, 60) || 'Dispositivo',
      backedUp: credentialBackedUp,
    });
}

export async function authenticationOptions(
  purpose: 'webauthn_login' | 'webauthn_stepup',
  userId: string | null,
) {
  const db = getDb();
  const creds = userId
    ? await db.select().from(webauthnCredential).where(eq(webauthnCredential.userId, userId))
    : [];
  const options = await generateAuthenticationOptions({
    rpID: relyingParty().rpID,
    userVerification: 'required',
    // Login: vazio → o aparelho oferece as passkeys descobríveis. Step-up: só as do usuário logado.
    ...(userId
      ? { allowCredentials: creds.map((c) => ({ id: c.credentialId, transports: c.transports })) }
      : {}),
  });
  const challengeId = await createChallenge(purpose, options.challenge, userId);
  return { challengeId, options };
}

/** Verifica a assinatura e devolve o id do usuário dono da passkey. */
export async function verifyAuthentication(
  purpose: 'webauthn_login' | 'webauthn_stepup',
  challengeId: string,
  response: AuthenticationResponseJSON,
): Promise<string> {
  const ch = await consumeChallenge(challengeId, purpose);
  if (!ch) throw new Error('Desafio inválido ou expirado');
  const db = getDb();
  const [cred] = await db
    .select()
    .from(webauthnCredential)
    .where(eq(webauthnCredential.credentialId, response.id));
  if (!cred) throw new Error('Passkey não reconhecida');
  if (ch.userId && ch.userId !== cred.userId) throw new Error('Passkey de outro usuário');
  const rp = relyingParty();
  const v = await verifyAuthenticationResponse({
    response,
    expectedChallenge: ch.challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: true,
    credential: {
      id: cred.credentialId,
      publicKey: new Uint8Array(cred.publicKey),
      counter: cred.counter,
      transports: cred.transports,
    },
  });
  if (!v.verified) throw new Error('Assinatura inválida');
  await db
    .update(webauthnCredential)
    .set({ counter: v.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(webauthnCredential.id, cred.id));
  return cred.userId;
}

export async function listPasskeys(userId: string) {
  return getDb()
    .select({
      id: webauthnCredential.id,
      deviceName: webauthnCredential.deviceName,
      createdAt: webauthnCredential.createdAt,
      lastUsedAt: webauthnCredential.lastUsedAt,
      backedUp: webauthnCredential.backedUp,
    })
    .from(webauthnCredential)
    .where(eq(webauthnCredential.userId, userId));
}

export async function deletePasskey(userId: string, id: string) {
  await getDb()
    .delete(webauthnCredential)
    .where(and(eq(webauthnCredential.id, id), eq(webauthnCredential.userId, userId)));
}
