import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z
  .object({
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
      .refine(
        (v) => Buffer.from(v, 'base64').length === 32,
        'DATA_ENCRYPTION_KEY: 32 bytes em base64',
      ),
    SETUP_TOKEN: z.string().min(16).optional(),

    PLUGGY_CLIENT_ID: z.string().optional(),
    PLUGGY_CLIENT_SECRET: z.string().optional(),
    PLUGGY_WEBHOOK_SECRET: z.string().min(24).optional(),
    PLUGGY_WEBHOOK_IP_ALLOWLIST: z.string().optional(),
    PLUGGY_FAKE: bool,

    ANTHROPIC_API_KEY: z.string().optional(),
    /** Modelo padrão da camada de IA. */
    AI_MODEL: z.string().default('claude-haiku-5-5'),
    /** Modelo do assistente (chat com ferramentas). */
    AGENT_MODEL: z.string().default('claude-opus-5-5'),
    /** Teto de gasto mensal do assistente, em dólares. */
    AGENT_MONTHLY_BUDGET_USD: z.coerce.number().nonnegative().default(10),
    /** true = IA falsa e determinística (dev/testes, sem custo). */
    AI_FAKE: bool,

    /** Web Push (alertas no celular). Sem as chaves, os alertas ficam só na tela de Alertas. */
    VAPID_PUBLIC_KEY: z.string().trim().optional(),
    VAPID_PRIVATE_KEY: z.string().trim().optional(),
    VAPID_SUBJECT: z.string().trim().optional(),
    PUSH_FAKE: bool,

    JOBS_MODE: z.enum(['inngest', 'inline']).default('inngest'),
    INNGEST_EVENT_KEY: z.string().optional(),
    INNGEST_SIGNING_KEY: z.string().optional(),
    CRON_SECRET: z.string().min(16).optional(),
  })
  // Em produção na Vercel a fila é o Inngest: sem as chaves, importar/sincronizar falharia.
  .superRefine((e, ctx) => {
    if (e.VERCEL_ENV !== 'production' || e.JOBS_MODE !== 'inngest') return;
    for (const k of ['INNGEST_EVENT_KEY', 'INNGEST_SIGNING_KEY'] as const)
      if (!e[k]) ctx.addIssue({ code: 'custom', path: [k], message: 'obrigatória em produção' });
  });

export type Env = z.infer<typeof schema> & { appUrl: string };

let cached: Env | undefined;

const HINTS: Record<string, string> = {
  DATABASE_URL: 'conecte o Neon em Storage (cria DATABASE_URL e DATABASE_URL_UNPOOLED)',
  SESSION_SECRET: 'gere com: openssl rand -base64 48',
  DATA_ENCRYPTION_KEY: 'gere com: openssl rand -base64 32 (cole exatamente, sem espaços)',
  SETUP_TOKEN: 'gere com: openssl rand -hex 16',
  CRON_SECRET: 'gere com: openssl rand -hex 16',
  PLUGGY_WEBHOOK_SECRET: 'gere com: openssl rand -hex 32',
  INNGEST_EVENT_KEY: 'conecte a integração Inngest em Integrations (cria as duas chaves)',
  INNGEST_SIGNING_KEY: 'conecte a integração Inngest em Integrations (cria as duas chaves)',
};

/** Lista os problemas das variáveis (nome + regra + dica), sem nunca incluir os valores. */
export function checkEnv(source: Record<string, string | undefined>): string[] {
  const parsed = schema.safeParse(source);
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => {
    const name = i.path.join('.');
    const missing = source[name] == null || source[name] === '';
    const hint = HINTS[name] ? ` — ${HINTS[name]}` : '';
    return `${name}: ${missing ? 'não definida' : i.message}${hint}`;
  });
}

/** Lê e valida as variáveis de ambiente (memoizado). Lança erro descritivo se algo estiver faltando. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = checkEnv(process.env)
      .map((p) => `  - ${p}`)
      .join('\n');
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
