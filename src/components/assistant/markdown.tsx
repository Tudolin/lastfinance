import { Fragment } from 'react';
import { parseMarkdown, type Inline } from '@/domain/text/mini-markdown';

function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.bold ? (
          <strong key={i} className="font-extrabold">
            {p.text}
          </strong>
        ) : p.code ? (
          <code key={i} className="rounded bg-surface-2 px-1 text-[0.9em]">
            {p.text}
          </code>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}

/** Resposta do assistente em markdown simples, renderizada sem HTML cru. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2.5 text-[15px] leading-relaxed">
      {parseMarkdown(text).map((b, i) => {
        if (b.type === 'heading')
          return (
            <h3 key={i} className="text-base font-extrabold">
              <Inlines parts={b.content} />
            </h3>
          );
        if (b.type === 'paragraph')
          return (
            <p key={i}>
              <Inlines parts={b.content} />
            </p>
          );
        if (b.type === 'list') {
          const List = b.ordered ? 'ol' : 'ul';
          return (
            <List
              key={i}
              className={`flex flex-col gap-1 pl-5 ${b.ordered ? 'list-decimal' : 'list-disc'}`}
            >
              {b.items.map((it, j) => (
                <li key={j}>
                  <Inlines parts={it} />
                </li>
              ))}
            </List>
          );
        }
        return (
          <div key={i} className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {b.header.map((h, j) => (
                    <th
                      key={j}
                      className="border-b border-border px-2 py-1.5 text-left font-bold text-ink-2"
                    >
                      <Inlines parts={h} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j}>
                    {r.map((c, k) => (
                      <td key={k} className="border-b border-surface-2 px-2 py-1.5 tabular-nums">
                        <Inlines parts={c} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
