import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  DATABASE_URL_UNPOOLED: z.string().url().optional(),
  APP_URL: z.string().url().optional(),
  VERCEL_URL: z.string().optional(),
  VERCEL_ENV: z.enum(['production', 'preview', 'development']).optional(),
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET precisa de pelo menos 32 caracteres'),
  DATA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'DATA_ENCRYPTION_KEY: 32 bytes em base64'),
  SETUP_TOKEN: z.string().min(16).optional(),

  PLUGGY_CLIENT_ID: z.string().optional(),
  PLUGGY_CLIENT_SECRET: z.string().optional(),
  PLUGGY_WEBHOOK_SECRET: z.string().min(24).optional(),
  PLUGGY_WEBHOOK_IP_ALLOWLIST: z.string().optional(),
  PLUGGY_FAKE: bool,

  JOBS_MODE: z.enum(['inngest', 'inline']).default('inngest'),
  CRON_SECRET: z.string().min(16).optional(),
});

export type Env = z.infer<typeof schema> & { appUrl: string };

let cached: Env | undefined;

/** Lê e valida as variáveis de ambiente (memoizado). Lança erro descritivo se algo estiver faltando. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  const e = parsed.data;
  const appUrl =
    e.APP_URL ??
    (e.VERCEL_ENV === 'production' && e.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${e.VERCEL_PROJECT_PRODUCTION_URL}`
      : e.VERCEL_URL
        ? `https://${e.VERCEL_URL}`
        : 'http://localhost:3000');
  cached = { ...e, appUrl: appUrl.replace(/\/$/, '') };
  return cached;
}

/** Apenas para testes. */
export function resetEnvCache(): void {
  cached = undefined;
}
