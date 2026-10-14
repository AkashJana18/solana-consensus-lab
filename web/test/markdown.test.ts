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

  // Tables are needed by docs/protocols.md, which build-content.ts renders as a page. Its
  // three tables carry the thresholds and the per-slot flags, so dropping them would leave
  // the published reference quietly incomplete.
  describe('tables', () => {
    it('reads a header, a delimiter row and body rows', () => {
      const src = ['| Stage | Tower |', '|---|---|', '| `submitted` | Same. |', '| `voted` | A vote tx. |'].join('\n');
      expect(parseMarkdown(src)).toEqual([
        {
          kind: 'table',
          head: [
            [{ kind: 'text', text: 'Stage' }],
            [{ kind: 'text', text: 'Tower' }],
          ],
          rows: [
            [
              [{ kind: 'code', text: 'submitted' }],
              [{ kind: 'text', text: 'Same.' }],
            ],
            [
              [{ kind: 'code', text: 'voted' }],
              [{ kind: 'text', text: 'A vote tx.' }],
            ],
          ],
        },
      ]);
    });

    it('accepts alignment colons in the delimiter row', () => {
      expect(parseMarkdown('| a | b |\n|:--|--:|\n| 1 | 2 |')).toHaveLength(1);
    });

    it('keeps a lone pipe line as prose rather than dropping it', () => {
      // No delimiter row underneath, so this is a sentence with a pipe in it, not a table.
      expect(parseMarkdown('Use either a|b c')).toEqual([
        { kind: 'p', inlines: [{ kind: 'text', text: 'Use either a|b c' }] },
      ]);
    });

    it('ends a table at the first line that is not a row', () => {
      const src = ['| a |', '|---|', '| 1 |', '', 'After.'].join('\n');
      expect(parseMarkdown(src)).toEqual([
        { kind: 'table', head: [[{ kind: 'text', text: 'a' }]], rows: [[[{ kind: 'text', text: '1' }]]] },
        { kind: 'p', inlines: [{ kind: 'text', text: 'After.' }] },
      ]);
    });
  });
});
