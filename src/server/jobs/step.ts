/**
 * Abstração mínima de "passo durável". No Inngest, cada `run` é memoizado e reexecutado com retry
 * isoladamente; no modo inline (dev/testes) apenas executa. O retorno precisa ser serializável em JSON.
 */
export interface JobStep {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
}

export const inlineStep: JobStep = {
  run: (_id, fn) => fn(),
};
