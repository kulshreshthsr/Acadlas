// A parent coming back: their phone number and the password they set from the school's
// link. There is no "forgot password" email — parents get a new link from the school,
// which is also what keeps this page from being a way to message strangers.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AuthShell } from '../../components/AuthShell';
import { Field } from '../../components/Field';
import { FormError } from '../../components/FormError';
import { Icon } from '../../components/Icon';
import { PasswordField } from '../../components/PasswordField';
import { SubmitButton } from '../../components/SubmitButton';
import { describeAuthError, describeThrownError, signIn, toLoginPhone } from '../../lib/auth-client';

export function ParentLogin() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setPhoneError(undefined);
    const phoneNumber = toLoginPhone(phone);
    if (!phoneNumber) {
      setPhoneError('Enter the 10-digit mobile number the school has for you.');
      return;
    }
    if (!password) {
      setFormError('Enter your password.');
      return;
    }

    setPending(true);
    try {
      const { error } = await signIn.phoneNumber({ phoneNumber, password });
      if (error) {
        setFormError(describeAuthError(error));
        return;
      }
      // A full load, so every part of the app starts from the new session.
      window.location.replace('/parent');
    } catch (thrown) {
      setFormError(describeThrownError(thrown));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell covers={false} navAction={{ prompt: 'Work at a school?', label: 'Staff sign in', to: '/login' }}>
      <p className="inline-flex items-center gap-1.5 rounded-full bg-lagoon-50 px-2.5 py-1 text-[0.75rem] font-bold text-lagoon-700">
        <Icon name="students" size={13} /> Parent app
      </p>
      <h1 className="mt-3">Sign in</h1>
      <p className="mt-2 text-slate-600">With the mobile number your child’s school has for you.</p>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
        <FormError message={formError} />
        <Field
          id="phone"
          label="Mobile number"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          autoFocus
          placeholder="98765 43210"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={phoneError}
        />
        <PasswordField id="password" label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="pt-1">
          <SubmitButton pending={pending} pendingLabel="Signing in">
            Sign in
          </SubmitButton>
        </div>
      </form>

      <div className="mt-5 space-y-2 border-t border-slate-100 pt-4 text-[0.8125rem] text-slate-500">
        <p>
          <b className="text-ink-800">Forgot your password, or never set one?</b> Ask your child’s school to send you a link. It sets a new password in a minute.
        </p>
        <p>
          School staff?{' '}
          <Link className="font-semibold text-lagoon-600 underline-offset-2 hover:underline" to="/login">
            Sign in with your email
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
