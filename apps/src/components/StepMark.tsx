// Setting up a school really is a two-step sequence, so it gets a counter. It tells
// someone mid-signup how much is left, which is the one question a signup form
// cannot otherwise answer.
export function StepMark({ step, of }: { step: number; of: number }) {
  return (
    <p className="flex items-center gap-2.5 text-sm font-semibold text-slate-500">
      <span className="flex gap-1" aria-hidden="true">
        {Array.from({ length: of }, (_, index) => (
          <span
            key={index}
            className={`h-1 w-6 rounded-sm ${index < step ? 'bg-marigold-500' : 'bg-slate-300'}`}
          />
        ))}
      </span>
      Step {step} of {of}
    </p>
  );
}
