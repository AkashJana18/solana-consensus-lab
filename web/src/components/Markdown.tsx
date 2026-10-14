import { parseMarkdown, type Inline } from '../lessons/markdown';

function Inlines({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((x, i) => {
        switch (x.kind) {
          case 'bold':
            return <strong key={i}>{x.text}</strong>;
          case 'code':
            return <code key={i}>{x.text}</code>;
          case 'link':
            return (
              <a key={i} href={x.href} target="_blank" rel="noreferrer">
                {x.text}
              </a>
            );
          default:
            return <span key={i}>{x.text}</span>;
        }
      })}
    </>
  );
}

/** Renders the markdown subset used by lesson copy (see lessons/markdown.ts). */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className={`md ${className ?? ''}`}>
      {blocks.map((b, i) => {
        if (b.kind === 'h') return <h4 key={i}><Inlines inlines={b.inlines} /></h4>;
        if (b.kind === 'ul')
          return (
            <ul key={i}>
              {b.items.map((it, j) => (
                <li key={j}>
                  <Inlines inlines={it} />
                </li>
              ))}
            </ul>
          );
        if (b.kind === 'table')
          return (
            <table key={i}>
              <thead>
                <tr>
                  {b.head.map((cell, j) => (
                    <th key={j} scope="col"><Inlines inlines={cell} /></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, j) => (
                  <tr key={j}>
                    {row.map((cell, k) => (
                      <td key={k}><Inlines inlines={cell} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        return (
          <p key={i}>
            <Inlines inlines={b.inlines} />
          </p>
        );
      })}
    </div>
  );
}
