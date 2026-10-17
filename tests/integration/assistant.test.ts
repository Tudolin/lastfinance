import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { todaySP } from '@/domain/dates/local-date';
import { setAiForTests } from '@/server/adapters/ai/client';
import { FakeAiGateway } from '@/server/adapters/ai/fake';
import { setPluggyForTests } from '@/server/adapters/pluggy/client';
import { FakePluggy } from '@/server/adapters/pluggy/fake';
import { FakeAgentModel } from '@/server/agent/fake-model';
import { setAgentModelForTests } from '@/server/agent/model';
import { getConversation, runAgentTurn, type AgentEvent } from '@/server/agent/run';
import { runTool, TOOLS } from '@/server/agent/tools';
import { schema, type Db } from '@/server/db/client';
import { inlineStep } from '@/server/jobs/step';
import { runItemSync } from '@/server/services/item-sync';
import { createTestDb } from './helpers/db';

vi.mock('@/server/auth/request', () => ({
  requireUnlocked: async () => ({}),
  requireSession: async () => ({}),
}));

const { chatMessage, aiUsageLog } = schema;
let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const pluggy = new FakePluggy(todaySP());
  pluggy.seedInstitution('itau');
  pluggy.seedInstitution('nubank');
  setPluggyForTests(pluggy);
  setAiForTests(new FakeAiGateway());
  for (const id of ['fake-item-itau', 'fake-item-nubank'])
    await runItemSync(inlineStep, {
      pluggyItemId: id,
      mode: 'backfill',
      trigger: 'manual',
      runId: id,
    });
  setAgentModelForTests(new FakeAgentModel());
});

afterEach(async () => {
  setPluggyForTests(undefined);
  setAiForTests(undefined);
  setAgentModelForTests(undefined);
  await close();
});

async function ask(text: string, conversationId: string | null = null) {
  const events: AgentEvent[] = [];
  await runAgentTurn({ conversationId, text, emit: (e) => events.push(e) });
  return events;
}

describe('assistente', () => {
  it('chama a ferramenta, responde e grava a conversa', async () => {
    const events = await ask('Qual é o meu saldo?');
    const conv = events.find((e) => e.type === 'conversation');
    expect(conv).toBeTruthy();
    expect(events).toContainEqual({
      type: 'tool',
      name: 'get_overview',
      label: expect.any(String),
    });
    const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
    expect(text).toContain('Saldo em conta');
    expect(events.at(-1)).toEqual({ type: 'done' });

    const id = conv!.type === 'conversation' ? conv!.id : '';
    const rows = await db.select().from(chatMessage).where(eq(chatMessage.conversationId, id));
    // pergunta, tool_use, tool_result (oculto), resposta
    expect(rows.map((r) => [r.role, r.hidden])).toEqual([
      ['user', false],
      ['assistant', false],
      ['user', true],
      ['assistant', false],
    ]);
    const usage = await db.select().from(aiUsageLog).where(eq(aiUsageLog.feature, 'assistant'));
    expect(usage).toHaveLength(2);

    const view = await getConversation(id);
    expect(view!.items).toHaveLength(2);
    expect(view!.items[0]).toMatchObject({ kind: 'user', text: 'Qual é o meu saldo?' });
    expect(view!.items[1]).toMatchObject({ kind: 'assistant' });

    // segunda pergunta continua a mesma conversa
    const again = await ask('Onde mais gastei?', id);
    expect(again.find((e) => e.type === 'conversation')).toBeUndefined();
    expect((await getConversation(id))!.items).toHaveLength(4);
  });

  it('todas as ferramentas rodam com a entrada padrão sobre os dados de demonstração', async () => {
    const today = todaySP();
    const inputs: Record<string, unknown> = {
      get_spending_by_category: { from: `${today.slice(0, 7)}-01`, to: today },
      can_i_spend: { amount: 300 },
      search_transactions: { text: 'ifood' },
    };
    for (const t of TOOLS) {
      const r = await runTool(t.name, inputs[t.name] ?? {});
      expect(r.isError, `${t.name}: ${r.content}`).toBe(false);
      expect(r.content).not.toMatch(/Cents"/);
    }
  });

  it('entrada inválida volta como erro para a IA, sem exceção', async () => {
    const r = await runTool('get_spending_by_category', { from: 'ontem' });
    expect(r.isError).toBe(true);
    expect((await runTool('nao_existe', {})).isError).toBe(true);
  });

  it('respeita o teto mensal de gasto', async () => {
    await db.insert(aiUsageLog).values({
      feature: 'assistant',
      model: 'claude-opus-5-5',
      costMicrosUsd: 50_000_000,
    });
    const events = await ask('Qual é o meu saldo?');
    expect(events).toEqual([{ type: 'error', message: expect.stringContaining('teto') }]);
  });
});
