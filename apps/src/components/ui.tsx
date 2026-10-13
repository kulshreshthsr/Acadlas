// The small pieces every product screen is built from. Kept in one file so the vocabulary
// stays small: if a screen needs something that is not here, it probably needs rethinking
// before it needs a new component.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import type { IconName } from '../lib/icons';
import { ErrorMark } from './Field';
import { Spinner } from './SubmitButton';
import { initials, money } from '../lib/format';
import { ToastContext } from '../lib/toast';

// ---------------------------------------------------------------------------
// Page: the title sits on the masthead's navy, the work on paper below it
// ---------------------------------------------------------------------------

type PageProps = {
  title: ReactNode;
  /** One line under the title — context, never a slogan. */
  lead?: ReactNode;
  /** Small text above the title, e.g. a back link. */
  back?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** Content that sits on the navy just above the paper, like tabs. */
  under?: ReactNode;
  wide?: boolean;
};

export function Page({ title, lead, back, actions, children, under, wide }: PageProps) {
  return (
    <div className="relative z-10 flex flex-1 flex-col">
      <div data-surface="dark" className="no-print">
        <div className={`wrap ${wide ? '' : 'max-w-6xl'} pb-6 pt-6 sm:pb-8 sm:pt-9`}>
          {back && <div className="mb-3 text-[0.8125rem]">{back}</div>}
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="min-w-0">
              <h1 className="text-[1.6rem] sm:text-[2rem]">{title}</h1>
              {lead && <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-slate-300">{lead}</p>}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
          {under && <div className="mt-6">{under}</div>}
        </div>
      </div>
      <div className="sheet-paper print-plain flex-1 pb-28 lg:pb-16">
        <div className={`wrap ${wide ? '' : 'max-w-6xl'} pt-5 sm:pt-7`}>{children}</div>
      </div>
    </div>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 font-semibold text-slate-400 no-underline hover:text-white">
      <Icon name="chevron-left" size={15} />
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Containers and states
// ---------------------------------------------------------------------------

export function Card({ children, className = '', title, action, pad = true, id }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; pad?: boolean; id?: string }) {
  return (
    <section id={id} className={`card scroll-mt-6 ${pad ? '' : 'overflow-hidden'} ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          {typeof title === 'string' ? <h2 className="text-[1rem]">{title}</h2> : title}
          {action}
        </header>
      )}
      <div className={pad ? 'card-pad' : ''}>{children}</div>
    </section>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-lagoon-50 text-lagoon-600">
        <Icon name={icon} size={22} />
      </span>
      <h3 className="mt-4 text-[1.0625rem]">{title}</h3>
      {children && <div className="mt-1.5 max-w-sm text-[0.875rem] text-slate-500">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-coral-100 bg-coral-50 p-4 text-coral-700 sm:flex-row sm:items-center">
      <span className="flex flex-1 items-start gap-2 text-[0.9375rem] font-medium">
        <ErrorMark />
        {message}
      </span>
      {retry && (
        <button type="button" className="btn btn-line btn-sm" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-12" style={{ opacity: 1 - i * 0.18 }} />
      ))}
    </div>
  );
}

export function Notice({ tone = 'info', children, icon }: { tone?: 'info' | 'warn' | 'good'; children: ReactNode; icon?: IconName }) {
  const styles = {
    info: 'bg-cobalt-100/60 text-ink-800 ring-cobalt-100',
    warn: 'bg-marigold-50 text-marigold-700 ring-marigold-100',
    good: 'bg-lagoon-50 text-lagoon-700 ring-lagoon-100',
  }[tone];
  return (
    <div className={`flex items-start gap-2.5 rounded-xl p-3.5 text-[0.875rem] leading-snug ring-1 ${styles}`}>
      <Icon name={icon ?? (tone === 'warn' ? 'alert' : tone === 'good' ? 'check' : 'info')} size={17} className="mt-px shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small facts
// ---------------------------------------------------------------------------

const avatarTones = [
  'bg-marigold-100 text-marigold-700',
  'bg-lagoon-100 text-lagoon-700',
  'bg-cobalt-100 text-cobalt-600',
  'bg-coral-100 text-coral-700',
  'bg-slate-100 text-slate-600',
];

export function Avatar({ name, size = 36, tone }: { name: string; size?: number; tone?: string }) {
  const index = [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % avatarTones.length;
  return (
    <span className={`avatar ${tone ?? avatarTones[index]}`} style={{ width: size, height: size, fontSize: size * 0.36 }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function Money({ paise, className = '' }: { paise: number | null | undefined; className?: string }) {
  return <span className={`money ${className}`}>{money(paise)}</span>;
}

export function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'coral' | 'lagoon' | 'sun' }) {
  const color = tone === 'coral' ? 'text-coral-700' : tone === 'lagoon' ? 'text-lagoon-700' : tone === 'sun' ? 'text-marigold-700' : 'text-ink-800';
  return (
    <div className="min-w-0">
      <p className="text-[0.8125rem] font-semibold text-slate-500">{label}</p>
      <p className={`mt-0.5 text-[1.5rem] font-bold leading-tight tracking-tight ${color}`} style={{ fontStretch: '112%' }}>
        {value}
      </p>
      {note && <p className="mt-0.5 text-[0.8125rem] text-slate-500">{note}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form controls beyond the text input in Field.tsx
// ---------------------------------------------------------------------------

type SelectFieldProps = {
  id?: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'className'>;

export function SelectField({ id, label, error, hint, children, ...rest }: SelectFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div>
      <label className="input-label" htmlFor={fieldId}>
        {label}
      </label>
      <select {...rest} id={fieldId} className="input" aria-invalid={error ? true : undefined}>
        {children}
      </select>
      {hint && !error && <p className="input-hint">{hint}</p>}
      {error && (
        <p className="input-error">
          <ErrorMark />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

type TextAreaFieldProps = {
  id?: string;
  label: string;
  error?: string;
  hint?: ReactNode;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'className'>;

export function TextAreaField({ id, label, error, hint, ...rest }: TextAreaFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div>
      <label className="input-label" htmlFor={fieldId}>
        {label}
      </label>
      <textarea {...rest} id={fieldId} className="input" aria-invalid={error ? true : undefined} />
      {hint && !error && <p className="input-hint">{hint}</p>}
      {error && (
        <p className="input-error">
          <ErrorMark />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

export function CheckRow({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 ${disabled ? 'opacity-60' : 'cursor-pointer hover:border-slate-300'}`}>
      <input type="checkbox" className="check mt-0.5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="block text-[0.9375rem] font-semibold text-ink-800">{label}</span>
        {hint && <span className="mt-0.5 block text-[0.8125rem] leading-snug text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

export function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog — the native element, so focus trapping and Escape come for free
// ---------------------------------------------------------------------------

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
};

export function Dialog({ open, onClose, title, lead, children, footer, wide }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? 'dialog-wide' : ''}`}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="flex max-h-[inherit] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 pb-4 pt-5">
            <div>
              <h2 id={titleId} className="text-[1.125rem]">
                {title}
              </h2>
              {lead && <p className="mt-1 text-[0.875rem] text-slate-500">{lead}</p>}
            </div>
            <button type="button" className="btn btn-quiet btn-icon -mr-2 -mt-1" onClick={onClose} aria-label="Close">
              <Icon name="x" size={18} />
            </button>
          </header>
          <div className="overflow-y-auto px-5 py-5">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3.5">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  danger,
  pending,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" className="btn btn-line btn-sm" onClick={onClose}>
            Keep it
          </button>
          <button type="button" className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-ink'}`} disabled={pending} onClick={onConfirm}>
            {pending && <Spinner />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-[0.9375rem] text-slate-600">{children}</div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Toasts: one line confirming what just happened, bottom of the screen
// ---------------------------------------------------------------------------

type Toast = { id: number; message: ReactNode; tone: 'good' | 'bad' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: ReactNode, tone: 'good' | 'bad' = 'good') => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === 'bad' ? 6500 : 3500);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="no-print pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast-in pointer-events-auto flex max-w-md items-center gap-2.5 rounded-full px-4 py-2.5 text-[0.875rem] font-semibold shadow-lift ${
              t.tone === 'good' ? 'bg-ink-800 text-white' : 'bg-coral-700 text-white'
            }`}
          >
            <Icon name={t.tone === 'good' ? 'check' : 'alert'} size={16} className={t.tone === 'good' ? 'text-lagoon-300' : ''} />
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}


export { Spinner };
