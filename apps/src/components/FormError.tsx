// Whole-form failure: the request was made and came back refused. Announced to
// screen readers the moment it appears, because the person's focus is usually
// still on the button they just pressed.
import { ErrorMark } from './Field';

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-md border border-coral-100 bg-coral-50 px-3.5 py-3 text-[0.9375rem] font-medium leading-relaxed text-coral-700"
    >
      <ErrorMark />
      <span>{message}</span>
    </div>
  );
}
