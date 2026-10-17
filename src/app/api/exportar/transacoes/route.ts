import { z } from 'zod';
import { TX_KIND_LABEL } from '@/domain/classification/types';
import { isLocalDate, type LocalDate } from '@/domain/dates/local-date';
import { csvDate, csvMoney, toCsv } from '@/domain/export/csv';
import { getCurrentSession } from '@/server/auth/request';
import { exportTransactions } from '@/server/queries/reports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const day = z.string().refine((s) => isLocalDate(s), 'data inválida');
const querySchema = z
  .object({
    from: day,
    to: day,
    basis: z.enum(['cash', 'accrual']).default('accrual'),
  })
  .refine((q) => q.from <= q.to, 'período inválido');

/** Exporta as transações do período em CSV (abre direto no Excel/Planilhas em português). */
export async function GET(req: Request) {
  const session = await getCurrentSession();
  if (!session) return Response.json({ error: 'sessão expirada' }, { status: 401 });
  if (session.locked) return Response.json({ error: 'app bloqueado' }, { status: 423 });

  const url = new URL(req.url);
  const q = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!q.success) return Response.json({ error: 'período inválido' }, { status: 400 });
  const { from, to, basis } = q.data;

  const rows = await exportTransactions(from as LocalDate, to as LocalDate, basis);
  const csv = toCsv(
    [
      basis === 'cash' ? 'Data (caixa)' : 'Data',
      'Data da compra',
      'Descrição',
      'Valor',
      'Tipo',
      'Categoria',
      'Conta',
      'Parcela',
      'Situação',
      'Observações',
      'Tags',
    ],
    rows.map((r) => [
      csvDate(r.date),
      csvDate(r.purchaseDate),
      r.description,
      csvMoney(r.amountCents),
      TX_KIND_LABEL[r.kind],
      r.category,
      r.accountName,
      r.installmentTotal ? `${r.installmentNumber}/${r.installmentTotal}` : '',
      r.status === 'PENDING' ? 'pendente' : 'confirmada',
      r.notes,
      r.tags?.join(' '),
    ]),
  );
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="transacoes_${from}_${to}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
