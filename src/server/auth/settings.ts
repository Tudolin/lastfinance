import { z } from 'zod';

export const userSettingsSchema = z.object({
  /** Minutos sem uso até o app bloquear e pedir digital/senha. */
  lockTimeoutMinutes: z.number().int().min(1).max(240).default(5),
  /** Validade da sessão em dias (cada dispositivo tem a sua). */
  sessionDays: z.number().int().min(1).max(90).default(30),
  /** Ao voltar para o app depois de N segundos em segundo plano, bloqueia de novo. */
  relockAfterBackgroundSeconds: z.number().int().min(0).max(3600).default(60),
  /** Anti-replay do TOTP: último contador aceito. */
  totpLastCounter: z.number().int().optional(),
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

export function parseSettings(raw: unknown): UserSettings {
  return userSettingsSchema.parse(raw ?? {});
}
