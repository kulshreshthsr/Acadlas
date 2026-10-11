// Step two of two: the school itself. Creating it makes an organization, puts this
// person in it as owner, and makes it the school their session is working in —
// which is what every other screen in every Acadlas product reads to decide whose
// data it is allowed to show.
//
// The constellation beside the form takes the name as it is typed, so the step ends
// with the school you just named sitting in front of you with its records attached.
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthShell } from '../components/AuthShell';
import { RecordConstellation } from '../components/RecordConstellation';
import { Field } from '../components/Field';
import { FormError } from '../components/FormError';
import { SubmitButton } from '../components/SubmitButton';
import { StepMark } from '../components/StepMark';
import { describeAuthError, describeThrownError, organization } from '../lib/auth-client';
import { isValidSlug, toSlug } from '../lib/slug';
import { focusFirstError } from '../lib/form';
import type { FieldErrors } from '../lib/form';

// Keyed by the field ids below, so a failed submit can send focus to the right one.
const fieldOrder = ['school-name', 'short-name'];

export function CreateSchool() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  // Once someone edits the short name by hand, it stops following the school name.
  const [shortNameEdited, setShortNameEdited] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const effectiveShortName = shortNameEdited ? shortName : toSlug(name);

  function handleNameChange(value: string) {
    setName(value);
    if (!shortNameEdited) setShortName(toSlug(value));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const nextErrors: FieldErrors = {};
    if (!name.trim()) nextErrors['school-name'] = "Enter your school's name.";
    if (!effectiveShortName) nextErrors['short-name'] = 'Enter a short name.';
    else if (!isValidSlug(effectiveShortName)) {
      nextErrors['short-name'] = 'Use 3 or more lowercase letters, numbers and dashes.';
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstError(fieldOrder, nextErrors);
      return;
    }

    setPending(true);
    try {
      const { data, error } = await organization.create({
        name: name.trim(),
        slug: effectiveShortName,
      });

      if (error) {
        setFormError(describeAuthError(error));
        return;
      }

      // Make the new school the one this session is working in. Without this the
      // session has no active school and every product screen would have nothing
      // to scope its data to.
      if (data?.id) {
        await organization.setActive({ organizationId: data.id });
      }

      navigate('/app', { replace: true });
    } catch (thrown) {
      setFormError(describeThrownError(thrown));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      navAction={{ prompt: 'Not your account?', label: 'Sign in', to: '/login' }}
      stage={<RecordConstellation schoolName={name} shortName={effectiveShortName} />}
    >
      <StepMark step={2} of={2} />

      <h1 className="mt-3.5">Add your school</h1>
      <p className="mt-2 text-slate-600">
        You can add more schools later and switch between them without signing out.
      </p>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
        <FormError message={formError} />

        <Field
          id="school-name"
          label="School name"
          type="text"
          autoComplete="organization"
          autoFocus
          placeholder="Greenfield Public School"
          value={name}
          error={errors['school-name']}
          onChange={(event) => handleNameChange(event.target.value)}
        />

        <Field
          id="short-name"
          label="Short name"
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="greenfield"
          value={effectiveShortName}
          error={errors['short-name']}
          hint="Identifies your school across Acadlas. Lowercase letters, numbers and dashes."
          onChange={(event) => {
            setShortNameEdited(true);
            setShortName(event.target.value.toLowerCase());
          }}
        />

        <div className="pt-1">
          <SubmitButton pending={pending} pendingLabel="Creating school">
            Create school
          </SubmitButton>
        </div>
      </form>
    </AuthShell>
  );
}
