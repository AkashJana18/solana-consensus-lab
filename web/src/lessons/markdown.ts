// Tiny markdown subset for lesson copy: paragraphs, `## ` headings, `- ` bullets,
// **bold**, `code`, [text](url). Pure parser; rendering lives in components/Markdown.tsx.

export type Inline = { kind: 'text' | 'bold' | 'code'; text: string } | { kind: 'link'; text: string; href: string };

export type Block =
  | { kind: 'p'; inlines: Inline[] }
  | { kind: 'h'; inlines: Inline[] }
  | { kind: 'ul'; items: Inline[][] }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][] };

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

/** A GFM alignment cell: `---`, `:--`, `--:` or `:-:`. */
const DELIMITER_CELL = /^:?-+:?$/;

function splitRow(line: string): string[] {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/** True when every cell is an alignment marker, which is what makes row 2 a header rule. */
function isDelimiterRow(line: string): boolean {
  if (!line.startsWith('|')) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => DELIMITER_CELL.test(c));
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of s.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: 'text', text: s.slice(last, idx) });
    const tok = m[0];
    if (tok.startsWith('**')) out.push({ kind: 'bold', text: tok.slice(2, -2) });
    else if (tok.startsWith('`')) out.push({ kind: 'code', text: tok.slice(1, -1) });
    else {
      const close = tok.indexOf('](');
      out.push({ kind: 'link', text: tok.slice(1, close), href: tok.slice(close + 2, -1) });
    }
    last = idx + tok.length;
  }
  if (last < s.length) out.push({ kind: 'text', text: s.slice(last) });
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Inline[][] | null = null;

  const flushPara = () => {
    if (para.length) {
      blocks.push({ kind: 'p', inlines: parseInline(para.join(' ')) });
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ kind: 'ul', items: list });
      list = null;
    }
  };

  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') {
      flushPara();
      flushList();
    } else if (line.startsWith('|')) {
      flushPara();
      flushList();
      // A pipe line with no header rule under it is not a table. Keep it as prose rather
      // than dropping it, so a stray pipe in a sentence still reaches the page.
      if (!isDelimiterRow(lines[i + 1]?.trim() ?? '')) {
        para.push(line);
        continue;
      }
      const head = splitRow(line);
      i++; // step over the delimiter row; the loop below indexes from there
      const rows: Inline[][][] = [];
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) {
        i++;
        rows.push(splitRow(lines[i].trim()).map(parseInline));
      }
      blocks.push({ kind: 'table', head: head.map(parseInline), rows });
    } else if (line.startsWith('## ')) {
      flushPara();
      flushList();
      blocks.push({ kind: 'h', inlines: parseInline(line.slice(3)) });
    } else if (line.startsWith('- ')) {
      flushPara();
      (list ??= []).push(parseInline(line.slice(2)));
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}
