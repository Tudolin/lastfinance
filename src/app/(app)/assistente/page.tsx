import { Bot } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { Card, Notice } from '@/components/ui/card';
import { env } from '@/lib/env';
import { assistantSpendMicros, getConversation, listConversations } from '@/server/agent/run';
import { ChatClient, ConversationActions } from './chat-client';

export const metadata = { title: 'Assistente' };

export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const id = c && /^[0-9a-f-]{36}$/i.test(c) ? c : null;
  const [conversations, current, spent] = await Promise.all([
    listConversations(),
    id ? getConversation(id) : null,
    assistantSpendMicros(),
  ]);
  const e = env();
  const enabled = e.AI_FAKE || !!e.ANTHROPIC_API_KEY;
  const budget = e.AGENT_MONTHLY_BUDGET_USD;
  return (
    <>
      <PageHeader title="Assistente" kicker="Pergunte sobre o seu dinheiro" />
      {!enabled ? (
        <Notice tone="warn">
          Para ativar o assistente, cadastre a variável ANTHROPIC_API_KEY na Vercel e faça um novo
          deploy.
        </Notice>
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
        <Card className="flex flex-col gap-1 p-3 lg:self-start" aria-label="Conversas">
          <Link
            href="/assistente"
            className="flex min-h-10 items-center gap-2 rounded-lg px-2 font-bold no-underline hover:bg-surface-2"
          >
            <Bot className="size-4" aria-hidden="true" /> Nova conversa
          </Link>
          {conversations.length > 0 ? (
            <ul className="flex max-h-56 flex-col overflow-y-auto lg:max-h-[60vh]">
              {conversations.map((cv) => (
                <li key={cv.id}>
                  <Link
                    href={`/assistente?c=${cv.id}`}
                    className={`block truncate rounded-lg px-2 py-2 text-sm no-underline hover:bg-surface-2 ${
                      cv.id === current?.conversation.id
                        ? 'bg-surface-2 font-bold text-ink'
                        : 'text-ink-2'
                    }`}
                  >
                    {cv.title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <ConversationActions
            currentId={current?.conversation.id ?? null}
            hasAny={conversations.length > 0}
          />
        </Card>
        <ChatClient
          key={current?.conversation.id ?? 'nova'}
          conversationId={current?.conversation.id ?? null}
          initial={current?.items ?? []}
          disabled={!enabled}
        />
      </div>
      <p className="text-xs text-ink-2">
        As respostas usam só os números calculados pelo app. Gasto do assistente neste mês: US${' '}
        {(spent / 1e6).toFixed(2)} de US$ {budget.toFixed(2)}.
      </p>
    </>
  );
}
