// Step one of two: the person's own login. Their school comes next, on its own
// screen, because asking for both at once is what makes signup forms feel long.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout';
import { SchoolStage } from '../components/SchoolStage';
import { Field } from '../components/Field';
import { PasswordField, scorePassword } from '../components/PasswordField';
import { FormError } from '../components/FormError';
import { SubmitButton } from '../components/SubmitButton';
import { StepMark } from '../components/StepMark';
import { describeAuthError, signUp } from '../lib/auth-client';
import { focusFirstError } from '../lib/form';
import type { FieldErrors } from '../lib/form';

// Keyed by the field ids below, so a failed submit can send focus to the right one.
const fieldOrder = ['name', 'email', 'password'];

export function SignUp() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!name.trim()) errors.name = 'Enter your name.';
    if (!email.trim()) errors.email = 'Enter your email address.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = 'Enter a valid email address.';
    if (!password) errors.password = 'Choose a password.';
    else if (scorePassword(password) === 0) errors.password = 'Use at least 8 characters.';
    return errors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstError(fieldOrder, errors);
      return;
    }

    setPending(true);
    const { error } = await signUp.email({
      name: name.trim(),
      email: email.trim(),
      password,
    });
    setPending(false);

    if (error) {
      setFormError(describeAuthError(error));
      return;
    }

    navigate('/new-school', { replace: true });
  }

  return (
    <AuthLayout
      stage={
        <SchoolStage caption="One account signs you in to every Acadlas product, for every school you belong to." />
      }
    >
      <StepMark step={1} of={2} />

      <h1 className="mt-5">Create your account</h1>
      <p className="lead mt-3">
        This is your personal login. You will add your school on the next screen.
      </p>

      <form className="mt-8 space-y-5" onSubmit={handleSubmit} noValidate>
        <FormError message={formError} />

        <Field
          id="name"
          label="Your name"
          type="text"
          autoComplete="name"
          autoFocus
          placeholder="Asha Verma"
          value={name}
          error={fieldErrors.name}
          onChange={(event) => setName(event.target.value)}
        />

        <Field
          id="email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="asha@greenfield.edu.in"
          value={email}
          error={fieldErrors.email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <PasswordField
          id="password"
          label="Password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          showStrength
          value={password}
          error={fieldErrors.password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <div className="pt-1">
          <SubmitButton pending={pending} pendingLabel="Creating account">
            Create account
          </SubmitButton>
        </div>
      </form>

      <p className="mt-7 text-[0.9375rem] text-slate-500">
        Already have an account?{' '}
        <Link className="font-semibold text-lagoon-600 underline-offset-4 hover:underline" to="/login">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
