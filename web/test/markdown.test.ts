import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from '../src/lessons/markdown';

describe('parseInline', () => {
  it('splits bold, code and links out of text', () => {
    expect(parseInline('a **b** `c` [d](https://x.y) e')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'c' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'd', href: 'https://x.y' },
      { kind: 'text', text: ' e' },
    ]);
  });

  it('leaves unsupported syntax as plain text', () => {
    expect(parseInline('*not bold* _nor this_')).toEqual([{ kind: 'text', text: '*not bold* _nor this_' }]);
  });
});

describe('parseMarkdown', () => {
  it('groups lines into paragraphs, headings and bullet lists', () => {
    const src = `First line
continues here.

## A heading

- one
- **two**

Last.`;
    expect(parseMarkdown(src)).toEqual([
      { kind: 'p', inlines: [{ kind: 'text', text: 'First line continues here.' }] },
      { kind: 'h', inlines: [{ kind: 'text', text: 'A heading' }] },
      { kind: 'ul', items: [[{ kind: 'text', text: 'one' }], [{ kind: 'bold', text: 'two' }]] },
      { kind: 'p', inlines: [{ kind: 'text', text: 'Last.' }] },
    ]);
  });

  it('ends a list when a paragraph line follows without a blank line', () => {
    expect(parseMarkdown('- a\nb')).toEqual([
      { kind: 'ul', items: [[{ kind: 'text', text: 'a' }]] },
      { kind: 'p', inlines: [{ kind: 'text', text: 'b' }] },
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n')).toEqual([]);
  });
});
