'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useState, useTransition } from 'react';
import { FormError } from '@/components/auth/form-error';
import { Money } from '@/components/money';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { cltNet } from '@/domain/tax/clt';
import { pjNet, type PjRegime } from '@/domain/tax/pj';
import type { TaxTables } from '@/domain/tax/tables';
import {
  addIncomeEventAction,
  addSalaryChangeAction,
  addThirteenthAction,
  deleteIncomeEventAction,
  deleteIncomeSourceAction,
  saveIncomeSourceAction,
} from '../previsao/actions';

const selectCls =
  'min-h-12 w-full rounded-xl border border-border-strong bg-surface px-3 text-[15px] font-semibold text-ink';

export type IncomeDefaults = {
  id?: string;
  name?: string;
  type?: 'clt' | 'pj' | 'other';
  employerName?: string | null;
  matchPattern?: string | null;
  accountId?: string | null;
  startDate?: string;
  endDate?: string | null;
  gross?: number;
  ruleType?: 'nth_business_day' | 'fixed_day' | 'last_business_day';
  ruleN?: number;
  monthOffset?: number;
  saturday?: boolean;
  advancePct?: number | null;
  advanceDay?: number | null;
  dependents?: number;
  alimony?: number | null;
  privatePension?: number | null;
  transportVoucher?: number | null;
  health?: number | null;
  meal?: number | null;
  otherDeduction?: number | null;
  regime?: PjRegime;
  simplesAnnex?: 'iii' | 'v' | 'fator_r';
  rbt12?: number | null;
  issRate?: number | null;
  manualRate?: number | null;
  proLabore?: number | null;
  monthlyCosts?: number | null;
  forecastMode?: 'calculated' | 'calibrated';
  prorate?: boolean;
};

const money = (c: number | null | undefined) => (c != null ? (c / 100).toFixed(2) : '');

function MoneyInput({
  name,
  label,
  value,
  hint,
  required,
}: {
  name: string;
  label: string;
  value?: number | null;
  hint?: string;
  required?: boolean;
}) {
  const id = `inc-${name}`;
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input
        id={id}
        name={name}
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        defaultValue={money(value)}
        required={required}
      />
    </Field>
  );
}

export function IncomeForm({
  defaults = {},
  accounts,
  today,
  onDone,
}: {
  defaults?: IncomeDefaults;
  accounts: { id: string; name: string; kind: string }[];
  today: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveIncomeSourceAction, undefined);
  const [type, setType] = useState(defaults.type ?? 'clt');
  const [ruleType, setRuleType] = useState(defaults.ruleType ?? 'nth_business_day');
  const [regime, setRegime] = useState<PjRegime>(defaults.regime ?? 'simples');
  useEffect(() => {
    if (state?.ok) {
      onDone?.();
      router.refresh();
    }
  }, [state, onDone, router]);
  const p = defaults.id ?? 'new';
  return (
    <form
      action={action}
      className="flex flex-col gap-4"
      aria-label={defaults.id ? `Editar ${defaults.name}` : 'Nova fonte de renda'}
    >
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Nome" htmlFor={`${p}-name`}>
          <Input
            id={`${p}-name`}
            name="name"
            defaultValue={defaults.name}
            required
            placeholder="Ex.: Salário Empresa X"
          />
        </Field>
        <Field label="Tipo" htmlFor={`${p}-type`}>
          <select
            id={`${p}-type`}
            name="type"
            className={selectCls}
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            <option value="clt">CLT</option>
            <option value="pj">PJ</option>
            <option value="other">Outra (aluguel, pensão, freela líquido…)</option>
          </select>
        </Field>
        <MoneyInput
          name="gross"
          label={
            type === 'clt'
              ? 'Salário bruto (R$)'
              : type === 'pj'
                ? 'Faturamento mensal (R$)'
                : 'Valor mensal (R$)'
          }
          value={defaults.gross}
          required
        />
        <Field label="Conta onde cai" htmlFor={`${p}-acc`}>
          <select
            id={`${p}-acc`}
            name="accountId"
            className={selectCls}
            defaultValue={defaults.accountId ?? ''}
          >
            <option value="">Qualquer conta</option>
            {accounts
              .filter((a) => a.kind !== 'credit_card')
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </Field>
        <Field
          label="Pagador / empregador"
          htmlFor={`${p}-emp`}
          hint="Como aparece no extrato (ajuda a conciliar)."
        >
          <Input
            id={`${p}-emp`}
            name="employerName"
            defaultValue={defaults.employerName ?? ''}
            placeholder="Ex.: ACME LTDA"
          />
        </Field>
        <Field label="Início" htmlFor={`${p}-start`}>
          <Input
            id={`${p}-start`}
            name="startDate"
            type="date"
            defaultValue={defaults.startDate ?? today}
            required
          />
        </Field>
        <Field label="Fim (opcional)" htmlFor={`${p}-end`}>
          <Input id={`${p}-end`} name="endDate" type="date" defaultValue={defaults.endDate ?? ''} />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-xl border border-border p-3">
        <legend className="px-1 text-[13px] font-bold text-ink-2">Quando é pago</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Regra" htmlFor={`${p}-rule`}>
            <select
              id={`${p}-rule`}
              name="ruleType"
              className={selectCls}
              value={ruleType}
              onChange={(e) => setRuleType(e.target.value as typeof ruleType)}
            >
              <option value="nth_business_day">N-ésimo dia útil</option>
              <option value="fixed_day">Dia fixo</option>
              <option value="last_business_day">Último dia útil</option>
            </select>
          </Field>
          {ruleType !== 'last_business_day' ? (
            <Field
              label={ruleType === 'fixed_day' ? 'Dia do mês' : 'Qual dia útil'}
              htmlFor={`${p}-n`}
            >
              <Input
                id={`${p}-n`}
                name="ruleN"
                type="number"
                min="1"
                max={ruleType === 'fixed_day' ? 31 : 23}
                defaultValue={defaults.ruleN ?? 5}
              />
            </Field>
          ) : null}
          <Field label="Mês do pagamento" htmlFor={`${p}-off`}>
            <select
              id={`${p}-off`}
              name="monthOffset"
              className={selectCls}
              defaultValue={String(defaults.monthOffset ?? (type === 'clt' ? 1 : 0))}
            >
              <option value="1">Mês seguinte ao trabalhado</option>
              <option value="0">No próprio mês</option>
            </select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="saturday"
            className="size-4"
            defaultChecked={defaults.saturday ?? type === 'clt'}
          />
          Sábado conta como dia útil (prazo da CLT); o crédito chega no dia útil bancário anterior
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Adiantamento (% opcional)" htmlFor={`${p}-advp`}>
            <Input
              id={`${p}-advp`}
              name="advancePct"
              type="number"
              min="0"
              max="90"
              defaultValue={defaults.advancePct ?? ''}
            />
          </Field>
          <Field label="Dia do adiantamento" htmlFor={`${p}-advd`}>
            <Input
              id={`${p}-advd`}
              name="advanceDay"
              type="number"
              min="1"
              max="31"
              defaultValue={defaults.advanceDay ?? ''}
            />
          </Field>
        </div>
      </fieldset>

      {type === 'clt' ? (
        <fieldset className="grid grid-cols-1 gap-3 rounded-xl border border-border p-3 sm:grid-cols-3">
          <legend className="px-1 text-[13px] font-bold text-ink-2">Descontos</legend>
          <Field label="Dependentes" htmlFor={`${p}-dep`}>
            <Input
              id={`${p}-dep`}
              name="dependents"
              type="number"
              min="0"
              max="20"
              defaultValue={defaults.dependents ?? 0}
            />
          </Field>
          <MoneyInput
            name="transportVoucher"
            label="Vale-transporte (valor do benefício)"
            value={defaults.transportVoucher}
            hint="Desconto de até 6% do salário."
          />
          <MoneyInput name="health" label="Plano de saúde" value={defaults.health} />
          <MoneyInput name="meal" label="VR/VA (desconto)" value={defaults.meal} />
          <MoneyInput name="alimony" label="Pensão alimentícia" value={defaults.alimony} />
          <MoneyInput
            name="privatePension"
            label="Previdência (PGBL/Funpresp)"
            value={defaults.privatePension}
          />
          <MoneyInput
            name="otherDeduction"
            label="Outros descontos"
            value={defaults.otherDeduction}
          />
        </fieldset>
      ) : null}

      {type === 'pj' ? (
        <fieldset className="grid grid-cols-1 gap-3 rounded-xl border border-border p-3 sm:grid-cols-3">
          <legend className="px-1 text-[13px] font-bold text-ink-2">Empresa</legend>
          <Field label="Regime" htmlFor={`${p}-reg`}>
            <select
              id={`${p}-reg`}
              name="regime"
              className={selectCls}
              value={regime}
              onChange={(e) => setRegime(e.target.value as PjRegime)}
            >
              <option value="mei">MEI</option>
              <option value="simples">Simples Nacional</option>
              <option value="presumido">Lucro Presumido (serviços)</option>
              <option value="manual">Alíquota manual</option>
            </select>
          </Field>
          {regime === 'simples' ? (
            <>
              <Field label="Anexo" htmlFor={`${p}-annex`}>
                <select
                  id={`${p}-annex`}
                  name="simplesAnnex"
                  className={selectCls}
                  defaultValue={defaults.simplesAnnex ?? 'fator_r'}
                >
                  <option value="fator_r">Pelo fator R (III ou V)</option>
                  <option value="iii">Anexo III</option>
                  <option value="v">Anexo V</option>
                </select>
              </Field>
              <MoneyInput
                name="rbt12"
                label="Faturamento 12 meses (RBT12)"
                value={defaults.rbt12}
                hint="Vazio = mensal × 12."
              />
            </>
          ) : null}
          {regime === 'presumido' ? (
            <Field label="ISS (%)" htmlFor={`${p}-iss`}>
              <Input
                id={`${p}-iss`}
                name="issRate"
                type="number"
                min="0"
                max="5"
                step="0.01"
                defaultValue={defaults.issRate ?? 5}
              />
            </Field>
          ) : null}
          {regime === 'manual' ? (
            <Field label="Alíquota total (%)" htmlFor={`${p}-man`}>
              <Input
                id={`${p}-man`}
                name="manualRate"
                type="number"
                min="0"
                max="100"
                step="0.01"
                defaultValue={defaults.manualRate ?? ''}
              />
            </Field>
          ) : null}
          {regime !== 'mei' ? (
            <MoneyInput name="proLabore" label="Pró-labore" value={defaults.proLabore} />
          ) : null}
          <MoneyInput
            name="monthlyCosts"
            label="Custos mensais (contador etc.)"
            value={defaults.monthlyCosts}
          />
        </fieldset>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Previsão"
          htmlFor={`${p}-mode`}
          hint="Calibrada: aprende com o que de fato caiu nos últimos meses."
        >
          <select
            id={`${p}-mode`}
            name="forecastMode"
            className={selectCls}
            defaultValue={defaults.forecastMode ?? 'calculated'}
          >
            <option value="calculated">Calculada (bruto → líquido)</option>
            <option value="calibrated">Calibrada pelo realizado</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 self-end pb-3 text-sm">
          <input
            type="checkbox"
            name="prorate"
            className="size-4"
            defaultChecked={defaults.prorate ?? true}
          />
          Proporcional no 1º mês
        </label>
      </div>
      {state && !state.ok ? <FormError message={state.error} /> : null}
      <Button type="submit" disabled={pending}>
        {defaults.id ? 'Salvar alterações' : 'Adicionar fonte de renda'}
      </Button>
    </form>
  );
}

export function SalaryChangeForm({ sourceId, today }: { sourceId: string; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await addSalaryChangeAction(
            sourceId,
            Number(fd.get('gross')),
            String(fd.get('validFrom')),
          );
          setError(r.ok ? undefined : r.error);
          router.refresh();
        });
      }}
    >
      <Field label="Novo valor (R$)" htmlFor={`raise-${sourceId}`}>
        <Input
          id={`raise-${sourceId}`}
          name="gross"
          type="number"
          min="0"
          step="0.01"
          required
          className="w-36"
        />
      </Field>
      <Field label="Vale a partir de" htmlFor={`raise-from-${sourceId}`}>
        <Input
          id={`raise-from-${sourceId}`}
          name="validFrom"
          type="date"
          defaultValue={today}
          required
          className="w-44"
        />
      </Field>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Registrar reajuste
      </Button>
      {error ? <span className="w-full text-xs font-bold text-danger-ink">{error}</span> : null}
    </form>
  );
}

export function EventForm({
  sourceId,
  type,
  year,
}: {
  sourceId: string;
  type: 'clt' | 'pj' | 'other';
  year: number;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(addIncomeEventAction, undefined);
  const [pending13, start] = useTransition();
  const [kind, setKind] = useState('vacation');
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <div className="flex flex-col gap-3">
      {type === 'clt' ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending13}
          onClick={() =>
            start(async () => (await addThirteenthAction(sourceId, year), router.refresh()))
          }
        >
          Adicionar 13º de {year} (30/11 e 20/12)
        </Button>
      ) : null}
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="sourceId" value={sourceId} />
        <Field label="Evento" htmlFor={`ev-${sourceId}`}>
          <select
            id={`ev-${sourceId}`}
            name="type"
            className={selectCls}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="vacation">Férias</option>
            <option value="plr">PLR</option>
            <option value="bonus">Bônus</option>
            <option value="13_1">13º — 1ª parcela</option>
            <option value="13_2">13º — 2ª parcela</option>
            <option value="other">Outro</option>
          </select>
        </Field>
        <Field label="Data prevista" htmlFor={`evd-${sourceId}`}>
          <Input id={`evd-${sourceId}`} name="expectedDate" type="date" required className="w-44" />
        </Field>
        {kind === 'vacation' ? (
          <Field label="Dias" htmlFor={`evdays-${sourceId}`}>
            <Input
              id={`evdays-${sourceId}`}
              name="vacationDays"
              type="number"
              min="5"
              max="30"
              defaultValue={30}
              className="w-24"
            />
          </Field>
        ) : null}
        {kind === 'plr' || kind === 'other' ? (
          <Field label="Valor líquido (R$)" htmlFor={`evnet-${sourceId}`}>
            <Input
              id={`evnet-${sourceId}`}
              name="net"
              type="number"
              min="0"
              step="0.01"
              className="w-36"
            />
          </Field>
        ) : null}
        {kind === 'bonus' ? (
          <Field label="Bruto (R$)" htmlFor={`evg-${sourceId}`}>
            <Input
              id={`evg-${sourceId}`}
              name="gross"
              type="number"
              min="0"
              step="0.01"
              required
              className="w-36"
            />
          </Field>
        ) : null}
        <Button type="submit" size="sm" disabled={pending}>
          Adicionar
        </Button>
      </form>
      {state && !state.ok ? <FormError message={state.error} /> : null}
    </div>
  );
}

export function DeleteButton({
  kind,
  id,
  label,
}: {
  kind: 'source' | 'event';
  id: string;
  label: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={`Remover ${label}`}
      disabled={pending}
      onClick={() => {
        if (kind === 'source' && !confirm(`Remover "${label}" e todos os previstos dela?`)) return;
        start(async () => {
          await (kind === 'source' ? deleteIncomeSourceAction(id) : deleteIncomeEventAction(id));
          router.refresh();
        });
      }}
    >
      <Trash2 className="size-4" aria-hidden="true" />
    </Button>
  );
}

/** Simulador: o que muda no líquido com outro salário (ou indo para PJ). Tudo calculado no navegador. */
export function SalarySimulator({
  tables,
  currentGross,
}: {
  tables: TaxTables;
  currentGross: number;
}) {
  const [gross, setGross] = useState(String((currentGross || 500000) / 100));
  const [deps, setDeps] = useState('0');
  const [pjRegime, setPjRegime] = useState<PjRegime | ''>('');
  const g = Math.round(Number(gross || 0) * 100);
  const clt = useMemo(
    () => cltNet({ gross: g, dependents: Number(deps) }, tables),
    [g, deps, tables],
  );
  const pj = useMemo(
    () =>
      pjRegime
        ? pjNet(
            g,
            {
              regime: pjRegime,
              proLabore: pjRegime === 'mei' ? 0 : Math.round(g * 0.28),
              dependents: Number(deps),
            },
            tables,
          )
        : null,
    [g, pjRegime, deps, tables],
  );
  const base = currentGross
    ? cltNet({ gross: currentGross, dependents: Number(deps) }, tables).net
    : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Bruto (R$)" htmlFor="sim-gross">
          <Input
            id="sim-gross"
            type="number"
            min="0"
            step="0.01"
            value={gross}
            onChange={(e) => setGross(e.target.value)}
            inputMode="decimal"
          />
        </Field>
        <Field label="Dependentes" htmlFor="sim-deps">
          <Input
            id="sim-deps"
            type="number"
            min="0"
            max="10"
            value={deps}
            onChange={(e) => setDeps(e.target.value)}
          />
        </Field>
        <Field label="Comparar com PJ" htmlFor="sim-pj">
          <select
            id="sim-pj"
            className={selectCls}
            value={pjRegime}
            onChange={(e) => setPjRegime(e.target.value as PjRegime | '')}
          >
            <option value="">—</option>
            <option value="simples">Simples (pró-labore 28%)</option>
            <option value="mei">MEI</option>
            <option value="presumido">Presumido</option>
          </select>
        </Field>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4" aria-live="polite">
        <div>
          <dt className="text-ink-2">INSS</dt>
          <dd className="font-bold">
            <Money cents={clt.inss} />
          </dd>
        </div>
        <div>
          <dt className="text-ink-2">IRRF</dt>
          <dd className="font-bold">
            <Money cents={clt.irrf.irrf} />
          </dd>
        </div>
        <div>
          <dt className="text-ink-2">Líquido CLT</dt>
          <dd className="text-lg font-extrabold" data-testid="sim-net">
            <Money cents={clt.net} />
          </dd>
        </div>
        {base != null ? (
          <div>
            <dt className="text-ink-2">Diferença</dt>
            <dd className="font-bold">
              <Money cents={clt.net - base} signed tone="auto" />
            </dd>
          </div>
        ) : null}
      </dl>
      {clt.irrf.reduction ? (
        <p className="text-xs text-ink-2">
          Inclui a redução da Lei 15.270 de <Money cents={clt.irrf.reduction} /> (
          {clt.irrf.mode === 'legal' ? 'deduções legais' : 'desconto simplificado'}).
        </p>
      ) : null}
      {pj ? (
        <Notice>
          Como PJ ({pjRegime}): impostos da empresa <Money cents={pj.companyTaxes} /> (
          {(pj.effectiveRate * 100).toFixed(1).replace('.', ',')}%), líquido para você{' '}
          <Money cents={pj.net} className="font-bold" />. Sem 13º, férias e FGTS — compare com o
          pacote CLT completo.
        </Notice>
      ) : null}
    </div>
  );
}
