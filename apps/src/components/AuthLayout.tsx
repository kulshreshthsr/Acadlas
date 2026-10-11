// The shell every signed-out screen sits in.
//
// Onboarding screens pass a stage, which takes the right half on large screens and
// is dropped entirely on small ones — a phone's space belongs to the form. Signing
// in passes no stage at all: someone coming back wants the shortest path to their
// school, not a second look at the pitch.
import type { ReactNode } from 'react';
import { Wordmark } from './Wordmark';

type AuthLayoutProps = {
  children: ReactNode;
  stage?: ReactNode;
};

export function AuthLayout({ children, stage }: AuthLayoutProps) {
  return (
    <div
      className={
        stage
          ? 'min-h-svh lg:grid lg:min-h-svh lg:grid-cols-[minmax(0,1fr)_minmax(0,0.82fr)]'
          : 'min-h-svh'
      }
    >
      {/* Header and form share one column so the wordmark sits on the form's left
          edge instead of drifting to the corner of the window. */}
      <div className="mx-auto flex min-h-svh w-full max-w-[25.5rem] flex-col px-5 py-8 sm:px-0 sm:py-10">
        <header className={stage ? 'lg:hidden' : undefined}>
          <Wordmark className="h-7" />
        </header>

        <main className="flex flex-1 items-center py-10 lg:py-14">
          <div className="w-full">{children}</div>
        </main>
      </div>

      {stage && <div className="hidden lg:block">{stage}</div>}
    </div>
  );
}
