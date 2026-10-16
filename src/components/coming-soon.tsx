import { Hourglass } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';

export function ComingSoon({
  title,
  phase,
  description,
}: {
  title: string;
  phase: number;
  description: string;
}) {
  return (
    <>
      <PageHeader title={title} />
      <Card className="flex flex-col items-start gap-3 p-8">
        <Hourglass className="size-7 text-ink-2" aria-hidden="true" />
        <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-extrabold text-ink-2">
          Fase {phase}
        </span>
        <p className="max-w-prose text-ink-2">{description}</p>
      </Card>
    </>
  );
}
