import { describe, expect, it } from 'vitest';
import { lockoutUntil } from './rate-limit';

describe('bloqueio progressivo', () => {
  const t = new Date('2026-10-16T12:00:00Z');
  it('libera abaixo de 5 falhas', () => expect(lockoutUntil(4, t)).toBeNull());
  it('15 min a partir de 5', () =>
    expect(lockoutUntil(5, t)!.toISOString()).toBe('2026-10-16T12:15:00.000Z'));
  it('dobra a cada 5 falhas extras', () => {
    expect(lockoutUntil(10, t)!.toISOString()).toBe('2026-10-16T12:30:00.000Z');
    expect(lockoutUntil(15, t)!.toISOString()).toBe('2026-10-16T13:00:00.000Z');
  });
  it('tem teto', () =>
    expect(lockoutUntil(500, t)!.getTime() - t.getTime()).toBe(15 * 64 * 60_000));
});
