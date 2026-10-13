// Where an invitation link lands. Staff are usually sent this link on WhatsApp, open it
// on their phone, and have never heard of Acadlas — so the page says plainly which school
// asked them and as what, and lets them create their login or sign in right here.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AuthShell } from '../components/AuthShell';
import { Field } from '../components/Field';
import { PasswordField, scorePassword } from '../components/PasswordField';
import { FormError } from '../components/FormError';
import { SubmitButton } from '../components/SubmitButton';
import { Checking } from './guards';
import { api } from '../lib/api';
import { authClient, describeAuthError, describeThrownError, signIn, signOut, signUp, useSession } from '../lib/auth-client';

type InvitationInfo = {
  id: string;
  email: string;
  roleLabel: string;
  status: string;
  expired: boolean;
  schoolName: string;
  inviterName: string;
  accountExists: boolean;
};

export function Invite() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session, isPending: sessionPending } = useSession();
  const info = useQuery({ queryKey: ['invitation', id], queryFn: () => api.get<InvitationInfo>(`/invitations/${id}`), retry: false });

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    const { data, error: acceptError } = await authClient.organization.acceptInvitation({ invitationId: id });
    if (acceptError) throw acceptError;
    const schoolId = data?.invitation.organizationId;
    if (schoolId) await authClient.organization.setActive({ organizationId: schoolId });
    queryClient.clear();
    navigate('/app', { replace: true });
  }

  async function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const invitation = info.data!;
    setPending(true);
    try {
      if (!session) {
        if (invitation.accountExists) {
          const { error: e } = await signIn.email({ email: invitation.email, password });
          if (e) return setError(describeAuthError(e));
        } else {
          if (!name.trim()) return setError('Enter your name.');
          if (scorePassword(password) === 0) return setError('Use at least 8 characters for your password.');
          const { error: e } = await signUp.email({ name: name.trim(), email: invitation.email, password });
          if (e) return setError(describeAuthError(e));
        }
      }
      await accept();
    } catch (thrown) {
      const maybe = thrown as { code?: string; message?: string; status?: number };
      setError(maybe.code ? describeAuthError(maybe) : describeThrownError(thrown));
    } finally {
      setPending(false);
    }
  }

  if (info.isPending || sessionPending) return <Checking label="Opening your invitation" />;

  const nav = { prompt: 'Already part of a school?', label: 'Sign in', to: '/login' };

  if (info.error || !info.data) {
    return (
      <AuthShell navAction={nav}>
        <h1>This invitation link does not work</h1>
        <p className="mt-2 text-slate-600">It may have been mistyped or withdrawn. Ask the school to send you a new one.</p>
      </AuthShell>
    );
  }

  const invitation = info.data;

  if (invitation.status !== 'pending' || invitation.expired) {
    return (
      <AuthShell navAction={nav}>
        <h1>{invitation.status === 'accepted' ? 'You have already joined' : 'This invitation has expired'}</h1>
        <p className="mt-2 text-slate-600">
          {invitation.status === 'accepted'
            ? `Sign in to open ${invitation.schoolName}.`
            : `Invitations last seven days. Ask ${invitation.inviterName} at ${invitation.schoolName} to send a new one.`}
        </p>
        <Link to="/login" className="btn btn-sun mt-6 w-full">
          Sign in
        </Link>
      </AuthShell>
    );
  }

  const wrongAccount = session && session.user.email.toLowerCase() !== invitation.email.toLowerCase();

  return (
    <AuthShell navAction={nav}>
      <p className="text-[0.8125rem] font-semibold text-slate-500">Invitation from {invitation.inviterName}</p>
      <h1 className="mt-2">Join {invitation.schoolName}</h1>
      <p className="mt-2 text-slate-600">
        You have been invited as <b className="text-ink-800">{invitation.roleLabel}</b>. Your login is your email,{' '}
        <b className="text-ink-800">{invitation.email}</b>.
      </p>

      {wrongAccount ? (
        <div className="mt-6 space-y-3">
          <FormError message={`You are signed in as ${session.user.email}. This invitation is for ${invitation.email}.`} />
          <button
            type="button"
            className="btn btn-line w-full"
            onClick={async () => {
              await signOut();
              queryClient.clear();
            }}
          >
            Sign out and continue
          </button>
        </div>
      ) : (
        <form className="mt-6 space-y-4" onSubmit={handle} noValidate>
          <FormError message={error} />
          {!session && !invitation.accountExists && (
            <Field id="name" label="Your name" autoComplete="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Kavita Iyer" />
          )}
          {!session && (
            <PasswordField
              id="password"
              label={invitation.accountExists ? 'Your Acadlas password' : 'Choose a password'}
              autoComplete={invitation.accountExists ? 'current-password' : 'new-password'}
              showStrength={!invitation.accountExists}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
          <SubmitButton pending={pending} pendingLabel="Joining">
            {session ? `Join ${invitation.schoolName}` : invitation.accountExists ? 'Sign in and join' : 'Create login and join'}
          </SubmitButton>
        </form>
      )}
    </AuthShell>
  );
}
