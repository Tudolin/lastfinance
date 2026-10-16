import 'server-only';

/**
 * Logger estruturado com lista de campos PERMITIDOS: qualquer outro campo é descartado.
 * Garante por construção que valores, descrições e documentos não vão parar nos logs.
 */
const ALLOWED = new Set([
  'event',
  'eventId',
  'itemId',
  'connectionId',
  'accountId',
  'runId',
  'job',
  'trigger',
  'mode',
  'count',
  'inserted',
  'updated',
  'deleted',
  'pages',
  'status',
  'code',
  'durationMs',
  'page',
  'attempt',
]);

type Fields = Record<string, unknown>;

function clean(fields: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) if (ALLOWED.has(k)) out[k] = v;
  return out;
}

function write(level: 'info' | 'warn' | 'error', msg: string, fields: Fields = {}) {
  if (process.env.NODE_ENV === 'test') return;
  const line = JSON.stringify({ level, msg, at: new Date().toISOString(), ...clean(fields) });
  if (level === 'info') process.stdout.write(`${line}\n`);
  else if (level === 'warn') console.warn(line);
  else console.error(line);
}

export const log = {
  info: (msg: string, f?: Fields) => write('info', msg, f),
  warn: (msg: string, f?: Fields) => write('warn', msg, f),
  /** Para erros, registra apenas nome e código — mensagens de terceiros podem conter dados. */
  error: (msg: string, err: unknown, f?: Fields) =>
    write('error', msg, {
      ...f,
      code: (err as { code?: string; name?: string })?.code ?? (err as Error)?.name,
    }),
};
