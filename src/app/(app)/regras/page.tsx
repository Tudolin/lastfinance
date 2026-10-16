import { PageHeader } from '@/components/shell/page-header';
import { labelFor } from '@/components/categories/category-select';
import { Card, CardTitle } from '@/components/ui/card';
import { TX_KIND_LABEL, type TxKind } from '@/domain/classification/types';
import { dateTimeBR } from '@/lib/format';
import { getCategories, getRules } from '@/server/queries/categories';
import { listAccountsForFilter } from '@/server/queries/transactions';
import { NewRuleForm, RuleActions } from './rules-client';

export const metadata = { title: 'Regras' };

type Cond = {
  descriptionContains?: string[];
  descriptionRegex?: string;
  direction?: string;
  accountIds?: string[];
};
type Act = { categoryId?: string; kind?: TxKind; tags?: string[] };

export default async function RulesPage() {
  const [rules, categories, accounts] = await Promise.all([
    getRules(),
    getCategories(),
    listAccountsForFilter(),
  ]);
  return (
    <>
      <PageHeader title="Regras" />
      <p className="-mt-2 text-sm text-ink-2">
        As regras rodam antes da IA, na ordem de prioridade. Suas correções na revisão também viram
        regras (origem “correção”).
      </p>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="flex flex-col py-2 lg:col-span-2">
          {rules.length === 0 ? (
            <p className="py-4 text-sm text-ink-2">Nenhuma regra ainda.</p>
          ) : null}
          {rules.map((r) => {
            const c = r.conditions as Cond;
            const a = r.actions as Act;
            const when = [
              c.descriptionContains?.length
                ? `contém “${c.descriptionContains.join('” ou “')}”`
                : null,
              c.descriptionRegex ? `regex /${c.descriptionRegex}/` : null,
              c.direction ? (c.direction === 'in' ? 'entrada' : 'saída') : null,
              c.accountIds?.length
                ? accounts
                    .filter((x) => c.accountIds!.includes(x.id))
                    .map((x) => `${x.institution} ${x.name}`)
                    .join(', ')
                : null,
            ].filter(Boolean);
            const then = [
              labelFor(a.categoryId, categories),
              a.kind ? TX_KIND_LABEL[a.kind] : null,
              a.tags?.length ? a.tags.map((t) => `#${t}`).join(' ') : null,
            ].filter(Boolean);
            return (
              <div
                key={r.id}
                className={`flex flex-wrap items-center gap-3 border-t border-surface-2 py-3 first:border-t-0 ${r.enabled ? '' : 'opacity-60'}`}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-bold">
                    {r.name}
                    {r.origin === 'correction' ? (
                      <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-bold text-ink-2">
                        correção
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-ink-2">
                    Se {when.join(' e ')} → {then.join(' · ')}
                  </span>
                  <span className="text-[11px] text-ink-3">
                    prioridade {r.priority} · usada {r.hits}×{' '}
                    {r.lastHitAt ? `· última ${dateTimeBR(r.lastHitAt)}` : ''}
                  </span>
                </div>
                <RuleActions id={r.id} enabled={r.enabled} />
              </div>
            );
          })}
        </Card>
        <Card className="flex flex-col gap-3">
          <CardTitle>Nova regra</CardTitle>
          <NewRuleForm
            categories={categories}
            accounts={accounts.map((a) => ({ id: a.id, label: `${a.institution} · ${a.name}` }))}
          />
        </Card>
      </div>
    </>
  );
}
