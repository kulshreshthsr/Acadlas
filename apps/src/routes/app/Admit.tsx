// Admission: a student and their family in one form, so nothing is typed twice later.
//
// The guardian's phone comes first in that section because it is how families are found:
// a number already on file means a brother or sister is already here, and the new child
// is linked to the same family instead of creating a second copy of the parents.
import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, fieldErrors } from '../../lib/api';
import { initials, phone as formatPhone, todayISO } from '../../lib/format';
import { sectionOptions, useStructure } from '../../lib/queries';
import { useSchool } from '../../lib/school';
import { Field } from '../../components/Field';
import { FormError } from '../../components/FormError';
import { Icon } from '../../components/Icon';
import { BackLink, Card, CheckRow, Notice, Page, Seg, SelectField, Spinner, TextAreaField } from '../../components/ui';
import { useToast } from '../../lib/toast';

type Relation = 'father' | 'mother' | 'guardian' | 'other';
type GuardianDraft = {
  key: number;
  existingId: string | null;
  existingLabel: string | null;
  name: string;
  relation: Relation;
  phone: string;
  email: string;
  occupation: string;
};

type LookupResult = { id: string; name: string; phone: string; email: string | null; children: { id: string; name: string; classLabel: string | null }[] }[];

const blank = (key: number, relation: Relation): GuardianDraft => ({ key, existingId: null, existingLabel: null, name: '', relation, phone: '', email: '', occupation: '' });

export function Admit() {
  const school = useSchool();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const structure = useStructure();
  const sections = sectionOptions(structure.data);

  const [student, setStudent] = useState({
    firstName: '',
    lastName: '',
    gender: '' as '' | 'female' | 'male' | 'other',
    dateOfBirth: '',
    bloodGroup: '',
    apaarId: '',
    pen: '',
    category: '',
    isRte: false,
    address: '',
    previousSchool: '',
    notes: '',
    admittedOn: todayISO(),
  });
  const [chosenSection, setSectionId] = useState(params.get('section') ?? '');
  const [admissionNo, setAdmissionNo] = useState('');
  const [guardians, setGuardians] = useState<GuardianDraft[]>([blank(1, 'father')]);
  const [consent, setConsent] = useState<'paper' | 'digital' | 'verbal' | ''>('paper');
  const [showMore, setShowMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  // A school with a single section needs no choosing.
  const sectionId = chosenSection || (sections.length === 1 ? sections[0].id : '');

  const admit = useMutation({
    mutationFn: () =>
      api.post<{ id: string; admissionNo: string; classLabel: string }>('/school/students', {
        student: {
          ...student,
          gender: student.gender || null,
          dateOfBirth: student.dateOfBirth || null,
          notes: student.notes || null,
        },
        guardians: guardians.map((g, i) =>
          g.existingId
            ? { existingId: g.existingId, relation: g.relation, isPrimary: i === 0 }
            : { name: g.name, relation: g.relation, phone: g.phone, email: g.email, occupation: g.occupation, isPrimary: i === 0 },
        ),
        sectionId,
        admissionNo: admissionNo || null,
        consentMethod: consent || null,
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['students'] });
      queryClient.invalidateQueries({ queryKey: ['structure'] });
      queryClient.invalidateQueries({ queryKey: ['today'] });
      toast(`Admitted ${student.firstName} to ${created.classLabel}, ${created.admissionNo}`);
      navigate(`/app/students/${created.id}`, { replace: true });
    },
    onError: (e) => {
      setError(errorMessage(e));
      setFields(fieldErrors(e));
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const f: Record<string, string> = {};
    if (!student.firstName.trim()) f['student.firstName'] = 'Enter the first name.';
    if (!sectionId) f.sectionId = 'Choose a class and section.';
    guardians.forEach((g, i) => {
      if (!g.existingId && !g.name.trim()) f[`guardians.${i}.name`] = 'Enter the guardian’s name.';
      if (!g.existingId && g.phone && g.phone.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '').length !== 10) f[`guardians.${i}.phone`] = 'Enter a 10-digit mobile number.';
    });
    setFields(f);
    if (Object.keys(f).length) {
      setError('Some details need attention.');
      return;
    }
    admit.mutate();
  }

  const fullName = [student.firstName, student.lastName].filter(Boolean).join(' ');
  const classLabel = sections.find((s) => s.id === sectionId)?.label;

  return (
    <Page title="Admit a student" lead="Student and family together. Everything else in Acadlas attaches to this record." back={<BackLink to="/app/students">Students</BackLink>}>
      <form onSubmit={submit} noValidate className="grid gap-5 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="min-w-0 space-y-5">
          <FormError message={error} />

          <Card title="Student">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="first" label="First name" value={student.firstName} onChange={(e) => setStudent({ ...student, firstName: e.target.value })} error={fields['student.firstName']} autoFocus autoComplete="off" />
              <Field id="last" label="Last name" value={student.lastName} onChange={(e) => setStudent({ ...student, lastName: e.target.value })} autoComplete="off" />
              <div>
                <p className="input-label">Gender</p>
                <Seg
                  label="Gender"
                  value={student.gender}
                  onChange={(v) => setStudent({ ...student, gender: v })}
                  options={[
                    { value: 'female', label: 'Girl' },
                    { value: 'male', label: 'Boy' },
                    { value: 'other', label: 'Other' },
                  ]}
                />
              </div>
              <Field id="dob" label="Date of birth" type="date" max={todayISO()} value={student.dateOfBirth} onChange={(e) => setStudent({ ...student, dateOfBirth: e.target.value })} error={fields['student.dateOfBirth']} />
            </div>

            <div className="mt-4">
              <CheckRow
                checked={student.isRte}
                onChange={(v) => setStudent({ ...student, isRte: v })}
                label="Admitted under RTE"
                hint="The 25% Right to Education quota. Fees are waived automatically."
              />
            </div>

            {showMore ? (
              <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
                <Field id="apaar" label="APAAR ID" value={student.apaarId} onChange={(e) => setStudent({ ...student, apaarId: e.target.value })} hint="12 digits, from DigiLocker or the school’s UDISE+ portal." />
                <Field id="pen" label="PEN" value={student.pen} onChange={(e) => setStudent({ ...student, pen: e.target.value })} hint="Permanent Education Number from UDISE+." />
                <SelectField label="Blood group" value={student.bloodGroup} onChange={(e) => setStudent({ ...student, bloodGroup: e.target.value })}>
                  <option value="">Not known</option>
                  {['A+', 'A−', 'B+', 'B−', 'AB+', 'AB−', 'O+', 'O−'].map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </SelectField>
                <SelectField label="Category" value={student.category} onChange={(e) => setStudent({ ...student, category: e.target.value })} hint="Only for UDISE+ and board returns.">
                  <option value="">Not recorded</option>
                  {['General', 'EWS', 'OBC', 'SC', 'ST'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </SelectField>
                <div className="sm:col-span-2">
                  <TextAreaField label="Address" value={student.address} onChange={(e) => setStudent({ ...student, address: e.target.value })} rows={2} />
                </div>
                <Field id="prev" label="Previous school" value={student.previousSchool} onChange={(e) => setStudent({ ...student, previousSchool: e.target.value })} />
                <div className="sm:col-span-2">
                  <TextAreaField label="Notes" value={student.notes} onChange={(e) => setStudent({ ...student, notes: e.target.value })} rows={2} hint="Visible to staff who can open this record." />
                </div>
              </div>
            ) : (
              <button type="button" className="btn btn-quiet btn-sm mt-3" onClick={() => setShowMore(true)}>
                <Icon name="plus" size={15} /> APAAR ID, PEN, address and more
              </button>
            )}
          </Card>

          <Card title="Class">
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField label="Class and section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} error={fields.sectionId}>
                <option value="">Choose</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} ({s.strength})
                  </option>
                ))}
              </SelectField>
              <Field id="admitted" label="Admission date" type="date" value={student.admittedOn} onChange={(e) => setStudent({ ...student, admittedOn: e.target.value })} />
              <Field id="admno" label="Admission number" value={admissionNo} onChange={(e) => setAdmissionNo(e.target.value)} placeholder="Given automatically" error={fields.admissionNo} />
            </div>
            {sections.length === 0 && structure.data && (
              <div className="mt-3">
                <Notice tone="warn">
                  There are no sections in {school.currentYear?.name}. <Link className="link" to="/app/classes">Set up classes</Link> first.
                </Notice>
              </div>
            )}
          </Card>

          <Card title="Family" action={guardians.length < 3 && <button type="button" className="btn btn-quiet btn-sm" onClick={() => setGuardians([...guardians, blank(Date.now(), guardians.some((g) => g.relation === 'mother') ? 'guardian' : 'mother')])}><Icon name="plus" size={15} /> Another guardian</button>}>
            <div className="space-y-5">
              {guardians.map((g, i) => (
                <GuardianForm
                  key={g.key}
                  index={i}
                  value={g}
                  errors={fields}
                  onChange={(next) => setGuardians(guardians.map((x) => (x.key === g.key ? next : x)))}
                  onRemove={guardians.length > 1 ? () => setGuardians(guardians.filter((x) => x.key !== g.key)) : undefined}
                />
              ))}
            </div>
          </Card>

          <Card title="Consent to keep these records">
            <p className="mb-3 text-[0.875rem] text-slate-600">
              Under the DPDP Act, a parent or guardian must agree before the school keeps a child’s personal data. Record how they gave it.
            </p>
            <Seg
              label="How consent was given"
              value={consent}
              onChange={setConsent}
              options={[
                { value: 'paper', label: 'Signed admission form' },
                { value: 'digital', label: 'Online form' },
                { value: 'verbal', label: 'In person' },
                { value: '', label: 'Not yet' },
              ]}
            />
            {!consent && <p className="input-hint">The record will be flagged until consent is recorded.</p>}
          </Card>

          <div className="flex items-center justify-end gap-3">
            <Link to="/app/students" className="btn btn-quiet">
              Cancel
            </Link>
            <button type="submit" className="btn btn-sun" disabled={admit.isPending}>
              {admit.isPending && <Spinner />}
              {admit.isPending ? 'Admitting' : 'Admit student'}
            </button>
          </div>
        </div>

        {/* The record, taking shape as it is filled in. */}
        <aside className="hidden lg:block" aria-hidden="true">
          <div className="sticky top-6 rounded-[var(--radius-xl)] bg-ink-800 p-5" data-surface="dark">
            <p className="text-[0.75rem] font-semibold text-slate-400">New record</p>
            <div className="mt-3 flex items-center gap-3 rounded-2xl bg-white p-3">
              <span className={`avatar size-12 text-[1rem] ${fullName ? 'bg-marigold-500 text-night' : 'bg-slate-100 text-slate-400'}`}>{fullName ? initials(fullName) : '—'}</span>
              <span className="min-w-0">
                <span className={`block truncate text-[1.0625rem] font-bold ${fullName ? 'text-ink-800' : 'text-slate-400'}`} style={{ fontStretch: '112%' }}>
                  {fullName || 'Student’s name'}
                </span>
                <span className="block text-[0.8125rem] text-slate-500">{classLabel ? `Class ${classLabel}` : 'Class not chosen'}</span>
              </span>
            </div>
            <ul className="mt-3 space-y-1.5 text-[0.8125rem]">
              {[
                ['Admission no.', admissionNo || 'Given on saving'],
                ['Date of birth', student.dateOfBirth || '—'],
                ['Guardian', guardians[0].existingLabel ?? (guardians[0].name || '—')],
                ['Phone', guardians[0].phone ? formatPhone(guardians[0].phone.replace(/\D/g, '').slice(-10)) : '—'],
                ['Fees', student.isRte ? 'Waived (RTE)' : 'From the class’s fee plan'],
              ].map(([k, v]) => (
                <li key={k} className="flex justify-between gap-3 rounded-lg bg-white/5 px-3 py-2">
                  <span className="text-slate-400">{k}</span>
                  <span className="truncate font-semibold text-white">{v}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </form>
    </Page>
  );
}

function GuardianForm({
  index,
  value,
  onChange,
  onRemove,
  errors,
}: {
  index: number;
  value: GuardianDraft;
  onChange: (g: GuardianDraft) => void;
  onRemove?: () => void;
  errors: Record<string, string>;
}) {
  const digits = value.phone.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  const lookup = useQuery({
    queryKey: ['guardian-lookup', digits],
    queryFn: () => api.get<LookupResult>(`/school/guardians/lookup?phone=${digits}`),
    enabled: digits.length === 10 && !value.existingId,
  });
  const match = useMemo(() => lookup.data?.[0], [lookup.data]);

  if (value.existingId) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-lagoon-200 bg-lagoon-50 p-3">
        <Icon name="link" size={18} className="shrink-0 text-lagoon-600" />
        <div className="min-w-0 flex-1 text-[0.875rem]">
          <p className="font-semibold text-ink-800">{value.existingLabel}</p>
          <p className="text-lagoon-700">Linked to the family already on file</p>
        </div>
        <Seg
          label="Relation"
          value={value.relation}
          onChange={(relation) => onChange({ ...value, relation })}
          options={[
            { value: 'father', label: 'Father' },
            { value: 'mother', label: 'Mother' },
            { value: 'guardian', label: 'Guardian' },
          ]}
        />
        <button type="button" className="btn btn-quiet btn-xs" onClick={() => onChange({ ...value, existingId: null, existingLabel: null })}>
          Unlink
        </button>
      </div>
    );
  }

  return (
    <fieldset className={index > 0 ? 'border-t border-slate-100 pt-5' : ''}>
      <legend className="sr-only">Guardian {index + 1}</legend>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Seg
          label="Relation"
          value={value.relation}
          onChange={(relation) => onChange({ ...value, relation })}
          options={[
            { value: 'father', label: 'Father' },
            { value: 'mother', label: 'Mother' },
            { value: 'guardian', label: 'Guardian' },
            { value: 'other', label: 'Other' },
          ]}
        />
        <span className="flex items-center gap-2">
          {index === 0 && <span className="tag tag-ink">Main contact</span>}
          {onRemove && (
            <button type="button" className="btn btn-quiet btn-xs" onClick={onRemove}>
              Remove
            </button>
          )}
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`g${index}-phone`} label="Mobile number" inputMode="tel" autoComplete="off" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} placeholder="98765 43210" error={errors[`guardians.${index}.phone`]} />
        <Field id={`g${index}-name`} label="Name" autoComplete="off" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} error={errors[`guardians.${index}.name`]} />
      </div>
      {match && (
        <div className="mt-3 flex flex-col gap-3 rounded-xl bg-marigold-50 p-3 ring-1 ring-marigold-100 sm:flex-row sm:items-center">
          <Icon name="students" size={18} className="shrink-0 text-marigold-700" />
          <p className="flex-1 text-[0.875rem] text-ink-800">
            <b>{match.name}</b> is already on file
            {match.children.length > 0 && <> as the family of {match.children.map((c) => `${c.name}${c.classLabel ? ` (${c.classLabel})` : ''}`).join(', ')}</>}. Is this the same family?
          </p>
          <button
            type="button"
            className="btn btn-ink btn-sm shrink-0"
            onClick={() => onChange({ ...value, existingId: match.id, existingLabel: `${match.name}, ${formatPhone(match.phone)}`, name: match.name })}
          >
            Yes, link siblings
          </button>
        </div>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field id={`g${index}-email`} label="Email" type="email" autoComplete="off" value={value.email} onChange={(e) => onChange({ ...value, email: e.target.value })} placeholder="Optional" error={errors[`guardians.${index}.email`]} />
        <Field id={`g${index}-occ`} label="Occupation" autoComplete="off" value={value.occupation} onChange={(e) => onChange({ ...value, occupation: e.target.value })} placeholder="Optional" />
      </div>
    </fieldset>
  );
}
