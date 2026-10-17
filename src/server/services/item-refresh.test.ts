import { describe, expect, it } from 'vitest';
import { dueForRefresh } from './item-refresh';

const now = new Date('2026-10-18T08:00:00Z');
const itau = { connectorId: 201, connectorName: 'Itaú' };
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

describe('dueForRefresh', () => {
  it('pede atualização só de itens parados há 20 h ou mais', () => {
    expect(
      dueForRefresh(
        [
          { pluggyItemId: 'velho', ...itau, status: 'UPDATED', pluggyLastUpdatedAt: hoursAgo(26) },
          { pluggyItemId: 'recente', ...itau, status: 'UPDATED', pluggyLastUpdatedAt: hoursAgo(3) },
          { pluggyItemId: 'nunca', ...itau, status: 'OUTDATED', pluggyLastUpdatedAt: null },
        ],
        now,
      ),
    ).toEqual(['velho', 'nunca']);
  });

  it('pula itens atualizando ou que dependem de reconexão', () => {
    expect(
      dueForRefresh(
        ['UPDATING', 'LOGIN_ERROR', 'WAITING_USER_INPUT'].map((status) => ({
          pluggyItemId: status,
          ...itau,
          status,
          pluggyLastUpdatedAt: hoursAgo(48),
        })),
        now,
      ),
    ).toEqual([]);
  });

  it('pula itens MeuPluggy, que a Pluggy não deixa atualizar', () => {
    expect(
      dueForRefresh(
        [
          {
            pluggyItemId: 'meu',
            connectorId: 200,
            connectorName: 'Nubank',
            status: 'UPDATED',
            pluggyLastUpdatedAt: hoursAgo(48),
          },
        ],
        now,
      ),
    ).toEqual([]);
  });
});
