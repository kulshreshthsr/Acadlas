// Who is allowed where.
//
// There are three states a person can be in, and every entry into the app resolves
// to one of them: signed out, signed in with no school yet, and signed in with a
// school. Keeping that decision in one place is what stops a half-finished signup
// from dropping someone on an empty app screen.
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { authClient, useSession } from '../lib/auth-client';
import { Wordmark } from '../components/Wordmark';

/** Shown only while the session is being checked, which is normally a few hundred milliseconds. */
export function Checking({ label }: { label: string }) {
  return (
    <div data-surface="dark" className="grid min-h-svh place-items-center bg-night px-6">
      <div className="rise flex flex-col items-center gap-3.5" style={{ '--d': '200ms' } as React.CSSProperties}>
        <Wordmark tone="light" className="h-6" />
        <p className="flex items-center gap-2 text-[0.875rem] text-slate-400">
          <span className="size-1.5 animate-pulse rounded-full bg-marigold-400" />
          {label}
        </p>
      </div>
    </div>
  );
}

/** Wraps screens that need a signed-in person. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();
  const location = useLocation();

  if (isPending) return <Checking label="Checking your session" />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return <>{children}</>;
}

/** Wraps sign-in and sign-up, so a signed-in person is not shown them again. */
export function RequireGuest({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();

  if (isPending) return <Checking label="Checking your session" />;
  if (session) return <Navigate to="/" replace />;

  return <>{children}</>;
}

/** The "/" route: sends each person to whichever of the three states they are in. */
export function RouteHome() {
  const { data: session, isPending } = useSession();

  if (isPending) return <Checking label="Checking your session" />;
  if (!session) return <Navigate to="/login" replace />;

  return <RouteHomeSignedIn />;
}

// Split out so the school lookup only runs for someone who is actually signed in.
function RouteHomeSignedIn() {
  const { data: organizations, isPending } = authClient.useListOrganizations();

  if (isPending) return <Checking label="Opening your school" />;
  if (!organizations || organizations.length === 0) return <Navigate to="/new-school" replace />;

  return <Navigate to="/app" replace />;
}
