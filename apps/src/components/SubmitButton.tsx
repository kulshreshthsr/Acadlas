// The one primary action on a screen. While the request is in flight the button
// keeps its own width and says what is happening rather than swapping to a bare
// spinner, so the layout never jumps and the label never goes quiet.
import type { ReactNode } from 'react';

type SubmitButtonProps = {
  pending: boolean;
  pendingLabel: string;
  children: ReactNode;
  disabled?: boolean;
};

export function SubmitButton({ pending, pendingLabel, children, disabled }: SubmitButtonProps) {
  return (
    <button type="submit" className="btn btn-sun w-full" disabled={pending || disabled} aria-busy={pending}>
      {pending && <Spinner />}
      {pending ? pendingLabel : children}
    </button>
  );
}

export function Spinner() {
  return (
    <svg aria-hidden="true" className="size-[1.1rem] animate-spin" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path
        d="M18 10a8 8 0 0 0-8-8"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
