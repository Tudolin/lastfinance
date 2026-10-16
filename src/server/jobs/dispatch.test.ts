import { describe, expect, it } from 'vitest';
import { DispatchError, dispatchReason } from './dispatch';

describe('dispatchReason', () => {
  it('chave recusada pelo Inngest', () => {
    const r = dispatchReason(new Error('Inngest API Error: 401 Event key Not Found'));
    expect(r).toMatchObject({ code: 'event_key_rejected', status: 401 });
    expect(r.fix).toContain('INNGEST_EVENT_KEY');
  });

  it('deploy sem chave', () => {
    const r = dispatchReason(
      new Error("Failed to send event: We couldn't find an event key to use to send events"),
    );
    expect(r.code).toBe('event_key_missing');
  });

  it('limite, rede e desconhecido', () => {
    expect(dispatchReason(new Error('Inngest API Error: 429 slow down')).code).toBe('rate_limited');
    expect(dispatchReason(new Error('Inngest API Error: 500 Internal server error'))).toMatchObject(
      { code: 'api_error', status: 500 },
    );
    expect(dispatchReason(new TypeError('fetch failed')).code).toBe('network');
    expect(dispatchReason('x').code).toBe('unknown');
  });

  it('a mensagem para a tela traz o motivo, nunca a mensagem original', () => {
    const e = new DispatchError(new Error('Inngest API Error: 401 segredo-123'));
    expect(e.help).toContain('HTTP 401');
    expect(e.help).not.toContain('segredo-123');
  });
});
