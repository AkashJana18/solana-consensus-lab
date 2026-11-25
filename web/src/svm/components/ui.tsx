import type { ReactNode } from 'react';

export function Panel({
  title,
  kicker,
  right,
  children,
  className = '',
}: {
  title: string;
  kicker?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`svm-panel ${className}`}>
      <header className="svm-panel-head">
        <div>
          <h2>{title}</h2>
          {kicker ? <p>{kicker}</p> : null}
        </div>
        {right}
      </header>
      <div className="svm-panel-body">{children}</div>
    </section>
  );
}

export function Badge({
  tone = 'muted',
  children,
}: {
  tone?: 'muted' | 'good' | 'warn' | 'bad' | 'accent';
  children: ReactNode;
}) {
  return <span className={`svm-badge ${tone}`}>{children}</span>;
}

export function Segmented({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <div className="svm-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'on' : ''}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Bar({ pct, tone = 'accent' }: { pct: number; tone?: 'accent' | 'warn' | 'bad' | 'good' }) {
  return (
    <div className="svm-bar" aria-hidden="true">
      <i className={tone} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}
