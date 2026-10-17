'use client';

import { ArrowUp, LoaderCircle, Trash2, Wrench } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Markdown } from '@/components/assistant/markdown';
import { Button } from '@/components/ui/button';
import { Card, Notice } from '@/components/ui/card';
import type { AgentEvent, ChatItem } from '@/server/agent/run';
import { deleteAllConversationsAction, deleteConversationAction } from './actions';

const SUGGESTIONS = [
  'Quanto gastei este mês?',
  'Onde mais gastei no mês passado?',
  'Posso gastar R$ 500 hoje?',
  'Como vai ficar meu saldo até o fim do mês?',
  'Quais são minhas contas fixas?',
  'Onde posso cortar gastos?',
];

export function ChatClient({
  conversationId,
  initial,
  disabled,
}: {
  conversationId: string | null;
  initial: ChatItem[];
  disabled: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<ChatItem[]>(initial);
  const [convId, setConvId] = useState(conversationId);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [items, status]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setError(null);
    setBusy(true);
    setStatus('Pensando…');
    setText('');
    const answerId = `a-${Date.now()}`;
    setItems((cur) => [
      ...cur,
      { kind: 'user', id: `u-${Date.now()}`, text: q },
      { kind: 'assistant', id: answerId, text: '', tools: [] },
    ]);
    const patch = (fn: (a: Extract<ChatItem, { kind: 'assistant' }>) => void) =>
      setItems((cur) =>
        cur.map((it) => {
          if (it.id !== answerId || it.kind !== 'assistant') return it;
          const copy = { ...it, tools: [...it.tools] };
          fn(copy);
          return copy;
        }),
      );
    let newConv: string | null = null;
    try {
      const res = await fetch('/api/assistente', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId: convId, text: q }),
      });
      if (res.status === 401 || res.status === 423) {
        router.refresh();
        throw new Error('Sua sessão expirou ou o app foi bloqueado.');
      }
      if (!res.ok || !res.body) throw new Error('Não consegui falar com o assistente.');
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as AgentEvent;
          if (ev.type === 'conversation') {
            newConv = ev.id;
            setConvId(ev.id);
          } else if (ev.type === 'text') {
            setStatus(null);
            patch((a) => {
              a.text += ev.delta;
            });
          } else if (ev.type === 'tool') {
            setStatus(`${ev.label}…`);
            patch((a) => {
              a.tools.push(ev.label);
              if (a.text && !a.text.endsWith('\n\n')) a.text += '\n\n';
            });
          } else if (ev.type === 'error') setError(ev.message);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setStatus(null);
      setItems((cur) =>
        cur.filter((it) => !(it.id === answerId && it.kind === 'assistant' && !it.text)),
      );
      if (newConv) {
        window.history.replaceState(null, '', `/assistente?c=${newConv}`);
      }
      router.refresh();
    }
  }

  return (
    <Card className="flex min-h-[60vh] flex-col gap-4 p-4" aria-label="Conversa com o assistente">
      <div className="flex flex-1 flex-col gap-4" aria-live="polite">
        {items.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-ink-2">
              Pergunte o que quiser sobre as suas contas, cartões, orçamentos e previsão. Eu
              consulto os dados do app antes de responder.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={disabled || busy}
                  onClick={() => send(s)}
                  className="rounded-full border border-border-strong px-3 py-1.5 text-sm font-semibold hover:bg-surface-2 disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {items.map((it) =>
          it.kind === 'user' ? (
            <div
              key={it.id}
              className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-bg whitespace-pre-wrap"
            >
              {it.text}
            </div>
          ) : (
            <div
              key={it.id}
              className="flex max-w-full flex-col gap-2 self-start"
              data-role="answer"
            >
              {it.tools.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {[...new Set(it.tools)].map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-ink-2"
                    >
                      <Wrench className="size-3" aria-hidden="true" /> {t}
                    </span>
                  ))}
                </div>
              ) : null}
              {it.text ? (
                <div className="money-sensitive">
                  <Markdown text={it.text} />
                </div>
              ) : null}
            </div>
          ),
        )}
        {status ? (
          <div className="flex items-center gap-2 text-sm text-ink-2" role="status">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> {status}
          </div>
        ) : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
        className="flex items-end gap-2 border-t border-surface-2 pt-3"
      >
        <label htmlFor="chat-input" className="sr-only">
          Sua pergunta
        </label>
        <textarea
          id="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(text);
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder="Ex.: quanto gastei com delivery nos últimos 3 meses?"
          disabled={disabled}
          className="max-h-40 min-h-11 flex-1 resize-none rounded-xl border border-border-strong bg-surface px-3 py-2.5 text-[15px] outline-none focus:border-ink"
        />
        <Button
          type="submit"
          size="icon"
          disabled={disabled || busy || !text.trim()}
          aria-label="Enviar"
        >
          {busy ? (
            <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            <ArrowUp className="size-5" aria-hidden="true" />
          )}
        </Button>
      </form>
    </Card>
  );
}

export function ConversationActions({
  currentId,
  hasAny,
}: {
  currentId: string | null;
  hasAny: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!hasAny) return null;
  return (
    <div className="mt-1 flex flex-col gap-1 border-t border-surface-2 pt-2">
      {currentId ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await deleteConversationAction(currentId);
              router.push('/assistente');
            })
          }
          className="justify-start"
        >
          <Trash2 className="size-4" aria-hidden="true" /> Apagar esta conversa
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (!confirm('Apagar todo o histórico do assistente?')) return;
          start(async () => {
            await deleteAllConversationsAction();
            router.push('/assistente');
          });
        }}
        className="justify-start text-danger-ink"
      >
        <Trash2 className="size-4" aria-hidden="true" /> Apagar histórico
      </Button>
    </div>
  );
}
