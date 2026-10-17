import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { SessionState } from './session';

const store = new AsyncLocalStorage<SessionState>();

/**
 * Roda `fn` como o próprio sistema (jobs agendados, como os alertas), sem cookie de sessão: as
 * consultas protegidas por `requireUnlocked` funcionam dentro dela. Só código do servidor chama isto;
 * nenhuma rota usa.
 */
export function runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
  return store.run(
    {
      sessionId: 'system',
      user: { id: 'system', email: 'system', totpEnabled: false },
      locked: false,
      stepUpFresh: false,
      settings: {} as SessionState['settings'],
    },
    fn,
  );
}

export function systemSession(): SessionState | undefined {
  return store.getStore();
}
