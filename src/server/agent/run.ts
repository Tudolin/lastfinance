import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { costMicrosUsd } from '@/domain/ai/pricing';
import { startOfMonth, todaySP } from '@/domain/dates/local-date';
import { env } from '@/lib/env';
import { requireUnlocked } from '@/server/auth/request';
import { getDb, schema } from '@/server/db/client';
import { getAgentModel } from './model';
import { AGENT_SYSTEM_PROMPT, todayNote } from './prompt';
import { apiTools, runTool, toolLabel } from './tools';

const { chatConversation, chatMessage, aiUsageLog } = schema;

export const AGENT_FEATURE = 'assistant';
/** Limite de idas e voltas com ferramentas por pergunta (evita laço sem fim). */
const MAX_STEPS = 8;

export type AgentEvent =
  | { type: 'conversation'; id: string; title: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; label: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

type Param = Anthropic.Beta.BetaMessageParam;

export async function assistantSpendMicros() {
  const from = new Date(`${startOfMonth(todaySP())}T03:00:00Z`);
  const [r] = await getDb()
    .select({ total: sql<number>`coalesce(sum(${aiUsageLog.costMicrosUsd}), 0)::bigint` })
    .from(aiUsageLog)
    .where(and(eq(aiUsageLog.feature, AGENT_FEATURE), gte(aiUsageLog.at, from)));
  return Number(r?.total ?? 0);
}

function titleFrom(text: string) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

/** Uma pergunta do usuário → respostas da IA com ferramentas, tudo persistido na conversa. */
export async function runAgentTurn(opts: {
  conversationId: string | null;
  text: string;
  emit: (e: AgentEvent) => void;
  signal?: AbortSignal;
}) {
  await requireUnlocked();
  const { emit } = opts;
  const model = await getAgentModel();
  if (!model) {
    emit({
      type: 'error',
      message:
        'O assistente precisa da chave da Anthropic (ANTHROPIC_API_KEY) configurada no servidor.',
    });
    return;
  }
  const budget = env().AGENT_MONTHLY_BUDGET_USD;
  if ((await assistantSpendMicros()) >= budget * 1e6) {
    emit({
      type: 'error',
      message: `O assistente atingiu o teto de US$ ${budget.toFixed(2)} deste mês. Ele volta no dia 1º (ou aumente AGENT_MONTHLY_BUDGET_USD).`,
    });
    return;
  }

  const db = getDb();
  let conversationId = opts.conversationId;
  if (conversationId) {
    const [c] = await db
      .select({ id: chatConversation.id })
      .from(chatConversation)
      .where(eq(chatConversation.id, conversationId));
    if (!c) conversationId = null;
  }
  if (!conversationId) {
    const title = titleFrom(opts.text);
    const [c] = await db.insert(chatConversation).values({ title }).returning();
    conversationId = c!.id;
    emit({ type: 'conversation', id: conversationId, title });
  }

  const rows = await db
    .select()
    .from(chatMessage)
    .where(eq(chatMessage.conversationId, conversationId))
    .orderBy(asc(chatMessage.seq));
  const messages: Param[] = rows.map((r) => ({
    role: r.role,
    content: r.content as Param['content'],
  }));
  let seq = rows.at(-1)?.seq ?? 0;
  const persist = async (m: Param & { role: 'user' | 'assistant' }, hidden = false) => {
    messages.push(m);
    seq++;
    await db.insert(chatMessage).values({
      conversationId: conversationId!,
      seq,
      role: m.role,
      content: m.content,
      hidden,
    });
  };

  await persist({
    role: 'user',
    content: [
      { type: 'text', text: todayNote(todaySP()) },
      { type: 'text', text: opts.text },
    ],
  });

  const tools = apiTools();
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const started = Date.now();
      const msg = await model.turn({
        system: AGENT_SYSTEM_PROMPT,
        tools,
        messages,
        onText: (delta) => emit({ type: 'text', delta }),
        signal: opts.signal,
      });
      const usage = {
        inputTokens: msg.usage.input_tokens ?? 0,
        outputTokens: msg.usage.output_tokens ?? 0,
        cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
      };
      await db.insert(aiUsageLog).values({
        feature: AGENT_FEATURE,
        model: msg.model,
        ...usage,
        costMicrosUsd: costMicrosUsd(msg.model, usage),
        latencyMs: Date.now() - started,
      });
      await persist({ role: 'assistant', content: msg.content as Param['content'] });

      if (msg.stop_reason === 'refusal') {
        emit({ type: 'text', delta: '\n\nNão consigo ajudar com esse pedido.' });
        break;
      }
      if (msg.stop_reason === 'pause_turn') continue;
      const uses = msg.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
      );
      if (msg.stop_reason !== 'tool_use' || uses.length === 0) break;

      for (const u of uses) emit({ type: 'tool', name: u.name, label: toolLabel(u.name) });
      const results = await Promise.all(
        uses.map(async (u) => {
          const r = await runTool(u.name, u.input);
          return {
            type: 'tool_result' as const,
            tool_use_id: u.id,
            content: r.content,
            ...(r.isError ? { is_error: true } : {}),
          };
        }),
      );
      await persist({ role: 'user', content: results }, true);
      if (step === MAX_STEPS - 1)
        emit({ type: 'text', delta: '\n\n(Parei aqui: a pergunta exigiu consultas demais.)' });
    }
    emit({ type: 'done' });
  } catch (e) {
    if (e && typeof e === 'object' && 'digest' in e) throw e;
    console.error('[assistente]', e);
    emit({ type: 'error', message: 'A IA não respondeu agora. Tente de novo em instantes.' });
  } finally {
    await db
      .update(chatConversation)
      .set({ updatedAt: new Date() })
      .where(eq(chatConversation.id, conversationId));
  }
}

// ───────────────────────── Leitura para a tela ─────────────────────────

export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; tools: string[] };

export async function listConversations() {
  await requireUnlocked();
  return getDb()
    .select()
    .from(chatConversation)
    .orderBy(desc(chatConversation.updatedAt))
    .limit(50);
}

/** Mensagens da conversa para exibir: junta as idas e voltas de ferramenta numa resposta só. */
export async function getConversation(id: string) {
  await requireUnlocked();
  const db = getDb();
  const [conv] = await db.select().from(chatConversation).where(eq(chatConversation.id, id));
  if (!conv) return null;
  const rows = await db
    .select()
    .from(chatMessage)
    .where(eq(chatMessage.conversationId, id))
    .orderBy(asc(chatMessage.seq));
  const items: ChatItem[] = [];
  for (const r of rows) {
    if (r.hidden) continue;
    const blocks = r.content as Anthropic.Beta.BetaContentBlockParam[];
    if (r.role === 'user') {
      const text = blocks
        .filter((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === 'text')
        .map((b) => b.text)
        .filter((t) => !t.startsWith('[Hoje é '))
        .join('\n');
      items.push({ kind: 'user', id: r.id, text });
      continue;
    }
    const text = blocks
      .filter((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const tools = blocks
      .filter((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === 'tool_use')
      .map((b) => toolLabel(b.name));
    const prev = items.at(-1);
    if (prev?.kind === 'assistant') {
      prev.text = [prev.text, text].filter(Boolean).join('\n\n');
      prev.tools.push(...tools);
    } else items.push({ kind: 'assistant', id: r.id, text, tools });
  }
  return { conversation: conv, items };
}

export async function deleteConversation(id: string) {
  await requireUnlocked();
  await getDb().delete(chatConversation).where(eq(chatConversation.id, id));
}

export async function deleteAllConversations() {
  await requireUnlocked();
  await getDb().delete(chatConversation);
}
