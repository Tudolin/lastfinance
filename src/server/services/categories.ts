import 'server-only';
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { DEFAULT_CATEGORIES } from '@/domain/categorization/defaults';
import { getDb, schema } from '@/server/db/client';

const { category } = schema;

/** Cria as categorias padrão que ainda não existem (idempotente, por slug). */
export async function ensureDefaultCategories() {
  const db = getDb();
  const existing = await db
    .select({ id: category.id, slug: category.slug })
    .from(category)
    .where(isNotNull(category.slug));
  const bySlug = new Map(existing.map((c) => [c.slug!, c.id]));
  let order = 0;
  for (const c of DEFAULT_CATEGORIES.filter((x) => !x.parent)) {
    order += 10;
    if (bySlug.has(c.slug)) continue;
    const [row] = await db
      .insert(category)
      .values({
        slug: c.slug,
        name: c.name,
        kind: c.kind,
        icon: c.icon,
        color: c.color,
        isSystem: true,
        sortOrder: order,
      })
      .onConflictDoNothing({ target: category.slug })
      .returning({ id: category.id });
    if (row) bySlug.set(c.slug, row.id);
  }
  for (const c of DEFAULT_CATEGORIES.filter((x) => x.parent)) {
    order += 1;
    if (bySlug.has(c.slug)) continue;
    await db
      .insert(category)
      .values({
        slug: c.slug,
        name: c.name,
        kind: c.kind,
        parentId: bySlug.get(c.parent!) ?? null,
        isSystem: true,
        sortOrder: order,
      })
      .onConflictDoNothing({ target: category.slug });
  }
}

export type CategoryRow = typeof category.$inferSelect;

export async function listCategories(includeArchived = false): Promise<CategoryRow[]> {
  const db = getDb();
  return db
    .select()
    .from(category)
    .where(includeArchived ? undefined : isNull(category.archivedAt))
    .orderBy(asc(category.sortOrder), asc(category.name));
}

/** Nome completo "Pai › Filha" para exibição. */
export function categoryLabel(c: CategoryRow, all: CategoryRow[]): string {
  const parent = c.parentId ? all.find((p) => p.id === c.parentId) : null;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

export async function categoryBySlug(slug: string) {
  const [c] = await getDb()
    .select()
    .from(category)
    .where(and(eq(category.slug, slug), isNull(category.archivedAt)));
  return c ?? null;
}
