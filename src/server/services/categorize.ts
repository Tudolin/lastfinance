import 'server-only';
import { and, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { costMicrosUsd, type Usage } from '@/domain/ai/pricing';
import { sanitizeForAi } from '@/domain/ai/sanitize';
import {
  firstMatchingRule,
  ruleActionsSchema,
  ruleConditionsSchema,
  ruleFromCorrection,
  type Rule,
} from '@/domain/categorization/rules';
import { startOfMonth, todaySP } from '@/domain/dates/local-date';
import { getAi } from '@/server/adapters/ai/client';
import type {
  CategorizeContext,
  CategorizeItem,
  CategorizeResult,
  CategoryOption,
} from '@/server/adapters/ai/types';
import { getDb, schema } from '@/server/db/client';
import { dispatch } from '@/server/jobs/dispatch';
import { log } from '@/server/log';
import { ensureDefaultCategories } from './categories';
import { getAppSettings } from './settings';

const {
  transaction: tx,
  account,
  category,
  merchant,
  categorizationRule,
  reviewQueue,
  categorySuggestion,
  aiUsageLog,
  aiBatchJob,
} = schema;

/** Kinds que recebem categoria. Transferências, faturas e aplicações já são a própria "categoria". */
export const CATEGORIZABLE_KINDS = ['expense', 'income', 'refund'] as const;
/** Ajustáveis (os testes reduzem para exercitar o caminho do lote). */
export const CATEGORIZE_CONFIG = {
  /** estabelecimentos por chamada à IA */
  chunkSize: 40,
  /** abaixo disso a carga histórica vai síncrona (lote demora até 1 h; não compensa para poucos itens) */
  batchMinMerchants: 50,
};

/** Literal de array de texto do Postgres ('{"a","b"}') — evita a expansão de arrays do driver. */
function pgTextArray(values: readonly string[] = []): string {
  return `{${values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
}

type CatSource = (typeof schema.categorySource.enumValues)[number];
type Assign = {
  id: string;
  categoryId: string | null;
  source: CatSource;
  confidence: number;
  ruleId?: string | null;
  tags?: string[];
  rename?: string | null;
};

export async function loadRules(): Promise<Rule[]> {
  const rows = await getDb()
    .select()
    .from(categorizationRule)
    .where(eq(categorizationRule.enabled, true));
  const out: Rule[] = [];
  for (const r of rows) {
    const c = ruleConditionsSchema.safeParse(r.conditions);
    const a = ruleActionsSchema.safeParse(r.actions);
    if (c.success && a.success)
      out.push({
        id: r.id,
        priority: r.priority,
        enabled: r.enabled,
        conditions: c.data,
        actions: a.data,
      });
  }
  return out;
}

async function aiContext(): Promise<{
  ctx: CategorizeContext;
  bySlug: Map<string, { id: string; kind: 'expense' | 'income' }>;
}> {
  const db = getDb();
  const cats = await db.select().from(category).where(isNull(category.archivedAt));
  const hasChildren = new Set(cats.map((c) => c.parentId).filter(Boolean));
  const leaves = cats.filter((c) => c.slug && !hasChildren.has(c.id));
  const options: CategoryOption[] = leaves
    .map((c) => ({
      slug: c.slug!,
      name: c.name,
      kind: c.kind,
      parent: cats.find((p) => p.id === c.parentId)?.name ?? null,
    }))
    .sort((a, b) => (a.slug < b.slug ? -1 : 1)); // ordem estável → cache do prompt
  const examples = await db
    .select({ description: merchant.descriptionNorm, slug: category.slug })
    .from(merchant)
    .innerJoin(category, eq(merchant.categoryId, category.id))
    .where(eq(merchant.source, 'user'))
    .orderBy(merchant.descriptionNorm)
    .limit(40);
  return {
    ctx: {
      categories: options,
      examples: examples
        .filter((e) => e.slug)
        .map((e) => ({ description: sanitizeForAi(e.description), slug: e.slug! })),
    },
    bySlug: new Map(leaves.map((c) => [c.slug!, { id: c.id, kind: c.kind }])),
  };
}

async function applyAssignments(rows: Assign[]) {
  const db = getDb();
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const values = sql.join(
      chunk.map(
        (a) =>
          sql`(${a.id}::uuid, ${a.categoryId}::uuid, ${a.source}::category_source, ${a.confidence}::real, ${a.ruleId ?? null}::uuid, ${pgTextArray(a.tags)}::text[], ${a.rename ?? null})`,
      ),
      sql`, `,
    );
    await db.execute(sql`
      update ${tx} as t set
        category_id = v.category_id, category_source = v.source, category_confidence = v.confidence, rule_id = v.rule_id,
        tags = (select array(select distinct unnest(t.tags || v.tags))),
        user_description = coalesce(t.user_description, v.rename),
        updated_at = now()
      from (values ${values}) as v(id, category_id, source, confidence, rule_id, tags, rename)
      where t.id = v.id and (t.category_source is null or t.category_source <> 'user')`);
  }
}

export async function aiSpendThisMonthMicros(): Promise<number> {
  const from = new Date(`${startOfMonth(todaySP())}T03:00:00Z`);
  const [r] = await getDb()
    .select({ total: sql<number>`coalesce(sum(${aiUsageLog.costMicrosUsd}), 0)::bigint` })
    .from(aiUsageLog)
    .where(gte(aiUsageLog.at, from));
  return Number(r?.total ?? 0);
}

async function logUsage(
  feature: string,
  model: string,
  usage: Usage,
  batch: boolean,
  latencyMs?: number,
) {
  await getDb()
    .insert(aiUsageLog)
    .values({
      feature,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      batch,
      costMicrosUsd: costMicrosUsd(model, usage, batch),
      latencyMs: latencyMs ?? null,
    });
}

export type CategorizeCounts = {
  rules: number;
  merchant: number;
  link: number;
  ai: number;
  review: number;
  pendingAi: number;
  batchSubmitted: boolean;
  aiSkipped?: string;
};

/**
 * Pipeline em camadas: (1) estorno herda a categoria da compra original, (2) regras do usuário,
 * (3) cache por estabelecimento, (4) IA só para o que sobrar — síncrona (incremental) ou em lote (carga histórica).
 */
export async function categorizePending(
  opts: { mode: 'sync' | 'batch' | 'none'; maxAiMerchants?: number } = { mode: 'sync' },
): Promise<CategorizeCounts> {
  await ensureDefaultCategories();
  const db = getDb();
  const settings = await getAppSettings();
  const counts: CategorizeCounts = {
    rules: 0,
    merchant: 0,
    link: 0,
    ai: 0,
    review: 0,
    pendingAi: 0,
    batchSubmitted: false,
  };

  const pending = await db
    .select({
      id: tx.id,
      accountId: tx.accountId,
      accountKind: account.kind,
      description: tx.srcDescription,
      descriptionNorm: tx.descriptionNorm,
      amountCents: tx.amountCents,
      kind: tx.kind,
      refundOf: tx.refundOfTransactionId,
    })
    .from(tx)
    .innerJoin(account, eq(tx.accountId, account.id))
    .where(
      and(
        isNull(tx.deletedAt),
        isNull(tx.categoryId),
        isNull(tx.categorySource),
        inArray(tx.kind, [...CATEGORIZABLE_KINDS]),
      ),
    );
  if (pending.length === 0) return counts;

  const rules = await loadRules();
  const refundOrigins = pending.filter((p) => p.refundOf).map((p) => p.refundOf!);
  const originCats = refundOrigins.length
    ? new Map(
        (
          await db
            .select({ id: tx.id, categoryId: tx.categoryId })
            .from(tx)
            .where(inArray(tx.id, refundOrigins))
        ).map((r) => [r.id, r.categoryId]),
      )
    : new Map<string, string | null>();
  const norms = [...new Set(pending.map((p) => p.descriptionNorm))];
  const merchants = new Map(
    (await db.select().from(merchant).where(inArray(merchant.descriptionNorm, norms))).map((m) => [
      m.descriptionNorm,
      m,
    ]),
  );

  const assigns: Assign[] = [];
  const ruleHits = new Map<string, number>();
  const forAi: typeof pending = [];
  for (const p of pending) {
    const originCat = p.refundOf ? originCats.get(p.refundOf) : null;
    if (originCat) {
      assigns.push({ id: p.id, categoryId: originCat, source: 'link', confidence: 1 });
      counts.link++;
      continue;
    }
    const rule = firstMatchingRule(rules, {
      description: p.description,
      accountId: p.accountId,
      amountCents: p.amountCents,
    });
    if (rule && (rule.actions.categoryId || rule.actions.tags?.length || rule.actions.rename)) {
      assigns.push({
        id: p.id,
        categoryId: rule.actions.categoryId ?? null,
        source: 'rule',
        confidence: 1,
        ruleId: rule.id,
        tags: rule.actions.tags,
        rename: rule.actions.rename ?? null,
      });
      ruleHits.set(rule.id, (ruleHits.get(rule.id) ?? 0) + 1);
      counts.rules++;
      if (rule.actions.categoryId) continue;
    }
    const m = merchants.get(p.descriptionNorm);
    if (
      m?.categoryId &&
      (m.source === 'user' || (m.confidence ?? 0) >= settings.aiReviewThreshold)
    ) {
      assigns.push({
        id: p.id,
        categoryId: m.categoryId,
        source: 'merchant',
        confidence: m.confidence ?? 1,
      });
      counts.merchant++;
      continue;
    }
    forAi.push(p);
  }
  await applyAssignments(assigns);
  for (const [id, n] of ruleHits) {
    await db
      .update(categorizationRule)
      .set({ hits: sql`${categorizationRule.hits} + ${n}`, lastHitAt: new Date() })
      .where(eq(categorizationRule.id, id));
  }

  // ── IA: um item por estabelecimento (descrição normalizada), nunca por transação ──
  const groups = new Map<string, typeof forAi>();
  for (const p of forAi)
    groups.set(p.descriptionNorm, [...(groups.get(p.descriptionNorm) ?? []), p]);
  counts.pendingAi = groups.size;
  if (groups.size === 0 || opts.mode === 'none') return counts;

  const ai = await getAi();
  if (!ai) return { ...counts, aiSkipped: 'sem chave da Anthropic' };
  if ((await aiSpendThisMonthMicros()) >= settings.aiMonthlyBudgetUsd * 1_000_000) {
    log.warn('teto mensal de IA atingido', { count: groups.size });
    return { ...counts, aiSkipped: 'teto mensal de gasto com IA atingido' };
  }

  const items: CategorizeItem[] = [...groups.entries()]
    .slice(0, opts.maxAiMerchants ?? 400)
    .map(([norm, list], i) => {
      const amounts = list.map((l) => Math.abs(l.amountCents)).sort((a, b) => a - b);
      return {
        id: `m${i}`,
        description: sanitizeForAi(norm),
        direction: list[0]!.amountCents > 0 ? 'in' : 'out',
        typicalAmount: Math.round(amounts[Math.floor(amounts.length / 2)]! / 100),
        occurrences: list.length,
        channel: list[0]!.accountKind === 'credit_card' ? 'cartao' : 'conta',
      };
    });
  const normById = new Map(items.map((it, i) => [it.id, [...groups.keys()][i]!]));
  const { ctx, bySlug } = await aiContext();

  const chunks: { customId: string; items: CategorizeItem[] }[] = [];
  for (let i = 0; i < items.length; i += CATEGORIZE_CONFIG.chunkSize) {
    chunks.push({
      customId: `c${chunks.length}`,
      items: items.slice(i, i + CATEGORIZE_CONFIG.chunkSize),
    });
  }

  if (opts.mode === 'batch' && items.length >= CATEGORIZE_CONFIG.batchMinMerchants) {
    const batchId = await ai.submitCategorizeBatch(chunks, ctx);
    const [job] = await db
      .insert(aiBatchJob)
      .values({
        anthropicBatchId: batchId,
        feature: 'categorize',
        itemCount: items.length,
        mapping: Object.fromEntries(normById),
      })
      .returning({ id: aiBatchJob.id });
    await dispatch({ name: 'ai/batch.submitted', data: { jobId: job!.id } });
    return { ...counts, batchSubmitted: true };
  }

  for (const c of chunks) {
    const r = await ai.categorize(c.items, ctx);
    await logUsage('categorize', r.model, r.usage, false, r.latencyMs);
    const applied = await applyAiResults(
      r.results,
      normById,
      bySlug,
      settings.aiReviewThreshold,
      r.model,
    );
    counts.ai += applied.categorized;
    counts.review += applied.review;
  }
  await linkRefundCategories();
  return counts;
}

/** Aplica a resposta da IA: atualiza o cache do estabelecimento, as transações e a fila de revisão. */
export async function applyAiResults(
  results: CategorizeResult[],
  normById: Map<string, string>,
  bySlug: Map<string, { id: string; kind: 'expense' | 'income' }>,
  threshold: number,
  model: string,
) {
  const db = getDb();
  let categorized = 0;
  let review = 0;
  for (const r of results) {
    const norm = normById.get(r.id);
    if (!norm) continue;
    const known = bySlug.get(r.category);
    const target = known ?? bySlug.get('outros') ?? null;
    const confidence = known ? r.confidence : Math.min(r.confidence, 0.4);

    const [existing] = await db.select().from(merchant).where(eq(merchant.descriptionNorm, norm));
    if (existing?.source === 'user') continue; // decisão do usuário prevalece
    const mvalues = {
      descriptionNorm: norm,
      displayName: r.merchant_name.slice(0, 80),
      categoryId: target?.id ?? null,
      nature: r.nature,
      looksRecurring: r.looks_recurring,
      periodicity: r.periodicity,
      confidence,
      source: 'ai' as const,
      model,
    };
    await db
      .insert(merchant)
      .values(mvalues)
      .onConflictDoUpdate({ target: merchant.descriptionNorm, set: mvalues });

    const updated = await db
      .update(tx)
      .set({ categoryId: target?.id ?? null, categorySource: 'ai', categoryConfidence: confidence })
      .where(
        and(
          eq(tx.descriptionNorm, norm),
          isNull(tx.deletedAt),
          or(isNull(tx.categorySource), eq(tx.categorySource, 'ai')),
        ),
      )
      .returning({ id: tx.id });
    categorized += updated.length;

    if (confidence < threshold && updated.length) {
      await db
        .insert(reviewQueue)
        .values(
          updated.map((u) => ({
            transactionId: u.id,
            reason: known ? 'low_confidence' : 'unknown_category',
            suggested: { category: r.category, confidence, merchant: r.merchant_name },
          })),
        )
        .onConflictDoNothing();
      review += updated.length;
    }
    if (r.new_category_suggestion) {
      await db
        .insert(categorySuggestion)
        .values({
          name: r.new_category_suggestion.slice(0, 60),
          examples: [r.merchant_name.slice(0, 60)],
        })
        .onConflictDoUpdate({
          target: categorySuggestion.name,
          set: {
            examples: sql`(select array(select distinct unnest(${categorySuggestion.examples} || ${pgTextArray([r.merchant_name.slice(0, 60)])}::text[])))`,
          },
        });
    }
  }
  return { categorized, review };
}

/** Lote enviado à Message Batches API terminou: aplica os resultados. Idempotente. */
export async function applyBatchJob(
  jobId: string,
): Promise<{ ended: boolean; categorized?: number }> {
  const db = getDb();
  const [job] = await db.select().from(aiBatchJob).where(eq(aiBatchJob.id, jobId));
  if (!job || job.status === 'applied') return { ended: true };
  const ai = await getAi();
  if (!ai) return { ended: true };
  if (!(await ai.batchEnded(job.anthropicBatchId))) return { ended: false };

  const settings = await getAppSettings();
  const normById = new Map<string, string>(Object.entries(job.mapping));
  const { bySlug } = await aiContext();
  let categorized = 0;
  for (const r of await ai.batchResults(job.anthropicBatchId)) {
    if (!r.ok) {
      log.warn('item do lote de IA falhou', { code: r.error });
      continue;
    }
    await logUsage('categorize', ai.model, r.usage, true);
    categorized += (
      await applyAiResults(r.results, normById, bySlug, settings.aiReviewThreshold, ai.model)
    ).categorized;
  }
  await db
    .update(aiBatchJob)
    .set({ status: 'applied', endedAt: new Date() })
    .where(eq(aiBatchJob.id, jobId));
  await linkRefundCategories();
  // o que ficou de fora do lote (ex.: limite de itens) segue no modo síncrono
  await categorizePending({ mode: 'sync', maxAiMerchants: 200 });
  return { ended: true, categorized };
}

/**
 * Estorno abate a categoria da compra original: copia a categoria quando a original já está categorizada
 * (rodado de novo depois da IA, pois a compra pode ter sido categorizada na mesma execução).
 */
export async function linkRefundCategories() {
  const r = await getDb().execute(sql`
    update ${tx} as r set category_id = o.category_id, category_source = 'link', category_confidence = 1, updated_at = now()
    from ${tx} as o
    where r.refund_of_transaction_id = o.id and r.kind = 'refund' and r.deleted_at is null
      and o.category_id is not null
      and (r.category_source is null or r.category_source in ('ai', 'merchant'))
      and r.category_id is distinct from o.category_id`);
  return (
    (r as unknown as { rowCount?: number; affectedRows?: number }).rowCount ??
    (r as { affectedRows?: number }).affectedRows ??
    0
  );
}

// ───────────────────────── Correções do usuário ─────────────────────────

/**
 * O usuário escolheu a categoria de uma transação. Isso vira: decisão definitiva na transação,
 * exemplo para a IA (cache do estabelecimento com fonte "user"), regra opcional e aplicação às parecidas.
 */
export async function correctCategory(
  transactionId: string,
  categoryId: string | null,
  opts: { createRule: boolean; applyToSimilar: boolean },
) {
  const db = getDb();
  const [t] = await db.select().from(tx).where(eq(tx.id, transactionId));
  if (!t) throw new Error('Transação não encontrada');
  await db
    .update(tx)
    .set({
      categoryId,
      categorySource: categoryId ? 'user' : null,
      categoryConfidence: categoryId ? 1 : null,
    })
    .where(eq(tx.id, t.id));
  await db
    .update(reviewQueue)
    .set({ status: 'resolved', resolvedAt: new Date() })
    .where(and(eq(reviewQueue.transactionId, t.id), eq(reviewQueue.status, 'pending')));
  if (!categoryId) return { similar: 0, ruleId: null };

  await db
    .insert(merchant)
    .values({ descriptionNorm: t.descriptionNorm, categoryId, confidence: 1, source: 'user' })
    .onConflictDoUpdate({
      target: merchant.descriptionNorm,
      set: { categoryId, confidence: 1, source: 'user' },
    });

  let similar = 0;
  if (opts.applyToSimilar) {
    const rows = await db
      .update(tx)
      .set({ categoryId, categorySource: 'merchant', categoryConfidence: 1 })
      .where(
        and(
          eq(tx.descriptionNorm, t.descriptionNorm),
          ne(tx.id, t.id),
          isNull(tx.deletedAt),
          inArray(tx.kind, [...CATEGORIZABLE_KINDS]),
          or(isNull(tx.categorySource), inArray(tx.categorySource, ['ai', 'merchant'])),
        ),
      )
      .returning({ id: tx.id });
    similar = rows.length;
    if (rows.length) {
      await db
        .update(reviewQueue)
        .set({ status: 'resolved', resolvedAt: new Date() })
        .where(
          and(
            inArray(
              reviewQueue.transactionId,
              rows.map((r) => r.id),
            ),
            eq(reviewQueue.status, 'pending'),
          ),
        );
    }
  }

  let ruleId: string | null = null;
  if (opts.createRule) {
    const draft = ruleFromCorrection(t.descriptionNorm, { categoryId });
    if (draft) {
      const term = draft.conditions.descriptionContains![0]!;
      const existing = await db
        .select()
        .from(categorizationRule)
        .where(eq(categorizationRule.origin, 'correction'));
      const dup = existing.find(
        (r) =>
          (r.conditions as { descriptionContains?: string[] }).descriptionContains?.[0] === term,
      );
      if (dup) {
        await db
          .update(categorizationRule)
          .set({ actions: draft.actions })
          .where(eq(categorizationRule.id, dup.id));
        ruleId = dup.id;
      } else {
        const [row] = await db
          .insert(categorizationRule)
          .values({
            name: `“${term}” (correção)`,
            priority: 50,
            conditions: draft.conditions,
            actions: draft.actions,
            origin: 'correction',
          })
          .returning({ id: categorizationRule.id });
        ruleId = row!.id;
      }
    }
  }
  return { similar, ruleId };
}

/** Quantas transações já existentes uma regra afetaria (prévia) — e aplica se pedido. Nunca toca decisões do usuário. */
export async function applyRuleRetroactively(ruleId: string, dryRun: boolean): Promise<number> {
  const db = getDb();
  const rules = (await loadRules()).filter((r) => r.id === ruleId);
  const rule = rules[0];
  if (!rule) return 0;
  const candidates = await db
    .select({
      id: tx.id,
      description: tx.srcDescription,
      accountId: tx.accountId,
      amountCents: tx.amountCents,
    })
    .from(tx)
    .where(
      and(
        isNull(tx.deletedAt),
        inArray(tx.kind, [...CATEGORIZABLE_KINDS]),
        or(isNull(tx.categorySource), ne(tx.categorySource, 'user')),
      ),
    );
  const hits = candidates.filter((c) => firstMatchingRule([rule], c));
  if (!dryRun && hits.length) {
    await applyAssignments(
      hits.map((h) => ({
        id: h.id,
        categoryId: rule.actions.categoryId ?? null,
        source: 'rule' as const,
        confidence: 1,
        ruleId: rule.id,
        tags: rule.actions.tags,
        rename: rule.actions.rename ?? null,
      })),
    );
    await db
      .update(categorizationRule)
      .set({ hits: sql`${categorizationRule.hits} + ${hits.length}`, lastHitAt: new Date() })
      .where(eq(categorizationRule.id, rule.id));
  }
  return hits.length;
}
