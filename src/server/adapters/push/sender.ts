import 'server-only';
import webpush from 'web-push';
import { env } from '@/lib/env';

export type PushTarget = { endpoint: string; p256dh: string; auth: string };
export type PushMessage = { title: string; body: string; url: string; tag: string };
/** `gone` = inscrição expirou/foi revogada (404/410): apagar. */
export type PushResult = { ok: true } | { ok: false; gone: boolean; error: string };

export interface PushSender {
  readonly enabled: boolean;
  send(to: PushTarget, msg: PushMessage): Promise<PushResult>;
}

class WebPushSender implements PushSender {
  readonly enabled = true;
  constructor(publicKey: string, privateKey: string, subject: string) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  }
  async send(to: PushTarget, msg: PushMessage): Promise<PushResult> {
    try {
      await webpush.sendNotification(
        { endpoint: to.endpoint, keys: { p256dh: to.p256dh, auth: to.auth } },
        JSON.stringify(msg),
        { TTL: 60 * 60 * 24, urgency: 'normal', timeout: 10_000 },
      );
      return { ok: true };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      return { ok: false, gone: status === 404 || status === 410, error: String(status ?? e) };
    }
  }
}

/** Para testes e E2E: guarda o que seria enviado. */
export class FakePushSender implements PushSender {
  readonly enabled = true;
  sent: { to: string; msg: PushMessage }[] = [];
  gone = new Set<string>();
  async send(to: PushTarget, msg: PushMessage): Promise<PushResult> {
    if (this.gone.has(to.endpoint)) return { ok: false, gone: true, error: '410' };
    this.sent.push({ to: to.endpoint, msg });
    return { ok: true };
  }
}

const disabled: PushSender = {
  enabled: false,
  send: async () => ({ ok: false, gone: false, error: 'push desativado' }),
};

let override: PushSender | undefined;
let real: PushSender | undefined;
const fake = new FakePushSender();

export function setPushForTests(s: PushSender | undefined) {
  override = s;
}

export function getPushSender(): PushSender {
  if (override) return override;
  const e = env();
  if (e.PUSH_FAKE) return fake;
  if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY) return disabled;
  real ??= new WebPushSender(
    e.VAPID_PUBLIC_KEY,
    e.VAPID_PRIVATE_KEY,
    e.VAPID_SUBJECT || 'mailto:alertas@lastfinance.app',
  );
  return real;
}

/** Chave pública que o navegador usa para se inscrever (null = push indisponível). */
export function vapidPublicKey(): string | null {
  const e = env();
  if (e.PUSH_FAKE)
    return 'BFakeKeyForE2E_______________________________________________________________________';
  return e.VAPID_PUBLIC_KEY || null;
}
