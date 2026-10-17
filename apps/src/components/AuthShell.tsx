// The page every signed-out screen sits in: the website's navy, its drifting
// contours and its floating pill nav, with the form on a white sheet — the same
// white card the hero uses for a student record.
//
// A stage (the record constellation) takes the right half on large screens during
// onboarding. Signing in passes none: someone coming back wants the shortest path
// to their school, not the pitch again.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ContourField } from './ContourField';
import { Wordmark } from './Wordmark';
import { Icon } from './Icon';
import type { IconName } from '../lib/icons';

type AuthShellProps = {
  children: ReactNode;
  stage?: ReactNode;
  /** Shown on the right of the nav, e.g. a link to the other side of signup. */
  navAction: { prompt: string; label: string; to: string };
  /** The strip of what Acadlas School covers. Parents get the screen without it. */
  covers?: boolean;
};

const covers: { icon: IconName; label: string }[] = [
  { icon: 'admission', label: 'Admissions' },
  { icon: 'classes', label: 'Classes' },
  { icon: 'attendance', label: 'Attendance' },
  { icon: 'fees', label: 'Fees' },
  { icon: 'staff', label: 'Staff' },
];

export function AuthShell({ children, stage, navAction, covers: showCovers = true }: AuthShellProps) {
  return (
    <div data-surface="dark" className="relative flex min-h-svh flex-col">
      <ContourField />

      <header className="relative z-10 pt-4 sm:pt-5">
        <div className="wrap">
          <nav className="flex items-center justify-between gap-4 rounded-full border border-white/10 bg-ink-950/70 py-2.5 pl-5 pr-2.5 backdrop-blur-md">
            <Link to="/" className="shrink-0">
              <Wordmark tone="light" className="h-5 sm:h-[1.4rem]" />
            </Link>
            <div className="flex items-center gap-3">
              <span className="hidden text-[0.875rem] text-slate-400 sm:inline">{navAction.prompt}</span>
              <Link className="btn btn-ghost min-h-[2.375rem] px-4 text-[0.875rem]" to={navAction.to}>
                {navAction.label}
              </Link>
            </div>
          </nav>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center py-8 sm:py-10">
        <div className="wrap">
          <div
            className={
              stage
                ? 'grid items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-14'
                : 'flex justify-center'
            }
          >
            <div className={stage ? 'mx-auto w-full max-w-[26rem] lg:mx-0' : 'w-full max-w-[26rem]'}>
              <div className="sheet rise p-6 sm:p-7" style={{ '--d': '60ms' } as React.CSSProperties}>
                {children}
              </div>
            </div>

            {stage && <div className="hidden lg:block">{stage}</div>}
          </div>
        </div>
      </main>

      {/* The same strip the website runs under its hero. */}
      {showCovers && (
      <footer className="relative z-10 border-t border-white/10">
        <div className="wrap flex flex-wrap items-center justify-center gap-x-7 gap-y-2 py-4 text-[0.8125rem] text-slate-400 lg:justify-between">
          <span className="hidden font-medium text-slate-300 lg:inline">Acadlas School covers:</span>
          {covers.map((item) => (
            <span key={item.label} className="flex items-center gap-2">
              <Icon name={item.icon} size={15} className="text-lagoon-300" />
              {item.label}
            </span>
          ))}
        </div>
      </footer>
      )}
    </div>
  );
}
