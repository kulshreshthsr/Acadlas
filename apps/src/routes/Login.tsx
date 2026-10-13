// Coming back. No stage — two fields and the shortest path to the school they
// were last working in.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthShell } from '../components/AuthShell';
import { Field } from '../components/Field';
import { PasswordField } from '../components/PasswordField';
import { FormError } from '../components/FormError';
import { SubmitButton } from '../components/SubmitButton';
import { describeAuthError, describeThrownError, signIn } from '../lib/auth-client';

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const justReset = Boolean((location.state as { reset?: boolean } | null)?.reset);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!email.trim() || !password) {
      setFormError('Enter your email and password.');
      return;
    }

    setPending(true);
    try {
      const { error } = await signIn.email({ email: email.trim(), password });

      if (error) {
        setFormError(describeAuthError(error));
        return;
      }

      // Where they land depends on whether they have a school yet, which the route
      // at "/" works out from the session.
      navigate('/', { replace: true });
    } catch (thrown) {
      setFormError(describeThrownError(thrown));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell navAction={{ prompt: 'New to Acadlas?', label: 'Create an account', to: '/signup' }}>
      <h1>Sign in</h1>
      <p className="mt-2 text-slate-600">Use the email you set your Acadlas account up with.</p>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
        {justReset && !formError && (
          <p role="status" className="rounded-md bg-lagoon-50 px-3.5 py-3 text-[0.9375rem] font-medium text-lagoon-700">
            Your password has been changed. Sign in with the new one.
          </p>
        )}
        <FormError message={formError} />

        <Field
          id="email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus
          placeholder="asha@greenfield.edu.in"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <PasswordField
          id="password"
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <p className="-mt-2 text-right text-[0.8125rem]">
          <Link className="font-semibold text-lagoon-600 underline-offset-2 hover:underline" to="/forgot-password">
            Forgot your password?
          </Link>
        </p>

        <div className="pt-1">
          <SubmitButton pending={pending} pendingLabel="Signing in">
            Sign in
          </SubmitButton>
        </div>
      </form>

      <p className="mt-5 border-t border-slate-100 pt-4 text-[0.8125rem] text-slate-500">
        New to Acadlas?{' '}
        <Link className="font-semibold text-lagoon-600 underline-offset-2 hover:underline" to="/signup">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
