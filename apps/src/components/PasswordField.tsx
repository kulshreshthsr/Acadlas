// A password input with a reveal toggle and, when creating an account, a strength
// reading. The strength reading never blocks anyone — it describes the password
// they have rather than demanding a shape (no "must contain a symbol" theatre).
import { useId, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { ErrorMark } from './Field';

type PasswordFieldProps = {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  showStrength?: boolean;
  value: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className' | 'type' | 'value'>;

const levels = [
  { label: 'Too short', color: 'bg-coral-500', text: 'text-coral-700', filled: 1 },
  { label: 'Weak', color: 'bg-marigold-500', text: 'text-marigold-700', filled: 2 },
  { label: 'Good', color: 'bg-lagoon-500', text: 'text-lagoon-700', filled: 3 },
  { label: 'Strong', color: 'bg-lagoon-500', text: 'text-lagoon-700', filled: 4 },
];

/** 0–3, matching the `levels` table above. Length carries most of the weight because it is what actually matters. */
export function scorePassword(value: string): number {
  if (value.length < 8) return 0;

  let variety = 0;
  if (/[a-z]/.test(value)) variety += 1;
  if (/[A-Z]/.test(value)) variety += 1;
  if (/\d/.test(value)) variety += 1;
  if (/[^A-Za-z0-9]/.test(value)) variety += 1;

  if (value.length >= 16 || (value.length >= 12 && variety >= 3)) return 3;
  if (value.length >= 12 || variety >= 3) return 2;
  return 1;
}

export function PasswordField({
  id,
  label,
  error,
  hint,
  showStrength = false,
  value,
  ...inputProps
}: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const strengthId = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const score = scorePassword(value);
  const level = levels[score];
  const showMeter = showStrength && value.length > 0;

  const describedBy = [
    error ? errorId : null,
    hint && !error ? hintId : null,
    showMeter ? strengthId : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div>
      <label className="input-label" htmlFor={id}>
        {label}
      </label>

      <div className="relative">
        <input
          {...inputProps}
          id={id}
          type={revealed ? 'text' : 'password'}
          value={value}
          className="input pr-12"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
        />

        <button
          type="button"
          onClick={() => setRevealed((shown) => !shown)}
          className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-ink-800"
          aria-label={revealed ? 'Hide password' : 'Show password'}
          aria-pressed={revealed}
        >
          <EyeIcon crossed={revealed} />
        </button>
      </div>

      {showMeter && (
        <div className="mt-2.5 flex items-center gap-3" id={strengthId}>
          <div className="flex flex-1 gap-1" aria-hidden="true">
            {[0, 1, 2, 3].map((segment) => (
              <span
                key={segment}
                className={`h-1 flex-1 rounded-sm transition-colors duration-300 ${
                  segment < level.filled ? level.color : 'bg-slate-200'
                }`}
              />
            ))}
          </div>
          <span className={`text-sm font-semibold ${level.text}`} aria-live="polite">
            {level.label}
          </span>
        </div>
      )}

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

function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="size-[1.1rem]"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1.8 10S4.9 4.6 10 4.6 18.2 10 18.2 10 15.1 15.4 10 15.4 1.8 10 1.8 10Z" />
      <circle cx="10" cy="10" r="2.4" />
      {crossed && <path d="M3.4 3.4 16.6 16.6" />}
    </svg>
  );
}
