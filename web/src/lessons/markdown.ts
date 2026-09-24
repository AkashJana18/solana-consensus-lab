// Tiny markdown subset for lesson copy: paragraphs, `## ` headings, `- ` bullets,
// **bold**, `code`, [text](url). Pure parser; rendering lives in components/Markdown.tsx.

export type Inline = { kind: 'text' | 'bold' | 'code'; text: string } | { kind: 'link'; text: string; href: string };

export type Block = { kind: 'p'; inlines: Inline[] } | { kind: 'h'; inlines: Inline[] } | { kind: 'ul'; items: Inline[][] };

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

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

  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      flushPara();
      flushList();
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
