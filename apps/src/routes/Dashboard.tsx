// The first screen inside Acadlas. Deliberately a foundation rather than a
// dashboard: it confirms which school the session is working in, who you are in
// it, and lets you switch schools — the three things every product built on this
// platform depends on. Product screens get added around it.
//
// Inside the app the surface turns light: navy is for the way in, paper is for the
// hours of work that follow.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Wordmark } from '../components/Wordmark';
import { Spinner } from '../components/SubmitButton';
import { Icon } from '../components/Icon';
import type { IconName } from '../lib/icons';
import { authClient, signOut, useSession } from '../lib/auth-client';

const upcoming: { icon: IconName; title: string; note: string }[] = [
  { icon: 'admission', title: 'Admissions', note: 'Enrol a student once; the record follows them.' },
  { icon: 'attendance', title: 'Attendance', note: 'Marked in class, totalled for the month.' },
  { icon: 'fees', title: 'Fees', note: 'What is paid, what is due, and the receipt.' },
  { icon: 'staff', title: 'Staff', note: 'Who teaches what, and when.' },
];

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
    try {
      await authClient.organization.setActive({ organizationId });
    } finally {
      setSwitching(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      navigate('/login', { replace: true });
    } finally {
      setSigningOut(false);
    }
  }

  const schools = organizations ?? [];

  return (
    <div className="min-h-svh bg-paper">
      <header data-surface="dark" className="bg-night">
        <div className="wrap max-w-3xl flex flex-wrap items-center gap-x-5 gap-y-3 py-3.5">
          <Wordmark tone="light" className="h-5" />

          {schools.length > 1 && (
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="school-switcher">
                School
              </label>
              <select
                id="school-switcher"
                className="min-h-9 rounded-full border border-white/15 bg-white/5 px-3.5 pr-8 text-[0.875rem] font-semibold text-white backdrop-blur-md"
                value={activeOrganization?.id ?? ''}
                disabled={switching}
                onChange={(event) => handleSwitch(event.target.value)}
              >
                {schools.map((school) => (
                  <option key={school.id} value={school.id} className="text-ink-800">
                    {school.name}
                  </option>
                ))}
              </select>
              {switching && <Spinner />}
            </div>
          )}

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-[0.875rem] text-slate-400 sm:inline">{session?.user.email}</span>
            <button
              type="button"
              className="btn btn-ghost min-h-[2.25rem] px-4 text-[0.875rem]"
              onClick={handleSignOut}
              disabled={signingOut}
              aria-busy={signingOut}
            >
              {signingOut ? 'Signing out' : 'Sign out'}
            </button>
          </div>
        </div>
      </header>

      <main className="wrap max-w-3xl py-10 sm:py-12">
        <div className="rise" style={{ '--d': '40ms' } as React.CSSProperties}>
          <h1>{activeOrganization?.name ?? 'Your school'}</h1>
          <p className="mt-2 max-w-xl text-slate-600">
            Your school is set up. Everything recorded in Acadlas from here belongs to
            it, and only people invited to it can see any of it.
          </p>
        </div>

        {/* One record, four of its fields — so it reads as a record, not four tiles. */}
        <dl className="panel rise mt-7 divide-y divide-slate-200" style={{ '--d': '120ms' } as React.CSSProperties}>
          <Detail label="School" value={activeOrganization?.name ?? '—'} />
          <Detail label="Short name" value={activeOrganization?.slug ?? '—'} />
          <Detail label="Your role" value={formatRole(activeMember?.role)} />
          <Detail label="Signed in as" value={session?.user.email ?? '—'} />
        </dl>

        <section className="rise mt-9" style={{ '--d': '200ms' } as React.CSSProperties}>
          <h2>What comes next</h2>
          <p className="mt-2 max-w-xl text-slate-600">
            Acadlas School is being built on this foundation. Inviting your colleagues
            needs email delivery, which is not connected yet.
          </p>

          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {upcoming.map((item) => (
              <li key={item.title} className="panel flex items-start gap-3 p-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-lagoon-50 text-lagoon-600">
                  <Icon name={item.icon} size={17} />
                </span>
                <span>
                  <h3>{item.title}</h3>
                  <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-slate-500">{item.note}</p>
                </span>
              </li>
            ))}
          </ul>

          <Link className="btn btn-line mt-6" to="/new-school">
            Add another school
          </Link>
        </section>
      </main>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 px-5 py-3.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-baseline sm:gap-4">
      <dt className="text-[0.875rem] font-semibold text-slate-500">{label}</dt>
      <dd className="m-0 font-semibold text-ink-800">{value}</dd>
    </div>
  );
}

function formatRole(role?: string | null): string {
  if (!role) return '—';
  return role.charAt(0).toUpperCase() + role.slice(1);
}
