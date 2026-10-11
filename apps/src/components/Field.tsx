// A labelled text input. The error text, the `aria-invalid` flag that colours the
// border, and the `aria-describedby` link a screen reader follows are all derived
// from one `error` prop, so a field can never look wrong while reading as fine.
import type { InputHTMLAttributes, ReactNode } from 'react';

type FieldProps = {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'>;

export function Field({ id, label, hint, error, ...inputProps }: FieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  return (
    <div>
      <label className="input-label" htmlFor={id}>
        {label}
      </label>

      <input
        {...inputProps}
        id={id}
        className="input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
      />

      {hint && !error && (
        <p className="input-hint" id={hintId}>
          {hint}
        </p>
      )}

      {error && (
        <p className="input-error" id={errorId}>
          <ErrorMark />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

export function ErrorMark() {
  return (
    <svg
      aria-hidden="true"
      className="mt-[0.15rem] size-4 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <circle cx="8" cy="8" r="6.4" />
      <path d="M8 4.8v3.8" />
      <path d="M8 11.1h.01" />
    </svg>
  );
}
