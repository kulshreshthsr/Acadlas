// First-time setup: the school's details, its academic year, its classes and sections,
// and the subjects and fee heads it uses — four short steps, saved together at the end.
//
// The right-hand side draws the school as it is described: a map of class levels with
// their sections, filling in as each one is added, so the last step ends with the school
// laid out in front of you.
import { useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ContourField } from '../../components/ContourField';
import { Wordmark } from '../../components/Wordmark';
import { Field } from '../../components/Field';
import { FormError } from '../../components/FormError';
import { Icon } from '../../components/Icon';
import { SelectField, Spinner } from '../../components/ui';
import { Checking } from '../guards';
import { api, errorMessage } from '../../lib/api';
import { useMeQuery } from '../../lib/school';

const boards = ['CBSE', 'ICSE / ISC', 'State board', 'IB', 'Cambridge', 'Other'];

const states = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

const early = ['Nursery', 'LKG', 'UKG'];
const numbered = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
const presets: { label: string; classes: string[] }[] = [
  { label: 'Nursery to 12', classes: [...early, ...numbered(1, 12)] },
  { label: 'Nursery to 8', classes: [...early, ...numbered(1, 8)] },
  { label: 'Nursery to 5', classes: [...early, ...numbered(1, 5)] },
  { label: '1 to 10', classes: numbered(1, 10) },
  { label: '1 to 12', classes: numbered(1, 12) },
  { label: '6 to 12', classes: numbered(6, 12) },
];

const subjectSuggestions = ['English', 'Hindi', 'Mathematics', 'Science', 'Social Science', 'EVS', 'Sanskrit', 'Computer Science', 'Physics', 'Chemistry', 'Biology', 'Accountancy', 'Economics', 'Physical Education', 'Art', 'Music'];
const defaultSubjects = ['English', 'Hindi', 'Mathematics', 'Science', 'Social Science', 'EVS', 'Computer Science'];
const headSuggestions = ['Tuition', 'Admission', 'Annual charges', 'Transport', 'Examination', 'Computer', 'Development', 'Activity', 'Smart class'];
const defaultHeads = ['Tuition', 'Admission', 'Annual charges', 'Transport', 'Examination'];

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function defaultYear() {
  const now = new Date();
  const start = now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
  return { start, name: `${start}–${String(start + 1).slice(2)}` };
}

type ClassRow = { name: string; sections: string[] };

const steps = ['Your school', 'Academic year', 'Classes and sections', 'Subjects and fees'];

export function Setup() {
  const me = useMeQuery();
  if (me.isPending) return <Checking label="Opening setup" />;
  if (!me.data) return <Navigate to="/app" replace />;
  if (me.data.currentYear) return <Navigate to="/app" replace />;
  if (!me.data.permissions.includes('school.manage')) {
    return (
      <div data-surface="dark" className="grid min-h-svh place-items-center bg-night px-6 text-center">
        <div className="max-w-sm">
          <Wordmark tone="light" className="mx-auto h-6" />
          <h1 className="mt-6 text-white">{me.data.school.name} is still being set up</h1>
          <p className="mt-2 text-slate-400">The school’s administrator needs to finish setting it up before you can start. Check back soon.</p>
        </div>
      </div>
    );
  }
  return <SetupWizard schoolName={me.data.school.name} />;
}

function SetupWizard({ schoolName }: { schoolName: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const year = defaultYear();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [profile, setProfile] = useState({ name: schoolName, board: 'CBSE', city: '', state: 'Uttar Pradesh', phone: '', email: '', principalName: '', udiseCode: '', affiliationNo: '' });
  const [yearName, setYearName] = useState(year.name);
  const [startsOn, setStartsOn] = useState(`${year.start}-04-01`);
  const [endsOn, setEndsOn] = useState(`${year.start + 1}-03-31`);
  const [termCount, setTermCount] = useState<0 | 2 | 3>(2);
  const [workingDays, setWorkingDays] = useState(0b0111111);
  const [classes, setClasses] = useState<ClassRow[]>(presets[0].classes.map((name) => ({ name, sections: ['A'] })));
  const [newClass, setNewClass] = useState('');
  const [subjects, setSubjects] = useState<string[]>(defaultSubjects);
  const [heads, setHeads] = useState<string[]>(defaultHeads);
  const [custom, setCustom] = useState({ subject: '', head: '' });

  const terms = useMemo(() => splitTerms(startsOn, endsOn, termCount), [startsOn, endsOn, termCount]);

  const save = useMutation({
    mutationFn: () =>
      api.post('/school/setup', {
        profile: { ...profile, workingDays },
        year: { name: yearName, startsOn, endsOn, terms },
        classes: classes.filter((c) => c.sections.length > 0),
        subjects,
        feeHeads: heads,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      navigate('/app', { replace: true, state: { welcome: true } });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  function next() {
    setError(null);
    if (step === 0 && !profile.name.trim()) return setError('Enter the school’s name.');
    if (step === 1) {
      if (!yearName.trim()) return setError('Give the year a name, like 2026–27.');
      if (startsOn >= endsOn) return setError('The year must end after it starts.');
    }
    if (step === 2) {
      if (!classes.some((c) => c.sections.length > 0)) return setError('Add at least one class with a section.');
    }
    if (step < steps.length - 1) setStep(step + 1);
    else save.mutate();
  }

  const totalSections = classes.reduce((s, c) => s + c.sections.length, 0);

  return (
    <div data-surface="dark" className="relative flex min-h-svh flex-col">
      <ContourField />
      <header className="relative z-10 pt-4 sm:pt-5">
        <div className="wrap flex items-center justify-between">
          <Wordmark tone="light" className="h-5 sm:h-[1.4rem]" />
          <p className="text-[0.8125rem] text-slate-400">Setting up {profile.name || 'your school'}</p>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-start py-6 sm:items-center sm:py-10">
        <div className="wrap grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
          <div className="sheet rise overflow-hidden" style={{ '--d': '60ms' } as React.CSSProperties}>
            <ol className="flex border-b border-slate-100 bg-slate-50" aria-label="Setup steps">
              {steps.map((label, i) => (
                <li key={label} className="flex-1">
                  <button
                    type="button"
                    onClick={() => i < step && setStep(i)}
                    disabled={i > step}
                    aria-current={i === step ? 'step' : undefined}
                    className={`flex w-full flex-col items-start gap-1 border-b-2 px-3 py-3 text-left sm:px-4 ${
                      i === step ? 'border-marigold-500' : i < step ? 'border-lagoon-400' : 'border-transparent'
                    }`}
                  >
                    <span className={`text-[0.75rem] font-bold ${i <= step ? 'text-ink-800' : 'text-slate-400'}`} style={{ fontStretch: '110%' }}>
                      {i < step ? <Icon name="check" size={14} className="inline text-lagoon-600" /> : i + 1}
                    </span>
                    <span className={`hidden text-[0.8125rem] font-semibold sm:block ${i === step ? 'text-ink-800' : 'text-slate-500'}`}>{label}</span>
                  </button>
                </li>
              ))}
            </ol>

            <div className="p-5 sm:p-7">
              <h1 className="text-[1.5rem]">{steps[step]}</h1>
              <div className="mt-5 space-y-4">
                <FormError message={error} />

                {step === 0 && (
                  <>
                    <Field id="name" label="School name" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} autoFocus />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <SelectField label="Board" value={profile.board} onChange={(e) => setProfile({ ...profile, board: e.target.value })}>
                        {boards.map((b) => (
                          <option key={b}>{b}</option>
                        ))}
                      </SelectField>
                      <Field id="principal" label="Principal’s name" value={profile.principalName} onChange={(e) => setProfile({ ...profile, principalName: e.target.value })} placeholder="Optional" />
                      <Field id="city" label="City or town" value={profile.city} onChange={(e) => setProfile({ ...profile, city: e.target.value })} placeholder="Kanpur" />
                      <SelectField label="State" value={profile.state} onChange={(e) => setProfile({ ...profile, state: e.target.value })}>
                        {states.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </SelectField>
                      <Field id="phone" label="School phone" inputMode="tel" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} placeholder="Shown on receipts" />
                      <Field id="email" label="School email" type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} placeholder="Shown on receipts" />
                      <Field id="udise" label="UDISE+ code" value={profile.udiseCode} onChange={(e) => setProfile({ ...profile, udiseCode: e.target.value })} placeholder="Optional, 11 digits" />
                      <Field id="affiliation" label="Affiliation number" value={profile.affiliationNo} onChange={(e) => setProfile({ ...profile, affiliationNo: e.target.value })} placeholder="Optional" />
                    </div>
                  </>
                )}

                {step === 1 && (
                  <>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field id="year" label="Year" value={yearName} onChange={(e) => setYearName(e.target.value)} />
                      <Field id="starts" label="Starts" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
                      <Field id="ends" label="Ends" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
                    </div>
                    <div>
                      <p className="input-label">Terms</p>
                      <div className="seg">
                        {([0, 2, 3] as const).map((n) => (
                          <button key={n} type="button" aria-pressed={termCount === n} onClick={() => setTermCount(n)}>
                            {n === 0 ? 'No terms' : `${n} terms`}
                          </button>
                        ))}
                      </div>
                      {terms.length > 0 && (
                        <ul className="mt-3 grid gap-2 sm:grid-cols-3">
                          {terms.map((t) => (
                            <li key={t.name} className="rounded-lg bg-slate-50 px-3 py-2 text-[0.8125rem]">
                              <b className="block text-ink-800">{t.name}</b>
                              {formatShort(t.startsOn)} to {formatShort(t.endsOn)}
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="input-hint">Term dates can be changed later in Settings.</p>
                    </div>
                    <div>
                      <p className="input-label">Working days</p>
                      <div className="flex flex-wrap gap-1.5">
                        {weekdays.map((d, i) => {
                          const on = (workingDays & (1 << i)) !== 0;
                          return (
                            <button
                              key={d}
                              type="button"
                              aria-pressed={on}
                              onClick={() => setWorkingDays(workingDays ^ (1 << i))}
                              className={`min-h-10 min-w-12 rounded-full border px-3 text-[0.875rem] font-semibold ${on ? 'border-ink-800 bg-ink-800 text-white' : 'border-slate-300 bg-white text-slate-500'}`}
                            >
                              {d}
                            </button>
                          );
                        })}
                      </div>
                      <p className="input-hint">Registers are expected on these days. Holidays are added in Settings.</p>
                    </div>
                  </>
                )}

                {step === 2 && (
                  <>
                    <div>
                      <p className="input-label">Start from</p>
                      <div className="flex flex-wrap gap-1.5">
                        {presets.map((p) => (
                          <button
                            key={p.label}
                            type="button"
                            onClick={() => setClasses(p.classes.map((name) => ({ name, sections: classes.find((c) => c.name === name)?.sections ?? ['A'] })))}
                            className="min-h-9 rounded-full border border-slate-300 bg-white px-3.5 text-[0.8125rem] font-semibold text-ink-800 hover:border-ink-800"
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[0.8125rem] text-slate-600">
                      Sections in every class:
                      {[['A'], ['A', 'B'], ['A', 'B', 'C'], ['A', 'B', 'C', 'D']].map((set) => (
                        <button key={set.join('')} type="button" onClick={() => setClasses(classes.map((c) => ({ ...c, sections: set })))} className="rounded-full bg-white px-2.5 py-1 font-semibold text-ink-800 ring-1 ring-slate-200 hover:ring-ink-800">
                          {set.join(', ')}
                        </button>
                      ))}
                    </div>
                    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                      {classes.map((c, index) => (
                        <li key={c.name} className="flex items-center gap-3 px-3 py-2">
                          <span className="w-20 shrink-0 font-bold text-ink-800" style={{ fontStretch: '112%' }}>
                            {/^\d+$/.test(c.name) ? `Class ${c.name}` : c.name}
                          </span>
                          <div className="flex flex-1 flex-wrap items-center gap-1">
                            {c.sections.map((s) => (
                              <button
                                key={s}
                                type="button"
                                title={`Remove section ${s}`}
                                onClick={() => setClasses(classes.map((row, i) => (i === index ? { ...row, sections: row.sections.filter((x) => x !== s) } : row)))}
                                className="grid size-8 place-items-center rounded-lg bg-lagoon-50 text-[0.8125rem] font-bold text-lagoon-700 hover:bg-coral-50 hover:text-coral-700"
                              >
                                {s}
                              </button>
                            ))}
                            {c.sections.length < 26 && (
                              <button
                                type="button"
                                aria-label={`Add a section to ${c.name}`}
                                onClick={() => setClasses(classes.map((row, i) => (i === index ? { ...row, sections: [...row.sections, String.fromCharCode(65 + row.sections.length)] } : row)))}
                                className="grid size-8 place-items-center rounded-lg border border-dashed border-slate-300 text-slate-500 hover:border-ink-800 hover:text-ink-800"
                              >
                                <Icon name="plus" size={14} />
                              </button>
                            )}
                          </div>
                          <button type="button" className="btn btn-quiet btn-xs" onClick={() => setClasses(classes.filter((_, i) => i !== index))} aria-label={`Remove ${c.name}`}>
                            <Icon name="x" size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const name = newClass.trim();
                        if (!name || classes.some((c) => c.name.toLowerCase() === name.toLowerCase())) return;
                        setClasses([...classes, { name, sections: ['A'] }]);
                        setNewClass('');
                      }}
                    >
                      <input className="input input-sm" value={newClass} onChange={(e) => setNewClass(e.target.value)} placeholder="Another class, e.g. Pre-nursery or 11 Science" aria-label="Class name" />
                      <button type="submit" className="btn btn-line btn-sm shrink-0">
                        Add class
                      </button>
                    </form>
                  </>
                )}

                {step === 3 && (
                  <>
                    <ChipPicker
                      label="Subjects taught"
                      hint="Which class studies which subject can be set later, along with who teaches it."
                      options={[...new Set([...subjectSuggestions, ...subjects])]}
                      value={subjects}
                      onChange={setSubjects}
                      custom={custom.subject}
                      setCustom={(v) => setCustom({ ...custom, subject: v })}
                      placeholder="Add a subject"
                    />
                    <ChipPicker
                      label="Fee heads"
                      hint="What fees are charged for. Amounts come later, when you make a fee plan."
                      options={[...new Set([...headSuggestions, ...heads])]}
                      value={heads}
                      onChange={setHeads}
                      custom={custom.head}
                      setCustom={(v) => setCustom({ ...custom, head: v })}
                      placeholder="Add a fee head"
                    />
                  </>
                )}
              </div>

              <div className="mt-7 flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
                {step > 0 ? (
                  <button type="button" className="btn btn-quiet" onClick={() => setStep(step - 1)}>
                    Back
                  </button>
                ) : (
                  <span />
                )}
                <button type="button" className="btn btn-sun" onClick={next} disabled={save.isPending}>
                  {save.isPending && <Spinner />}
                  {step < steps.length - 1 ? 'Continue' : save.isPending ? 'Setting up' : 'Finish and open Acadlas'}
                  {!save.isPending && <Icon name="arrow-right" size={17} />}
                </button>
              </div>
            </div>
          </div>

          {/* The school, as described so far. */}
          <aside className="rise hidden lg:block" style={{ '--d': '200ms' } as React.CSSProperties} aria-label="Preview of your school">
            <div className="orbit-card p-5">
              <p className="orbit-label">{[profile.board, profile.city].filter(Boolean).join(', ')}</p>
              <p className="mt-1 text-[1.375rem] font-bold leading-tight text-white" style={{ fontStretch: '115%' }}>
                {profile.name || 'Your school'}
              </p>
              <p className="mt-1 text-[0.8125rem] text-slate-400">
                {yearName}: {classes.length} classes, {totalSections} sections
              </p>
              <div className="mt-5 space-y-1.5">
                {classes.slice(0, 16).map((c) => (
                  <div key={c.name} className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-right text-[0.75rem] font-semibold text-slate-400">{c.name}</span>
                    <div className="flex gap-1">
                      {c.sections.map((s) => (
                        <span key={s} className="pop grid h-6 w-7 place-items-center rounded-md bg-lagoon-400/20 text-[0.6875rem] font-bold text-lagoon-200">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {classes.length > 16 && <p className="pl-16 text-[0.75rem] text-slate-400">and {classes.length - 16} more</p>}
              </div>
              {step === 3 && (
                <div className="mt-5 flex flex-wrap gap-1.5 border-t border-white/10 pt-4">
                  {heads.map((h) => (
                    <span key={h} className="rounded-full bg-marigold-500/15 px-2.5 py-1 text-[0.75rem] font-semibold text-marigold-300">
                      {h}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function ChipPicker({
  label,
  hint,
  options,
  value,
  onChange,
  custom,
  setCustom,
  placeholder,
}: {
  label: string;
  hint: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  custom: string;
  setCustom: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <p className="input-label">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[0.8125rem] font-semibold transition-colors ${
                on ? 'border-ink-800 bg-ink-800 text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
              }`}
            >
              {on && <Icon name="check" size={13} />}
              {o}
            </button>
          );
        })}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = custom.trim();
          if (v && !value.includes(v)) onChange([...value, v]);
          setCustom('');
        }}
      >
        <input className="input input-sm max-w-xs" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
        <button type="submit" className="btn btn-line btn-sm">
          Add
        </button>
      </form>
      <p className="input-hint">{hint}</p>
    </div>
  );
}

/** Splits the year into equal terms, ending each on the day before the next begins. */
function splitTerms(startsOn: string, endsOn: string, count: number) {
  if (!count || startsOn >= endsOn) return [];
  const start = new Date(`${startsOn}T00:00:00Z`).getTime();
  const end = new Date(`${endsOn}T00:00:00Z`).getTime();
  const span = (end - start) / count;
  return Array.from({ length: count }, (_, i) => {
    const s = new Date(start + span * i);
    const e = i === count - 1 ? new Date(end) : new Date(start + span * (i + 1) - 86400000);
    return { name: `Term ${i + 1}`, startsOn: s.toISOString().slice(0, 10), endsOn: e.toISOString().slice(0, 10) };
  });
}

function formatShort(iso: string) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}
