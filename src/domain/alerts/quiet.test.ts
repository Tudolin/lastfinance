import { describe, expect, it } from 'vitest';
import { hourSP, isQuietHour } from './quiet';

describe('horário de silêncio', () => {
  it('atravessa a meia-noite', () => {
    expect(isQuietHour(22, 22, 7)).toBe(true);
    expect(isQuietHour(3, 22, 7)).toBe(true);
    expect(isQuietHour(7, 22, 7)).toBe(false);
    expect(isQuietHour(12, 22, 7)).toBe(false);
  });
  it('no mesmo dia e desligado', () => {
    expect(isQuietHour(13, 12, 14)).toBe(true);
    expect(isQuietHour(14, 12, 14)).toBe(false);
    expect(isQuietHour(5, 0, 0)).toBe(false);
  });
  it('usa o fuso de São Paulo', () => {
    expect(hourSP(new Date('2026-10-17T02:30:00Z'))).toBe(23);
    expect(hourSP(new Date('2026-10-17T15:00:00Z'))).toBe(12);
  });
});
