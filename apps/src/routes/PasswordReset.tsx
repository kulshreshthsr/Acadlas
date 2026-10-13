// Forgotten passwords. The link arrives by email once Resend is configured; until then
// the API prints it in its terminal, which is enough to test the flow end to end.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthShell } from '../components/AuthShell';
import { Field } from '../components/Field';
import { PasswordField, scorePassword } from '../components/PasswordField';
import { FormError } from '../components/FormError';
import { SubmitButton } from '../components/SubmitButton';
import { authClient, describeAuthError, describeThrownError } from '../lib/auth-client';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter the email address you sign in with.');
      return;
    }
    setPending(true);
    try {
      const { error: apiError } = await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (apiError) {
        setError(describeAuthError(apiError));
        return;
      }
      setSent(true);
    } catch (thrown) {
      setError(describeThrownError(thrown));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell navAction={{ prompt: 'Remembered it?', label: 'Sign in', to: '/login' }}>
      <h1>Reset your password</h1>
      {sent ? (
        <>
          <p className="mt-2 text-slate-600">
            If <b className="text-ink-800">{email.trim()}</b> has an Acadlas account, a link to choose a new password is on its way. It works for one hour.
          </p>
          <Link to="/login" className="btn btn-line mt-6 w-full">
            Back to sign in
          </Link>
        </>
      ) : (
        <>
          <p className="mt-2 text-slate-600">We will email you a link to choose a new one.</p>
          <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
            <FormError message={error} />
            <Field id="email" label="Email" type="email" inputMode="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            <SubmitButton pending={pending} pendingLabel="Sending link">
              Send reset link
            </SubmitButton>
          </form>
        </>
      )}
    </AuthShell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');
  const linkError = params.get('error');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (scorePassword(password) === 0) {
      setError('Use at least 8 characters.');
      return;
    }
    setPending(true);
    try {
      const { error: apiError } = await authClient.resetPassword({ newPassword: password, token: token ?? '' });
      if (apiError) {
        setError(describeAuthError(apiError));
        return;
      }
      navigate('/login', { replace: true, state: { reset: true } });
    } catch (thrown) {
      setError(describeThrownError(thrown));
    } finally {
      setPending(false);
    }
  }

  if (!token || linkError) {
    return (
      <AuthShell navAction={{ prompt: 'Remembered it?', label: 'Sign in', to: '/login' }}>
        <h1>This link has expired</h1>
        <p className="mt-2 text-slate-600">Reset links work once, for one hour. Ask for a new one.</p>
        <Link to="/forgot-password" className="btn btn-sun mt-6 w-full">
          Send a new link
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell navAction={{ prompt: 'Remembered it?', label: 'Sign in', to: '/login' }}>
      <h1>Choose a new password</h1>
      <p className="mt-2 text-slate-600">You will sign in with it from now on.</p>
      <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
        <FormError message={error} />
        <PasswordField id="password" label="New password" autoComplete="new-password" autoFocus showStrength value={password} onChange={(e) => setPassword(e.target.value)} />
        <SubmitButton pending={pending} pendingLabel="Saving">
          Save new password
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
