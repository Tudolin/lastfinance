/**
 * Markdown mínimo para as respostas do assistente: títulos, parágrafos, listas, tabelas, negrito e
 * código. Vira uma árvore que o React renderiza — nunca HTML cru.
 */
export type Inline = { text: string; bold?: boolean; code?: boolean };
export type Block =
  | { type: 'heading'; content: Inline[] }
  | { type: 'paragraph'; content: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] };

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    if (m[1] != null) out.push({ text: m[1], bold: true });
    else out.push({ text: m[2]!, code: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => parseInline(c.trim()));

const isTableSep = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const UL = /^\s*[-*•]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: 'paragraph', content: parseInline(para.join(' ')) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ type: 'heading', content: parseInline(h[1]!) });
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]!)) {
      flush();
      const header = cells(line);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) {
        rows.push(cells(lines[i]!));
        i++;
      }
      i--;
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    const ul = UL.exec(line);
    const ol = ul ? null : OL.exec(line);
    if (ul || ol) {
      flush();
      const ordered = !!ol;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = (ordered ? OL : UL).exec(lines[i]!);
        if (!m) break;
        items.push(parseInline(m[1]!));
        i++;
      }
      i--;
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}
