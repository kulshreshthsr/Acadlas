// Who is allowed where.
//
// There are four states a person can be in, and every entry into the app resolves
// to one of them: signed out, signed in with no school yet, signed in with a school,
// and signed in as a parent. Keeping that decision in one place is what stops a
// half-finished signup from dropping someone on an empty app screen, and a parent on a
// staff screen (or the other way round).
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { authClient, isParentSession, useSession } from '../lib/auth-client';
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

/** The connection or the API is down. Nothing is assumed about who is signed in. */
function CannotReach({ retry }: { retry: () => void }) {
  return (
    <div data-surface="dark" className="grid min-h-svh place-items-center bg-night px-6">
      <div className="rise flex max-w-xs flex-col items-center gap-3 text-center">
        <Wordmark tone="light" className="h-6" />
        <h1 className="mt-3 text-[1.375rem] text-white">Can’t reach Acadlas</h1>
        <p className="text-[0.9375rem] text-slate-400">Check your internet connection, then try again.</p>
        <button type="button" className="btn btn-sun mt-2" onClick={retry}>
          Try again
        </button>
      </div>
    </div>
  );
}

/** Wraps screens that need a signed-in member of school staff. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: session, isPending, error, refetch } = useSession();
  const location = useLocation();

  if (isPending) return <Checking label="Checking your session" />;
  // No answer at all is not the same as "signed out": say so, rather than sending a
  // signed-in parent or teacher to the sign-in page because their signal dropped.
  if (!session && error) return <CannotReach retry={() => refetch()} />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (isParentSession(session)) return <Navigate to="/parent" replace />;

  return <>{children}</>;
}

/** Wraps sign-in and sign-up, so a signed-in person is not shown them again. */
export function RequireGuest({ children }: { children: ReactNode }) {
  const { data: session, isPending, error, refetch } = useSession();

  if (isPending) return <Checking label="Checking your session" />;
  // No answer at all is not the same as "signed out": say so, rather than sending a
  // signed-in parent or teacher to the sign-in page because their signal dropped.
  if (!session && error) return <CannotReach retry={() => refetch()} />;
  if (session) return <Navigate to="/" replace />;

  return <>{children}</>;
}

/** Wraps the parent app's screens. */
export function RequireParent({ children }: { children: ReactNode }) {
  const { data: session, isPending, error, refetch } = useSession();

  if (isPending) return <Checking label="Checking your session" />;
  // No answer at all is not the same as "signed out": say so, rather than sending a
  // signed-in parent or teacher to the sign-in page because their signal dropped.
  if (!session && error) return <CannotReach retry={() => refetch()} />;
  if (!session) return <Navigate to="/parent/login" replace />;
  if (!isParentSession(session)) return <Navigate to="/" replace />;

  return <>{children}</>;
}

/** The "/" route: sends each person to whichever of the four states they are in. */
export function RouteHome() {
  const { data: session, isPending, error, refetch } = useSession();

  if (isPending) return <Checking label="Checking your session" />;
  // No answer at all is not the same as "signed out": say so, rather than sending a
  // signed-in parent or teacher to the sign-in page because their signal dropped.
  if (!session && error) return <CannotReach retry={() => refetch()} />;
  if (!session) return <Navigate to="/login" replace />;
  if (isParentSession(session)) return <Navigate to="/parent" replace />;

  return <RouteHomeSignedIn />;
}

// Split out so the school lookup only runs for someone who is actually signed in.
function RouteHomeSignedIn() {
  const { data: organizations, isPending } = authClient.useListOrganizations();

  if (isPending) return <Checking label="Opening your school" />;
  if (!organizations || organizations.length === 0) return <Navigate to="/new-school" replace />;

  return <Navigate to="/app" replace />;
}
