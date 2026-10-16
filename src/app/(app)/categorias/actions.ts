'use server';

import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ruleActionsSchema, ruleConditionsSchema } from '@/domain/categorization/rules';
import { TX_KINDS } from '@/domain/classification/types';
import { foldText } from '@/domain/text/normalize';
import { requireUnlocked } from '@/server/auth/request';
import { getDb, schema } from '@/server/db/client';
import { applyRuleRetroactively, correctCategory } from '@/server/services/categorize';
import { postprocess } from '@/server/services/postprocess';

export type Result<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };
const uuid = z.string().uuid();

function refresh() {
  for (const p of [
    '/',
    '/transacoes',
    '/categorias',
    '/regras',
    '/revisao',
    '/orcamentos',
    '/analise',
  ])
    revalidatePath(p);
}

// ───── Categorias ─────

const categorySchema = z.object({
  name: z.string().trim().min(2).max(60),
  parentId: z.union([z.literal(''), uuid]).transform((v) => v || null),
  kind: z.enum(['expense', 'income']),
});

export async function createCategoryAction(_: Result | undefined, fd: FormData): Promise<Result> {
  await requireUnlocked();
  const p = categorySchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { ok: false, error: 'Informe um nome (2 a 60 caracteres).' };
  const slug = `u-${foldText(p.data.name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`.slice(0, 50);
  const db = getDb();
  const [exists] = await db.select().from(schema.category).where(eq(schema.category.slug, slug));
  if (exists) return { ok: false, error: 'Já existe uma categoria com esse nome.' };
  await db.insert(schema.category).values({ ...p.data, slug, sortOrder: 9000 });
  refresh();
  return { ok: true };
}

export async function renameCategoryAction(id: string, name: string): Promise<Result> {
  await requireUnlocked();
  const n = z.string().trim().min(2).max(60).safeParse(name);
  if (!n.success) return { ok: false, error: 'Nome inválido.' };
  await getDb()
    .update(schema.category)
    .set({ name: n.data })
    .where(eq(schema.category.id, uuid.parse(id)));
  refresh();
  return { ok: true };
}

export async function archiveCategoryAction(id: string, archived: boolean): Promise<Result> {
  await requireUnlocked();
  await getDb()
    .update(schema.category)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(schema.category.id, uuid.parse(id)));
  refresh();
  return { ok: true };
}

export async function resolveSuggestionAction(
  id: string,
  approve: boolean,
  parentId?: string,
): Promise<Result> {
  await requireUnlocked();
  const db = getDb();
  const [s] = await db
    .select()
    .from(schema.categorySuggestion)
    .where(eq(schema.categorySuggestion.id, uuid.parse(id)));
  if (!s) return { ok: false, error: 'Sugestão não encontrada.' };
  if (approve) {
    const fd = new FormData();
    fd.set('name', s.name);
    fd.set('parentId', parentId ?? '');
    fd.set('kind', 'expense');
    const r = await createCategoryAction(undefined, fd);
    if (!r.ok) return r;
  }
  await db
    .update(schema.categorySuggestion)
    .set({ status: approve ? 'resolved' : 'dismissed' })
    .where(eq(schema.categorySuggestion.id, s.id));
  refresh();
  return { ok: true };
}

// ───── Regras ─────

const ruleFormSchema = z.object({
  name: z.string().trim().min(2).max(80),
  terms: z.string().trim().max(400),
  regex: z.string().trim().max(200),
  accountId: z.union([z.literal(''), uuid]),
  direction: z.enum(['', 'in', 'out']),
  categoryId: z.union([z.literal(''), uuid]),
  kind: z.union([z.literal(''), z.enum(TX_KINDS)]),
  tags: z.string().trim().max(200),
  priority: z.coerce.number().int().min(0).max(1000).default(100),
});

export async function createRuleAction(
  _: Result<{ id: string; preview: number }> | undefined,
  fd: FormData,
): Promise<Result<{ id: string; preview: number }>> {
  await requireUnlocked();
  const p = ruleFormSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { ok: false, error: 'Preencha o nome e pelo menos uma condição.' };
  const f = p.data;
  const conditions = ruleConditionsSchema.safeParse({
    ...(f.terms
      ? {
          descriptionContains: f.terms
            .split(/[,;\n]/)
            .map((t) => t.trim())
            .filter(Boolean),
        }
      : {}),
    ...(f.regex ? { descriptionRegex: f.regex } : {}),
    ...(f.accountId ? { accountIds: [f.accountId] } : {}),
    ...(f.direction ? { direction: f.direction } : {}),
  });
  if (!conditions.success) return { ok: false, error: conditions.error.issues[0]!.message };
  const actions = ruleActionsSchema.safeParse({
    ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.tags
      ? {
          tags: f.tags
            .split(/[\s,]+/)
            .map((t) => t.replace(/^#/, '').toLowerCase())
            .filter(Boolean),
        }
      : {}),
  });
  if (!actions.success) return { ok: false, error: actions.error.issues[0]!.message };
  const [row] = await getDb()
    .insert(schema.categorizationRule)
    .values({
      name: f.name,
      priority: f.priority,
      conditions: conditions.data,
      actions: actions.data,
      origin: 'user',
    })
    .returning({ id: schema.categorizationRule.id });
  const preview = await applyRuleRetroactively(row!.id, true);
  if (actions.data.kind) await postprocess();
  refresh();
  return { ok: true, data: { id: row!.id, preview } };
}

export async function toggleRuleAction(id: string, enabled: boolean): Promise<Result> {
  await requireUnlocked();
  await getDb()
    .update(schema.categorizationRule)
    .set({ enabled })
    .where(eq(schema.categorizationRule.id, uuid.parse(id)));
  await postprocess();
  refresh();
  return { ok: true };
}

export async function deleteRuleAction(id: string): Promise<Result> {
  await requireUnlocked();
  await getDb()
    .delete(schema.categorizationRule)
    .where(eq(schema.categorizationRule.id, uuid.parse(id)));
  await postprocess();
  refresh();
  return { ok: true };
}

export async function applyRuleAction(id: string): Promise<Result<{ applied: number }>> {
  await requireUnlocked();
  const applied = await applyRuleRetroactively(uuid.parse(id), false);
  refresh();
  return { ok: true, data: { applied } };
}

// ───── Categoria de uma transação / revisão ─────

export async function setTransactionCategoryAction(
  transactionId: string,
  categoryId: string | null,
  opts: { createRule: boolean; applyToSimilar: boolean },
): Promise<Result<{ similar: number; ruleId: string | null }>> {
  await requireUnlocked();
  const data = await correctCategory(
    uuid.parse(transactionId),
    categoryId ? uuid.parse(categoryId) : null,
    opts,
  );
  refresh();
  revalidatePath(`/transacoes/${transactionId}`);
  return { ok: true, data };
}

/** Confirma a sugestão da IA como está (vira exemplo para as próximas classificações). */
export async function confirmSuggestionAction(transactionId: string): Promise<Result> {
  await requireUnlocked();
  const [t] = await getDb()
    .select({ categoryId: schema.transaction.categoryId })
    .from(schema.transaction)
    .where(eq(schema.transaction.id, uuid.parse(transactionId)));
  if (!t?.categoryId) return { ok: false, error: 'Sem sugestão para confirmar.' };
  await correctCategory(transactionId, t.categoryId, { createRule: false, applyToSimilar: true });
  refresh();
  return { ok: true };
}

export async function dismissReviewAction(reviewId: string): Promise<Result> {
  await requireUnlocked();
  await getDb()
    .update(schema.reviewQueue)
    .set({ status: 'dismissed', resolvedAt: new Date() })
    .where(
      and(
        eq(schema.reviewQueue.id, uuid.parse(reviewId)),
        eq(schema.reviewQueue.status, 'pending'),
      ),
    );
  refresh();
  return { ok: true };
}

// ───── Divisão de uma transação em várias categorias ─────

const splitsSchema = z
  .array(
    z.object({
      categoryId: uuid,
      amount: z.number().positive(),
      note: z.string().max(120).optional(),
    }),
  )
  .max(10);

export async function setSplitsAction(transactionId: string, rawParts: unknown): Promise<Result> {
  await requireUnlocked();
  const parts = splitsSchema.safeParse(rawParts);
  if (!parts.success) return { ok: false, error: 'Partes inválidas.' };
  const db = getDb();
  const [t] = await db
    .select()
    .from(schema.transaction)
    .where(eq(schema.transaction.id, uuid.parse(transactionId)));
  if (!t) return { ok: false, error: 'Transação não encontrada.' };
  await db.delete(schema.transactionSplit).where(eq(schema.transactionSplit.transactionId, t.id));
  if (parts.data.length >= 2) {
    const sign = Math.sign(t.amountCents) || -1;
    const cents = parts.data.map((p) => Math.round(p.amount * 100));
    const sum = cents.reduce((a, b) => a + b, 0);
    if (sum !== Math.abs(t.amountCents)) {
      return {
        ok: false,
        error: `A soma das partes (${(sum / 100).toFixed(2)}) precisa ser igual ao valor da transação (${(Math.abs(t.amountCents) / 100).toFixed(2)}).`,
      };
    }
    await db
      .insert(schema.transactionSplit)
      .values(
        parts.data.map((p, i) => ({
          transactionId: t.id,
          categoryId: p.categoryId,
          amountCents: sign * cents[i]!,
          note: p.note ?? null,
        })),
      );
  }
  refresh();
  revalidatePath(`/transacoes/${transactionId}`);
  return { ok: true };
}

// ───── Orçamentos ─────

const budgetSchema = z.object({
  categoryId: uuid,
  month: z.string().regex(/^\d{4}-\d{2}-01$/),
  amount: z.coerce.number().positive().max(10_000_000),
  rollover: z
    .string()
    .optional()
    .transform((v) => v === 'on' || v === 'true'),
});

export async function upsertBudgetAction(_: Result | undefined, fd: FormData): Promise<Result> {
  await requireUnlocked();
  const p = budgetSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { ok: false, error: 'Escolha a categoria e um valor maior que zero.' };
  const values = {
    categoryId: p.data.categoryId,
    month: p.data.month,
    amountCents: Math.round(p.data.amount * 100),
    rollover: p.data.rollover,
  };
  await getDb()
    .insert(schema.budget)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.budget.categoryId, schema.budget.month],
      set: { amountCents: values.amountCents, rollover: values.rollover },
    });
  refresh();
  return { ok: true };
}

export async function deleteBudgetAction(id: string): Promise<Result> {
  await requireUnlocked();
  await getDb()
    .delete(schema.budget)
    .where(eq(schema.budget.id, uuid.parse(id)));
  refresh();
  return { ok: true };
}

/** Copia os orçamentos do mês anterior para o mês informado (sem sobrescrever os que já existem). */
export async function copyBudgetsAction(month: string): Promise<Result<{ copied: number }>> {
  await requireUnlocked();
  const m = z
    .string()
    .regex(/^\d{4}-\d{2}-01$/)
    .parse(month);
  const r = await getDb().execute(sql`
    insert into ${schema.budget} (id, category_id, month, amount_cents, rollover)
    select gen_random_uuid(), category_id, ${m}::date, amount_cents, rollover from ${schema.budget}
    where month = (${m}::date - interval '1 month')::date
    on conflict (category_id, month) do nothing`);
  refresh();
  return { ok: true, data: { copied: (r as { rowCount?: number }).rowCount ?? 0 } };
}
