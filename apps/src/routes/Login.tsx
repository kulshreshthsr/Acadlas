// Coming back. No stage, no pitch — two fields and the shortest path to the
// school they were last working in.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { Field } from '../components/Field';
import { PasswordField } from '../components/PasswordField';
import { FormError } from '../components/FormError';
import { SubmitButton } from '../components/SubmitButton';
import { describeAuthError, signIn } from '../lib/auth-client';

export function Login() {
  const navigate = useNavigate();
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
    const { error } = await signIn.email({ email: email.trim(), password });
    setPending(false);

    if (error) {
      setFormError(describeAuthError(error));
      return;
    }

    // Where they land depends on whether they have a school yet, which the route
    // at "/" works out from the session.
    navigate('/', { replace: true });
  }

  return (
    <AuthLayout>
      <h1>Sign in</h1>
      <p className="lead mt-3">Use the email you set your Acadlas account up with.</p>

      <form className="mt-8 space-y-5" onSubmit={handleSubmit} noValidate>
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

        <div className="pt-1">
          <SubmitButton pending={pending} pendingLabel="Signing in">
            Sign in
          </SubmitButton>
        </div>
      </form>

      <p className="mt-7 text-[0.9375rem] text-slate-500">
        New to Acadlas?{' '}
        <Link className="font-semibold text-lagoon-600 underline-offset-4 hover:underline" to="/signup">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}
