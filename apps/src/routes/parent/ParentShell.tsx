// The frame around every parent screen: the same navy and contours as the staff app, a
// row of the parent's children to switch between, and their account menu. Built for a
// phone first — most parents will only ever see it on one.
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../lib/api';
import { authClient, describeAuthError, signOut, useSession } from '../../lib/auth-client';
import { hashSeed } from '../../lib/format';
import { useParentMe } from '../../lib/parent';
import { Terrain } from '../../components/AppShell';
import { FormError } from '../../components/FormError';
import { Icon } from '../../components/Icon';
import { PasswordField } from '../../components/PasswordField';
import { Wordmark } from '../../components/Wordmark';
import { Avatar, Dialog, ErrorState, Loading, Spinner } from '../../components/ui';
import { useToast } from '../../lib/toast';

async function leave(clear: () => void) {
  await signOut();
  clear();
  window.location.replace('/parent/login');
}

export function ParentShell() {
  const { data: session } = useSession();
  const me = useParentMe();
  const queryClient = useQueryClient();

  // No access right now (removed, or the school switched the app off): say so plainly.
  if (me.error instanceof ApiError && (me.error.status === 403 || me.error.status === 401)) {
    return (
      <div data-surface="dark" className="relative grid min-h-svh place-items-center bg-night px-6">
        <Terrain seed={hashSeed(session?.user.id ?? 'parent')} />
        <div className="sheet relative z-10 w-full max-w-sm p-6 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-marigold-50 text-marigold-700">
            <Icon name="lock" size={22} />
          </span>
          <h1 className="mt-4 text-[1.375rem]">No access right now</h1>
          <p className="mt-2 text-[0.9375rem] text-slate-600">{me.error.message}</p>
          <button type="button" className="btn btn-ink mt-6 w-full" onClick={() => leave(() => queryClient.clear())}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const kids = me.data?.children ?? [];

  return (
    <div className="relative flex min-h-svh flex-col bg-night">
      <Terrain seed={hashSeed(session?.user.id ?? 'parent')} />

      <header data-surface="dark" className="no-print relative z-20 pt-3 sm:pt-4">
        <div className="wrap max-w-3xl">
          <nav aria-label="Parent app" className="flex items-center gap-2 rounded-full border border-white/10 bg-ink-950/70 py-2 pl-4 pr-2 backdrop-blur-md">
            <Link to="/parent" className="flex shrink-0 items-center gap-2" aria-label="Acadlas parent app, home">
              <Wordmark tone="light" className="h-[1.15rem] sm:h-5" />
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.6875rem] font-bold text-slate-200">Parent</span>
            </Link>
            <div className="ml-auto">
              <AccountMenu name={me.data?.parent.name ?? session?.user.name ?? ''} />
            </div>
          </nav>

          {kids.length > 1 && (
            <ul className="mt-4 flex gap-2 overflow-x-auto pb-1" aria-label="Your children">
              {kids.map((k) => (
                <li key={k.id} className="shrink-0">
                  <NavLink
                    to={`/parent/child/${k.id}`}
                    className={({ isActive }) =>
                      `flex items-center gap-2 rounded-full py-1 pl-1 pr-3.5 text-[0.875rem] font-semibold no-underline ring-1 transition-colors ${
                        isActive ? 'bg-white text-ink-800 ring-white' : 'bg-white/5 text-slate-200 ring-white/15 hover:ring-white/40'
                      }`
                    }
                  >
                    <Avatar name={k.name} size={28} />
                    {k.firstName}
                  </NavLink>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      <main className="relative z-10 flex flex-1 flex-col">
        {me.isPending ? (
          <div className="wrap max-w-3xl py-8">
            <Loading rows={4} />
          </div>
        ) : me.error ? (
          <div className="wrap max-w-3xl py-8">
            <ErrorState error={me.error} retry={() => me.refetch()} />
          </div>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}

function AccountMenu({ name }: { name: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu" className="rounded-full p-0.5 ring-white/20 hover:ring-2" aria-label="Your account">
        <Avatar name={name || 'Parent'} size={34} tone="bg-lagoon-400 text-night" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-[calc(100%+0.6rem)] z-50 w-60 overflow-hidden rounded-2xl bg-white text-slate-600 shadow-card ring-1 ring-slate-200">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="truncate font-semibold text-ink-800">{name}</p>
            <p className="mt-1.5">
              <span className="tag tag-lagoon">Parent</span>
            </p>
          </div>
          <ul className="py-1.5">
            <li>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setOpen(false);
                  setChanging(true);
                }}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[0.875rem] font-medium text-ink-800 hover:bg-slate-50"
              >
                <Icon name="lock" size={16} className="text-slate-500" />
                Change password
              </button>
            </li>
            <li>
              <button
                role="menuitem"
                type="button"
                onClick={() => leave(() => queryClient.clear())}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[0.875rem] font-medium text-ink-800 hover:bg-slate-50"
              >
                <Icon name="logout" size={16} className="text-slate-500" />
                Sign out
              </button>
            </li>
          </ul>
        </div>
      )}
      {changing && <ChangePasswordDialog onClose={() => setChanging(false)} />}
    </div>
  );
}

function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (next.length < 8) return setError('Use at least 8 characters for the new password.');
    setPending(true);
    try {
      // Other phones signed in with the old password are signed out.
      const { error: failed } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
      if (failed) {
        setError(failed.code === 'INVALID_PASSWORD' ? 'Your current password is not right.' : describeAuthError(failed));
        return;
      }
      toast('Password changed');
      onClose();
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Change password" lead="You stay signed in here. Any other phone signed in to your account is signed out.">
      <form className="space-y-4" onSubmit={submit} noValidate>
        <FormError message={error} />
        <PasswordField id="pw-current" label="Current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <PasswordField id="pw-new" label="New password" autoComplete="new-password" showStrength value={next} onChange={(e) => setNext(e.target.value)} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-line btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-ink btn-sm" disabled={pending || !current || !next}>
            {pending && <Spinner />} Change password
          </button>
        </div>
      </form>
    </Dialog>
  );
}
