import type Anthropic from '@anthropic-ai/sdk';
import { foldText } from '@/domain/text/normalize';
import type { AgentModel, AgentRequest } from './model';

type Block = Anthropic.Beta.BetaContentBlock;

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Pergunta → ferramenta, por palavra-chave. */
function pickTool(q: string): { name: string; input: Record<string, unknown> } {
  const t = foldText(q);
  const amount = /(\d+(?:[.,]\d+)?)/.exec(q.replace(/\./g, '').replace(',', '.'));
  if (/FINANCI/.test(t))
    return {
      name: 'simulate_financing',
      input: { assetPrice: 70000, downPayment: 10000, monthlyRatePct: 1.5, months: 48 },
    };
  if (/PATRIMONIO/.test(t)) return { name: 'get_net_worth', input: {} };
  if (/RESERVA|META|CAIXINHA/.test(t)) return { name: 'get_savings_and_goals', input: {} };
  if (/ASSINATURA/.test(t)) return { name: 'get_subscriptions', input: {} };
  if (/RENDE/.test(t))
    return {
      name: 'simulate_savings',
      input: { initial: 1000, monthly: 500, months: 24, cdiAnnualPct: 14 },
    };
  if (/POSSO|COMPRAR|GASTAR R?\$?/.test(t) && amount)
    return { name: 'can_i_spend', input: { amount: Number(amount[1]), method: 'pix' } };
  if (/GASTEI|CATEGORIA|ONDE/.test(t)) {
    const today = new Date().toISOString().slice(0, 10);
    return {
      name: 'get_spending_by_category',
      input: { from: `${today.slice(0, 7)}-01`, to: today, basis: 'accrual' },
    };
  }
  if (/PREVISAO|FIM DO MES|SALDO VAI/.test(t)) return { name: 'get_forecast', input: { days: 60 } };
  return { name: 'get_overview', input: {} };
}

function summarize(name: string, data: Record<string, unknown>): string {
  if (name === 'get_overview')
    return `## Visão geral\n\nSaldo em conta: **${brl(Number(data.cash ?? 0))}**\n\n- Investimentos: ${brl(Number(data.investments ?? 0))}`;
  if (name === 'get_spending_by_category') {
    const cats = (data.categories as { category: string; reais: number }[]) ?? [];
    const top = cats[0];
    return top
      ? `Onde você mais gastou: **${top.category}** (${brl(top.reais)}).\n\n| Categoria | Gasto |\n|---|---|\n${cats
          .slice(0, 5)
          .map((c) => `| ${c.category} | ${brl(c.reais)} |`)
          .join('\n')}`
      : 'Não encontrei gastos nesse período.';
  }
  if (name === 'can_i_spend')
    return `Veredito: **${String(data.verdict)}**\n\n${((data.reasons as string[]) ?? []).map((r) => `- ${r}`).join('\n')}`;
  if (name === 'get_forecast') {
    const base = data.base as { min: { balance: number; date: string } };
    return `Menor saldo previsto: **${brl(base.min.balance)}** em ${base.min.date}.`;
  }
  if (name === 'simulate_financing') {
    const p = data.price as { firstPayment: number; cetAnnual: string };
    const sac = data.sac as { firstPayment: number; lastPayment: number };
    return `Na tabela Price a parcela fica em **${brl(p.firstPayment)}** (CET de ${p.cetAnnual} ao ano). No SAC começa em ${brl(sac.firstPayment)} e termina em ${brl(sac.lastPayment)}.`;
  }
  if (name === 'get_net_worth')
    return `Seu patrimônio líquido hoje é **${brl(Number(data.net ?? 0))}**.`;
  if (name === 'get_savings_and_goals') {
    const e = data.emergency as { months: number | null };
    return `Investido: **${brl(Number(data.invested ?? 0))}**. A reserva cobre ${e.months ?? 'muitos'} meses de gastos essenciais.`;
  }
  if (name === 'get_subscriptions')
    return `Assinaturas: **${brl(Number(data.monthly ?? 0))}** por mês.`;
  if (name === 'simulate_savings')
    return `Em 24 meses você teria **${brl(Number(data.net ?? 0))}** líquidos.`;
  return 'Pronto.';
}

/** Assistente falso e determinístico: escolhe uma ferramenta, roda e resume (dev/E2E, sem custo). */
export class FakeAgentModel implements AgentModel {
  readonly model = 'fake-agent';

  async turn({ messages, onText }: AgentRequest): Promise<Anthropic.Beta.BetaMessage> {
    const last = messages.at(-1)!;
    const blocks = Array.isArray(last.content) ? last.content : [];
    const result = blocks.find(
      (b): b is Anthropic.Beta.BetaToolResultBlockParam => b.type === 'tool_result',
    );
    let content: Block[];
    let stop: Anthropic.Beta.BetaStopReason;
    if (!result) {
      const question = blocks
        .filter((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === 'text')
        .map((b) => b.text)
        .join(' ');
      const pick = pickTool(typeof last.content === 'string' ? last.content : question);
      content = [
        {
          type: 'tool_use',
          id: `toolu_fake_${messages.length}`,
          name: pick.name,
          input: pick.input,
        },
      ] as Block[];
      stop = 'tool_use';
    } else {
      const prev = messages.at(-2)!;
      const use = (prev.content as Anthropic.Beta.BetaContentBlockParam[]).find(
        (b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === 'tool_use',
      )!;
      const raw = typeof result.content === 'string' ? result.content : '{}';
      const text = result.is_error
        ? `Não consegui consultar: ${raw}`
        : summarize(use.name, JSON.parse(raw) as Record<string, unknown>);
      for (const piece of text.match(/.{1,12}/gs) ?? []) onText(piece);
      content = [{ type: 'text', text, citations: null }] as Block[];
      stop = 'end_turn';
    }
    return {
      id: `msg_fake_${messages.length}`,
      type: 'message',
      role: 'assistant',
      model: this.model,
      content,
      stop_reason: stop,
      stop_sequence: null,
      usage: { input_tokens: 1200, output_tokens: 80 },
    } as unknown as Anthropic.Beta.BetaMessage;
  }
}
