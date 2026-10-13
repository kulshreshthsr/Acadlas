// The frame around every Acadlas School screen.
//
// A navy masthead carries the school's own contour map — drawn from the school's id, so
// every school gets its own terrain, and drawn once so it never moves while people work —
// with the floating pill navigation the website uses. Pages lay their title on that navy
// and their work on paper that rises out of it. On phones, the main jobs move to a tab bar
// at the bottom, where a thumb can reach them.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { authClient, signOut } from '../lib/auth-client';
import { ApiError } from '../lib/api';
import { hashSeed } from '../lib/format';
import { mountContours } from '../lib/contours';
import { SchoolContext, makeSchoolContext, useMeQuery, useSchool } from '../lib/school';
import type { Permission } from '../lib/school';
import type { IconName } from '../lib/icons';
import { Icon } from './Icon';
import { Wordmark } from './Wordmark';
import { Avatar, Dialog } from './ui';
import { Checking } from '../routes/guards';
import { CommandPalette } from './CommandPalette';

type NavItem = { to: string; label: string; icon: IconName; anyOf?: Permission[]; end?: boolean };

const navItems: NavItem[] = [
  { to: '/app', label: 'Today', icon: 'sun', end: true },
  { to: '/app/students', label: 'Students', icon: 'students', anyOf: ['students.view.all', 'students.view.own'] },
  { to: '/app/classes', label: 'Classes', icon: 'classes', anyOf: ['school.manage', 'students.view.all', 'students.view.own'] },
  { to: '/app/attendance', label: 'Attendance', icon: 'attendance', anyOf: ['attendance.view', 'attendance.mark.own', 'attendance.mark.all'] },
  { to: '/app/fees', label: 'Fees', icon: 'fees', anyOf: ['fees.view'] },
  { to: '/app/staff', label: 'Staff', icon: 'staff' },
  { to: '/app/reports', label: 'Reports', icon: 'reports', anyOf: ['reports.academic', 'reports.fees'] },
];

const mobileMain = ['/app', '/app/students', '/app/attendance', '/app/fees'];

export function AppShell() {
  const me = useMeQuery();
  const queryClient = useQueryClient();
  const { data: organizations } = authClient.useListOrganizations();
  const repairStarted = useRef(false);
  const [repairFailed, setRepairFailed] = useState(false);

  // A fresh sign-in has no active school on its session yet. Pick the last one used here
  // (or the first) rather than asking — most people belong to exactly one school.
  const noActiveSchool = me.error instanceof ApiError && (me.error.code === 'NO_ACTIVE_SCHOOL' || me.error.status === 403);
  useEffect(() => {
    if (!noActiveSchool || !organizations || organizations.length === 0 || repairStarted.current) return;
    repairStarted.current = true;
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem('acadlas:school');
    } catch {
      remembered = null;
    }
    const target = organizations.find((o) => o.id === remembered) ?? organizations[0];
    authClient.organization
      .setActive({ organizationId: target.id })
      .then(() => queryClient.invalidateQueries({ queryKey: ['me'] }))
      .catch(() => setRepairFailed(true));
  }, [noActiveSchool, organizations, queryClient]);

  const repairing = noActiveSchool && !repairFailed && (organizations == null || organizations.length > 0);
  if (me.isPending || repairing) return <Checking label="Opening your school" />;
  if (noActiveSchool && organizations && organizations.length === 0) return <Navigate to="/new-school" replace />;
  if (me.error || !me.data) {
    return (
      <div data-surface="dark" className="grid min-h-svh place-items-center bg-night px-6 text-center">
        <div className="max-w-sm">
          <Wordmark tone="light" className="mx-auto h-6" />
          <h1 className="mt-6 text-white">Acadlas could not open your school</h1>
          <p className="mt-2 text-slate-400">{me.error instanceof Error ? me.error.message : 'Try again in a moment.'}</p>
          <button type="button" className="btn btn-sun mt-6" onClick={() => me.refetch()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <SchoolContext.Provider value={makeSchoolContext(me.data)}>
      <ShellFrame />
    </SchoolContext.Provider>
  );
}

function ShellFrame() {
  const school = useSchool();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('acadlas:school', school.school.id);
    } catch {
      /* private window — nothing to remember */
    }
  }, [school.school.id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      const typing = target.closest('input, textarea, select, [contenteditable="true"]');
      if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing)) {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A school that has never been set up goes straight to setup — for whoever can do it.
  if (!school.school.setupCompletedAt && !school.currentYear && school.can('school.manage') && location.pathname !== '/app/setup') {
    return <Navigate to="/app/setup" replace />;
  }

  const visible = navItems.filter((item) => !item.anyOf || school.can(...item.anyOf));
  const mobileTabs = visible.filter((item) => mobileMain.includes(item.to));
  const mobileMore = visible.filter((item) => !mobileMain.includes(item.to));

  return (
    <div className="relative flex min-h-svh flex-col bg-night">
      <Terrain seed={hashSeed(school.school.id)} />

      <header data-surface="dark" className="no-print relative z-20 pt-3 sm:pt-4">
        <div className="wrap">
          <nav aria-label="Main" className="flex items-center gap-2 rounded-full border border-white/10 bg-ink-950/70 py-2 pl-4 pr-2 backdrop-blur-md sm:gap-3 sm:pl-5">
            <Link to="/app" className="shrink-0" aria-label="Acadlas — Today">
              <Wordmark tone="light" className="h-[1.15rem] sm:h-5" />
            </Link>
            <SchoolSwitcher />

            <ul className="ml-1 hidden items-center gap-0.5 lg:flex">
              {visible.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `flex min-h-9 items-center rounded-full px-3 text-[0.875rem] font-semibold no-underline transition-colors ${
                        isActive ? 'bg-white/12 text-white' : 'text-slate-300 hover:text-white'
                      }`
                    }
                    style={{ fontStretch: '106%' }}
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>

            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="flex min-h-9 items-center gap-2 rounded-full border border-white/12 bg-white/5 px-3 text-[0.8125rem] font-medium text-slate-300 transition-colors hover:border-white/30 hover:text-white"
                aria-label="Find a student, receipt or person"
              >
                <Icon name="search" size={16} />
                <span className="hidden xl:inline">Find a student, phone, receipt</span>
                <span className="kbd ml-1 hidden xl:inline-grid">/</span>
              </button>
              <UserMenu />
            </div>
          </nav>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 flex-col">
        <Outlet />
      </main>

      {/* Phones: the four daily jobs within thumb reach, everything else behind "More". */}
      <nav aria-label="Main" className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
        <ul className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${mobileTabs.length + (mobileMore.length ? 1 : 0)}, minmax(0, 1fr))` }}>
          {mobileTabs.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-0.5 py-2 text-[0.6875rem] font-semibold no-underline ${isActive ? 'text-ink-800' : 'text-slate-500'}`
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={`grid h-7 w-12 place-items-center rounded-full transition-colors ${isActive ? 'bg-marigold-100 text-marigold-700' : ''}`}>
                      <Icon name={item.icon} size={19} />
                    </span>
                    {item.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
          {mobileMore.length > 0 && (
            <li>
              <button type="button" onClick={() => setMoreOpen(true)} className="flex w-full flex-col items-center gap-0.5 py-2 text-[0.6875rem] font-semibold text-slate-500">
                <span className="grid h-7 w-12 place-items-center rounded-full">
                  <Icon name="grid" size={19} />
                </span>
                More
              </button>
            </li>
          )}
        </ul>
      </nav>

      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <ul className="grid grid-cols-2 gap-2">
          {[...mobileMore, ...(school.can('school.manage') ? [{ to: '/app/settings', label: 'Settings', icon: 'settings' as IconName }] : [])].map((item) => (
            <li key={item.to}>
              <Link to={item.to} onClick={() => setMoreOpen(false)} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 font-semibold text-ink-800 no-underline hover:border-slate-300">
                <span className="grid size-9 place-items-center rounded-xl bg-lagoon-50 text-lagoon-600">
                  <Icon name={item.icon} size={18} />
                </span>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </Dialog>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

/** The school's contour map behind the masthead. Still, and unique to the school. */
function Terrain({ seed }: { seed: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    return mountContours(canvas, canvas, { still: true, seed, levels: [-0.42, -0.24, -0.06, 0.12, 0.3, 0.48, 0.66] });
  }, [seed]);
  return (
    <div aria-hidden="true" className="no-print pointer-events-none absolute inset-x-0 top-0 z-0 h-[24rem] overflow-hidden">
      <canvas ref={ref} className="size-full opacity-80" />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(700px 380px at 88% -10%, rgba(244,166,42,.16), transparent 65%),' +
            'radial-gradient(620px 360px at 0% 110%, rgba(20,152,155,.18), transparent 60%),' +
            'linear-gradient(to bottom, transparent 55%, var(--color-night))',
        }}
      />
    </div>
  );
}

function SchoolSwitcher() {
  const school = useSchool();
  const { data: organizations } = authClient.useListOrganizations();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  async function switchTo(id: string) {
    if (id === school.school.id) return setOpen(false);
    setSwitching(id);
    try {
      await authClient.organization.setActive({ organizationId: id });
      queryClient.clear();
      setOpen(false);
      navigate('/app', { replace: true });
    } finally {
      setSwitching(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-9 min-w-0 items-center gap-2 rounded-full bg-white/8 py-1 pl-1 pr-2.5 text-left transition-colors hover:bg-white/14"
        aria-label={`School: ${school.school.name}. Switch school`}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-marigold-500 text-[0.6875rem] font-extrabold text-night" style={{ fontStretch: '115%' }}>
          {school.school.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden max-w-[11rem] truncate text-[0.8125rem] font-semibold text-white sm:block">{school.school.name}</span>
        <Icon name="chevron-down" size={14} className="shrink-0 text-slate-400" />
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title="Your schools" lead="Everything you see belongs to the school you are working in.">
        <ul className="space-y-2">
          {(organizations ?? []).map((org) => (
            <li key={org.id}>
              <button
                type="button"
                onClick={() => switchTo(org.id)}
                className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                  org.id === school.school.id ? 'border-ink-800 bg-slate-50' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <span className="grid size-10 place-items-center rounded-xl bg-marigold-500 font-extrabold text-night">{org.name.slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink-800">{org.name}</span>
                  <span className="block text-[0.8125rem] text-slate-500">{org.slug}</span>
                </span>
                {org.id === school.school.id && <span className="tag tag-ink">Working here</span>}
                {switching === org.id && <span className="text-[0.8125rem] text-slate-500">Opening…</span>}
              </button>
            </li>
          ))}
        </ul>
        <Link to="/new-school" className="btn btn-line btn-sm mt-4">
          <Icon name="plus" size={15} /> Add another school
        </Link>
      </Dialog>
    </>
  );
}

function UserMenu() {
  const school = useSchool();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const items = useMemo(
    () => [
      ...(school.can('school.manage') ? [{ label: 'Settings', icon: 'settings' as IconName, to: '/app/settings' }] : []),
      ...(school.can('audit.view') ? [{ label: 'Activity', icon: 'history' as IconName, to: '/app/settings?tab=activity' }] : []),
    ],
    [school],
  );

  return (
    <div className="relative" ref={menuRef}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu" className="rounded-full p-0.5 ring-white/20 hover:ring-2" aria-label="Your account">
        <Avatar name={school.user.name} size={34} tone="bg-lagoon-400 text-night" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-[calc(100%+0.6rem)] z-50 w-64 overflow-hidden rounded-2xl bg-white text-slate-600 shadow-card ring-1 ring-slate-200">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="truncate font-semibold text-ink-800">{school.user.name}</p>
            <p className="truncate text-[0.8125rem]">{school.user.email}</p>
            <p className="mt-1.5">
              <span className="tag tag-sun">{school.roleLabel}</span>
            </p>
          </div>
          <ul className="py-1.5">
            {items.map((item) => (
              <li key={item.to}>
                <Link role="menuitem" to={item.to} onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-4 py-2 text-[0.875rem] font-medium text-ink-800 no-underline hover:bg-slate-50">
                  <Icon name={item.icon} size={16} className="text-slate-500" />
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <button
                role="menuitem"
                type="button"
                onClick={async () => {
                  await signOut();
                  queryClient.clear();
                  navigate('/login', { replace: true });
                }}
                className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[0.875rem] font-medium text-ink-800 hover:bg-slate-50"
              >
                <Icon name="logout" size={16} className="text-slate-500" />
                Sign out
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

/** Keeps a screen to the roles that can use it, for anyone who reaches it by a typed or shared link. */
export function RequirePermission({ anyOf, children }: { anyOf: Permission[]; children: React.ReactNode }) {
  const school = useSchool();
  if (school.can(...anyOf)) return <>{children}</>;
  return (
    <div className="relative z-10 flex flex-1 flex-col">
      <div data-surface="dark" className="wrap max-w-6xl pb-8 pt-9">
        <h1 className="text-[2rem]">Not part of your role</h1>
        <p className="mt-1.5 text-slate-300">
          You are signed in as {school.roleLabel} at {school.school.name}. Ask the school’s administrator if you need this.
        </p>
      </div>
      <div className="sheet-paper flex-1">
        <div className="wrap max-w-6xl pt-7">
          <Link to="/app" className="btn btn-ink btn-sm">Back to Today</Link>
        </div>
      </div>
    </div>
  );
}
