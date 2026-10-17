// Where a school's invitation link lands: /parent/welcome#<secret>.
//
// The secret sits after '#', which browsers never send to a server, and it is wiped from
// the address bar the moment the page opens — so it is not left in history, bookmarks, or
// on screen for someone looking over a shoulder. It only ever leaves the browser inside the
// body of the two requests below.
//
// One page, three cases the server decides: a new parent sets a password; a parent already
// on Acadlas (a child at another school) gives the password they have; a parent who forgot
// theirs sets a new one. All three first confirm the child's date of birth.
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError, api, errorMessage, fieldErrors } from '../../lib/api';
import { AuthShell } from '../../components/AuthShell';
import { FormError } from '../../components/FormError';
import { Icon } from '../../components/Icon';
import { PasswordField } from '../../components/PasswordField';
import { SubmitButton } from '../../components/SubmitButton';
import { ErrorMark } from '../../components/Field';

type Lookup = { schoolName: string; phone: string; kind: 'new' | 'existing' | 'reset'; expiresAt: string; attemptsLeft: number };

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Read once, then gone from the address bar. */
function takeSecret(): string {
  const secret = window.location.hash.replace(/^#/, '');
  if (secret) window.history.replaceState(null, '', window.location.pathname);
  return secret;
}

export function ParentWelcome() {
  const [secret] = useState(takeSecret);

  const lookup = useQuery({
    queryKey: ['parent-invite'],
    queryFn: () => api.post<Lookup>('/parent-invite/lookup', { secret }),
    enabled: Boolean(secret),
    retry: false,
    staleTime: Infinity,
    // Nothing about the link is kept once this page is gone.
    gcTime: 0,
  });

  if (!secret) return <LinkProblem title="This link is incomplete" body="Open the link exactly as the school sent it. If it still does not work, ask the school for a new one." />;
  if (lookup.isPending) {
    return (
      <AuthShell covers={false} navAction={{ prompt: 'Already set up?', label: 'Sign in', to: '/parent/login' }}>
        <div className="space-y-3" aria-busy="true" aria-label="Checking your link">
          <div className="skeleton h-6 w-2/3" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-12" />
          <div className="skeleton h-12" />
        </div>
      </AuthShell>
    );
  }
  if (lookup.error) {
    const code = lookup.error instanceof ApiError ? lookup.error.code : '';
    if (code === 'PORTAL_OFF') return <LinkProblem title="The parent app is paused" body={errorMessage(lookup.error)} />;
    if (code === 'LINK_INVALID') return <LinkProblem title="This link can’t be used" body={errorMessage(lookup.error)} />;
    return <LinkProblem title="Something went wrong" body={errorMessage(lookup.error)} />;
  }
  return <Activate secret={secret} info={lookup.data} />;
}

function Activate({ secret, info }: { secret: string; info: Lookup }) {
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [local, setLocal] = useState<Record<string, string>>({});
  const [attemptsLeft, setAttemptsLeft] = useState(info.attemptsLeft);
  const [dead, setDead] = useState(false);

  const activate = useMutation({
    mutationFn: (body: Record<string, string>) => api.post<{ ok: true }>('/parent-invite/activate', body),
    onSuccess: () => window.location.replace('/parent'),
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'LINK_INVALID') setDead(true);
      const m = e instanceof ApiError ? /(\d+) tr(y|ies) left/.exec(e.message) : null;
      if (m) setAttemptsLeft(Number(m[1]));
    },
  });

  useEffect(() => {
    document.title = `${info.schoolName} parent app — Acadlas`;
  }, [info.schoolName]);

  if (dead) return <LinkProblem title="This link has stopped working" body="Too many wrong answers, or it was already used. Ask the school to send you a new link." />;

  const existing = info.kind === 'existing';
  const server = fieldErrors(activate.error);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const errors: Record<string, string> = {};
    const d = Number(day);
    const y = Number(year);
    const m = Number(month);
    const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const valid = y > 1990 && y <= new Date().getFullYear() && m >= 1 && m <= 12 && d >= 1 && d <= new Date(y, m, 0).getDate();
    if (!valid) errors.dateOfBirth = 'Enter the full date of birth.';
    if (existing) {
      if (!password) errors.currentPassword = 'Enter the password you already use.';
    } else {
      if (password.length < 8) errors.password = 'Use at least 8 characters.';
      else if (confirm !== password) errors.confirm = 'The two passwords are different.';
    }
    setLocal(errors);
    if (Object.keys(errors).length) return;
    activate.mutate(existing ? { secret, dateOfBirth: iso, currentPassword: password } : { secret, dateOfBirth: iso, password });
  }

  const dobError = local.dateOfBirth ?? server.dateOfBirth;
  const formMessage = activate.error && !server.dateOfBirth && !server.password && !server.currentPassword ? errorMessage(activate.error) : null;

  return (
    <AuthShell covers={false} navAction={{ prompt: 'Already set up?', label: 'Sign in', to: '/parent/login' }}>
      <p className="inline-flex items-center gap-1.5 rounded-full bg-lagoon-50 px-2.5 py-1 text-[0.75rem] font-bold text-lagoon-700">
        <Icon name="students" size={13} /> {info.schoolName}
      </p>
      <h1 className="mt-3">{info.kind === 'reset' ? 'Set a new password' : existing ? 'Add this school' : 'Welcome'}</h1>
      <p className="mt-2 text-slate-600">
        {info.kind === 'reset'
          ? 'Confirm your child’s date of birth, then choose a new password. You will be signed out on your other phones.'
          : existing
            ? `Your number ${info.phone} already has a parent account. Sign in with that password to add ${info.schoolName} to it.`
            : `Set up the parent app for ${info.phone}. First, confirm your child’s date of birth.`}
      </p>

      <form className="mt-6 space-y-5" onSubmit={submit} noValidate>
        <FormError message={formMessage} />

        <fieldset>
          <legend className="input-label">Your child’s date of birth</legend>
          <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_5.5rem] gap-2">
            <input
              className="input"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Day"
              aria-label="Day"
              maxLength={2}
              value={day}
              onChange={(e) => setDay(e.target.value.replace(/\D/g, ''))}
              aria-invalid={dobError ? true : undefined}
            />
            <select className="input" aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} aria-invalid={dobError ? true : undefined}>
              <option value="">Month</option>
              {months.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
            <input
              className="input"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Year"
              aria-label="Year"
              maxLength={4}
              value={year}
              onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))}
              aria-invalid={dobError ? true : undefined}
            />
          </div>
          {dobError ? (
            <p className="input-error">
              <ErrorMark />
              <span>
                {dobError}
                {server.dateOfBirth && ` ${attemptsLeft} ${attemptsLeft === 1 ? 'try' : 'tries'} left.`}
              </span>
            </p>
          ) : (
            <p className="input-hint">As the school has it. {attemptsLeft < 5 && `${attemptsLeft} ${attemptsLeft === 1 ? 'try' : 'tries'} left.`}</p>
          )}
        </fieldset>

        {existing ? (
          <PasswordField
            id="current-password"
            label="Your parent app password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={local.currentPassword ?? server.currentPassword}
          />
        ) : (
          <>
            <PasswordField
              id="new-password"
              label={info.kind === 'reset' ? 'New password' : 'Choose a password'}
              autoComplete="new-password"
              showStrength
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={local.password ?? server.password}
              hint="At least 8 characters. Not your phone number."
            />
            <PasswordField
              id="confirm-password"
              label="Type it again"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              error={local.confirm ?? (confirm.length >= password.length && confirm && confirm !== password ? 'The two passwords are different.' : undefined)}
            />
          </>
        )}

        <div className="pt-1">
          <SubmitButton pending={activate.isPending} pendingLabel="Setting up">
            {info.kind === 'reset' ? 'Save and sign in' : existing ? 'Add and sign in' : 'Set up and sign in'}
          </SubmitButton>
        </div>
      </form>

      <p className="mt-5 border-t border-slate-100 pt-4 text-[0.8125rem] leading-snug text-slate-500">
        <Icon name="lock" size={13} className="mr-1 inline align-[-2px]" />
        You will see only your own children, and only what {info.schoolName} chooses to share.
      </p>
    </AuthShell>
  );
}

function LinkProblem({ title, body }: { title: string; body: string }) {
  return (
    <AuthShell covers={false} navAction={{ prompt: 'Already set up?', label: 'Sign in', to: '/parent/login' }}>
      <span className="grid size-11 place-items-center rounded-2xl bg-marigold-50 text-marigold-700">
        <Icon name="link" size={20} />
      </span>
      <h1 className="mt-4">{title}</h1>
      <p className="mt-2 text-slate-600">{body}</p>
      <p className="mt-6 text-[0.875rem]">
        Already set up?{' '}
        <Link className="font-semibold text-lagoon-600 underline-offset-2 hover:underline" to="/parent/login">
          Sign in with your phone number
        </Link>
      </p>
    </AuthShell>
  );
}
