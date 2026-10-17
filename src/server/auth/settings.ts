import { z } from 'zod';

export const userSettingsSchema = z.object({
  /** Minutos sem uso até o app bloquear e pedir digital/senha. */
  lockTimeoutMinutes: z.number().int().min(1).max(240).default(5),
  /** Validade da sessão em dias (cada dispositivo tem a sua). */
  sessionDays: z.number().int().min(1).max(90).default(30),
  /** Ao voltar para o app depois de N segundos em segundo plano, bloqueia de novo. */
  relockAfterBackgroundSeconds: z.number().int().min(0).max(3600).default(60),
  /** Meta de taxa de poupança (% da receita). */
  savingsGoalPct: z.number().min(0).max(100).default(25),
  /** Teto de gasto mensal com IA (US$). Ao atingir, a categorização usa só regras e cache. */
  aiMonthlyBudgetUsd: z.number().min(0).max(1000).default(5),
  /** Abaixo desta confiança, a categoria sugerida pela IA vai para a fila de revisão. */
  aiReviewThreshold: z.number().min(0).max(1).default(0.7),
  /** Reserva mínima: abaixo dela, "Posso gastar?" avisa (centavos). */
  reserveMinCents: z.number().int().min(0).max(100_000_000).default(50000),
  /** Como estimar o gasto variável na previsão: média de 3 ou 6 meses, ou pelos orçamentos. */
  forecastVariableMode: z.enum(['avg3', 'avg6', 'budget']).default('avg3'),
  /** Reserva de emergência: quantos meses de gastos essenciais guardar. */
  emergencyMonths: z.number().int().min(1).max(24).default(6),
  /** Anti-replay do TOTP: último contador aceito. */
  totpLastCounter: z.number().int().optional(),
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

export function parseSettings(raw: unknown): UserSettings {
  return userSettingsSchema.parse(raw ?? {});
}
