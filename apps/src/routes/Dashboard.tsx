// The first screen inside Acadlas. It is deliberately a foundation rather than a
// dashboard: it confirms which school the session is working in, who you are in
// it, and lets you switch schools — the three things every product built on this
// platform will depend on. Product screens get added around it.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Wordmark } from './../components/Wordmark';
import { Spinner } from '../components/SubmitButton';
import { authClient, signOut, useSession } from '../lib/auth-client';

export function Dashboard() {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const { data: activeOrganization } = authClient.useActiveOrganization();
  const { data: organizations } = authClient.useListOrganizations();
  const { data: activeMember } = authClient.useActiveMember();
  const [switching, setSwitching] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSwitch(organizationId: string) {
    if (organizationId === activeOrganization?.id) return;
    setSwitching(true);
    await authClient.organization.setActive({ organizationId });
    setSwitching(false);
  }

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    navigate('/login', { replace: true });
  }

  const schools = organizations ?? [];

  return (
    <div className="min-h-svh">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4 sm:px-8">
          <Wordmark className="h-6" />

          {schools.length > 1 && (
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="school-switcher">
                School
              </label>
              <select
                id="school-switcher"
                className="input min-h-10 w-auto py-1.5 pr-8 text-[0.9375rem]"
                value={activeOrganization?.id ?? ''}
                disabled={switching}
                onChange={(event) => handleSwitch(event.target.value)}
              >
                {schools.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                  </option>
                ))}
              </select>
              {switching && <Spinner />}
            </div>
          )}

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-[0.9375rem] text-slate-500 sm:inline">
              {session?.user.email}
            </span>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={handleSignOut}
              disabled={signingOut}
              aria-busy={signingOut}
            >
              {signingOut ? 'Signing out' : 'Sign out'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
        <h1>{activeOrganization?.name ?? 'Your school'}</h1>

        <p className="lead mt-3 max-w-xl">
          This school is set up and ready. Everything recorded in Acadlas from here
          belongs to it, and only people invited to it can see any of it.
        </p>

        {/* One record, four of its fields — so it reads as a record rather than as
            four unrelated tiles. */}
        <dl className="panel mt-10 divide-y divide-slate-200">
          <Detail label="School" value={activeOrganization?.name ?? '—'} />
          <Detail label="Short name" value={activeOrganization?.slug ?? '—'} />
          <Detail label="Your role" value={formatRole(activeMember?.role)} />
          <Detail label="Signed in as" value={session?.user.email ?? '—'} />
        </dl>

        <div className="panel mt-8 p-6 sm:p-7">
          <h2>What comes next</h2>
          <p className="mt-2.5 max-w-xl">
            Acadlas School — students, staff, attendance and fees — is being built on
            this foundation. Inviting your colleagues needs email delivery, which is
            not connected yet.
          </p>

          <Link className="btn btn-line mt-5" to="/new-school">
            Add another school
          </Link>
        </div>
      </main>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 px-5 py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-baseline sm:gap-4 sm:px-6">
      <dt className="text-[0.9375rem] font-semibold text-slate-500">{label}</dt>
      <dd className="m-0 font-semibold text-ink-800">{value}</dd>
    </div>
  );
}

function formatRole(role?: string | null): string {
  if (!role) return '—';
  return role.charAt(0).toUpperCase() + role.slice(1);
}
