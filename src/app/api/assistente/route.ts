import { z } from 'zod';
import { getCurrentSession } from '@/server/auth/request';
import { runAgentTurn, type AgentEvent } from '@/server/agent/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const bodySchema = z.object({
  conversationId: z.string().uuid().nullable().optional(),
  text: z.string().trim().min(1).max(4000),
});

/** Chat do assistente: responde em NDJSON (um evento por linha) enquanto a IA escreve. */
export async function POST(req: Request) {
  // só aceita chamadas da própria página (além do cookie SameSite=Lax)
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (origin && new URL(origin).host !== host)
    return Response.json({ error: 'origem inválida' }, { status: 403 });

  const session = await getCurrentSession();
  if (!session) return Response.json({ error: 'sessão expirada' }, { status: 401 });
  if (session.locked) return Response.json({ error: 'app bloqueado' }, { status: 423 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'pergunta inválida' }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          // cliente saiu; a resposta continua sendo gravada na conversa
        }
      };
      try {
        await runAgentTurn({
          conversationId: parsed.data.conversationId ?? null,
          text: parsed.data.text,
          emit,
        });
      } catch (e) {
        console.error('[assistente]', e);
        emit({ type: 'error', message: 'Algo deu errado. Tente de novo.' });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
}
