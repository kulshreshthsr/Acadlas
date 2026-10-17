// Settings: the school's details, academic years and terms, holidays, fee heads, the parent
// app, and the full activity trail of who changed what.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, withQuery, errorMessage, fieldErrors } from '../../lib/api';
import { date, dateShort, timeAgo } from '../../lib/format';
import { useFeeHeads, useYears } from '../../lib/queries';
import type { Year } from '../../lib/queries';
import { useSchool } from '../../lib/school';
import { Field } from '../../components/Field';
import { FormError } from '../../components/FormError';
import { Icon } from '../../components/Icon';
import { Card, Dialog, EmptyState, ErrorState, Loading, Page, SelectField, Spinner, TextAreaField } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { ParentAppSettings } from './ParentAppSettings';

const tabs = [
  { id: 'school', label: 'School' },
  { id: 'years', label: 'Years and terms' },
  { id: 'holidays', label: 'Holidays' },
  { id: 'fees', label: 'Fee heads' },
  { id: 'parents', label: 'Parent app' },
  { id: 'activity', label: 'Activity' },
] as const;
type Tab = (typeof tabs)[number]['id'];

export function Settings() {
  const school = useSchool();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? (school.can('school.manage') ? 'school' : 'activity')) as Tab;
  const visible = tabs.filter((t) => (t.id === 'activity' ? school.can('audit.view') : t.id === 'fees' ? school.can('fees.manage') : school.can('school.manage')));

  return (
    <Page
      title="Settings"
      lead={school.school.name}
      under={
        <div className="seg border-white/10 bg-white/5" role="tablist">
          {visible.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setParams({ tab: t.id })} className={tab === t.id ? '!bg-white !text-ink-800' : '!text-slate-300 hover:!text-white'}>
              {t.label}
            </button>
          ))}
        </div>
      }
    >
      {tab === 'school' && <SchoolDetails />}
      {tab === 'years' && <Years />}
      {tab === 'holidays' && <Holidays />}
      {tab === 'fees' && <FeeHeads />}
      {tab === 'parents' && <ParentAppSettings />}
      {tab === 'activity' && <Activity />}
    </Page>
  );
}

type Profile = { name: string; slug: string; board: string | null; affiliationNo: string | null; udiseCode: string | null; address: string | null; city: string | null; state: string | null; pincode: string | null; phone: string | null; email: string | null; principalName: string | null; workingDays: number; admissionPrefix: string; receiptPrefix: string };

function SchoolDetails() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['profile'], queryFn: () => api.get<Profile>('/school/profile') });
  const [form, setForm] = useState<Profile | null>(null);
  if (q.data && !form) setForm(q.data);
  const save = useMutation({
    mutationFn: () => api.put('/school/profile', form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
      toast('School details saved');
    },
  });
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!form) return <Loading rows={6} />;
  const f = fieldErrors(save.error);
  const set = (k: keyof Profile) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <FormError message={save.error ? errorMessage(save.error) : null} />
      <Card title="On receipts and certificates">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-1"><Field id="p-name" label="School name" value={form.name} onChange={set('name')} error={f.name} /></div>
          <Field id="p-board" label="Board" value={form.board ?? ''} onChange={set('board')} />
          <Field id="p-principal" label="Principal" value={form.principalName ?? ''} onChange={set('principalName')} />
          <div className="sm:col-span-2 lg:col-span-3"><TextAreaField label="Address" rows={2} value={form.address ?? ''} onChange={set('address')} /></div>
          <Field id="p-city" label="City" value={form.city ?? ''} onChange={set('city')} />
          <Field id="p-state" label="State" value={form.state ?? ''} onChange={set('state')} />
          <Field id="p-pin" label="PIN code" inputMode="numeric" value={form.pincode ?? ''} onChange={set('pincode')} />
          <Field id="p-phone" label="Phone" inputMode="tel" value={form.phone ?? ''} onChange={set('phone')} error={f.phone} />
          <Field id="p-email" label="Email" type="email" value={form.email ?? ''} onChange={set('email')} error={f.email} />
          <Field id="p-aff" label="Affiliation number" value={form.affiliationNo ?? ''} onChange={set('affiliationNo')} />
          <Field id="p-udise" label="UDISE+ code" value={form.udiseCode ?? ''} onChange={set('udiseCode')} />
        </div>
      </Card>
      <Card title="Numbering and days">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="p-adm" label="Admission number prefix" value={form.admissionPrefix} onChange={set('admissionPrefix')} hint={`Next ones look like ${form.admissionPrefix}/2026/0419`} />
          <Field id="p-rct" label="Receipt number prefix" value={form.receiptPrefix} onChange={set('receiptPrefix')} hint={`Receipts look like ${form.receiptPrefix}/2026-27/00042`} />
        </div>
        <div className="mt-4">
          <p className="input-label">Working days</p>
          <div className="flex flex-wrap gap-1.5">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => {
              const on = (form.workingDays & (1 << i)) !== 0;
              return (
                <button key={d} type="button" aria-pressed={on} onClick={() => setForm({ ...form, workingDays: form.workingDays ^ (1 << i) })} className={`min-h-10 min-w-12 rounded-full border px-3 text-[0.875rem] font-semibold ${on ? 'border-ink-800 bg-ink-800 text-white' : 'border-slate-300 bg-white text-slate-500'}`}>
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      </Card>
      <div className="flex justify-end">
        <button type="submit" className="btn btn-ink" disabled={save.isPending}>{save.isPending && <Spinner />} Save school details</button>
      </div>
    </form>
  );
}

function Years() {
  const years = useYears();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Year | 'new' | null>(null);
  const makeCurrent = useMutation({
    mutationFn: (id: string) => api.post(`/school/years/${id}/make-current`),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast('Current year changed');
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  if (years.isPending) return <Loading rows={4} />;
  return (
    <div className="space-y-3">
      {(years.data ?? []).map((y) => (
        <Card key={y.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-[1.125rem]">{y.name} {y.isCurrent && <span className="tag tag-ink">Current</span>}</h2>
              <p className="text-[0.875rem] text-slate-500">{date(y.startsOn)} to {date(y.endsOn)}</p>
              {y.terms.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {y.terms.map((t) => <li key={t.id} className="rounded-lg bg-slate-50 px-2.5 py-1 text-[0.8125rem]"><b className="text-ink-800">{t.name}</b> {dateShort(t.startsOn)} to {dateShort(t.endsOn)}</li>)}
                </ul>
              )}
            </div>
            <div className="flex gap-2">
              {!y.isCurrent && <button type="button" className="btn btn-line btn-sm" onClick={() => makeCurrent.mutate(y.id)} disabled={makeCurrent.isPending}>Make current</button>}
              <button type="button" className="btn btn-line btn-sm" onClick={() => setEditing(y)}><Icon name="edit" size={14} /> Edit</button>
            </div>
          </div>
        </Card>
      ))}
      <button type="button" className="btn btn-ink btn-sm" onClick={() => setEditing('new')}><Icon name="plus" size={15} /> New academic year</button>
      {editing && <YearDialog year={editing === 'new' ? null : editing} years={years.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function YearDialog({ year, years, onClose }: { year: Year | null; years: Year[]; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const current = years.find((y) => y.isCurrent);
  const nextStart = current ? Number(current.startsOn.slice(0, 4)) + 1 : new Date().getFullYear();
  const [form, setForm] = useState(() =>
    year
      ? { name: year.name, startsOn: year.startsOn, endsOn: year.endsOn, terms: year.terms.map((t) => ({ name: t.name, startsOn: t.startsOn, endsOn: t.endsOn })) }
      : { name: `${nextStart}–${String(nextStart + 1).slice(2)}`, startsOn: `${nextStart}-04-01`, endsOn: `${nextStart + 1}-03-31`, terms: [] as { name: string; startsOn: string; endsOn: string }[] },
  );
  const [copy, setCopy] = useState(true);
  const save = useMutation({
    mutationFn: () => (year ? api.patch(`/school/years/${year.id}`, form) : api.post('/school/years', { ...form, makeCurrent: false, copySectionsFrom: copy ? current?.id : null })),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast(year ? 'Year saved' : `Created ${form.name}`);
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title={year ? `Edit ${year.name}` : 'New academic year'} wide footer={<><button type="button" className="btn btn-line btn-sm" onClick={onClose}>Cancel</button><button type="button" className="btn btn-ink btn-sm" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending && <Spinner />} Save</button></>}>
      <div className="space-y-4">
        <FormError message={save.error ? errorMessage(save.error) : null} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="y-name" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Field id="y-start" label="Starts" type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} />
          <Field id="y-end" label="Ends" type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} />
        </div>
        <div>
          <p className="input-label">Terms</p>
          <div className="space-y-2">
            {form.terms.map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2">
                <input className="input input-sm" value={t.name} onChange={(e) => setForm({ ...form, terms: form.terms.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} aria-label="Term name" />
                <input type="date" className="input input-sm" value={t.startsOn} onChange={(e) => setForm({ ...form, terms: form.terms.map((x, j) => (j === i ? { ...x, startsOn: e.target.value } : x)) })} aria-label="Starts" />
                <input type="date" className="input input-sm" value={t.endsOn} onChange={(e) => setForm({ ...form, terms: form.terms.map((x, j) => (j === i ? { ...x, endsOn: e.target.value } : x)) })} aria-label="Ends" />
                <button type="button" className="btn btn-quiet btn-icon" aria-label="Remove term" onClick={() => setForm({ ...form, terms: form.terms.filter((_, j) => j !== i) })}><Icon name="x" size={14} /></button>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-line btn-xs mt-2" onClick={() => setForm({ ...form, terms: [...form.terms, { name: `Term ${form.terms.length + 1}`, startsOn: form.startsOn, endsOn: form.endsOn }] })}><Icon name="plus" size={13} /> Term</button>
        </div>
        {!year && current && (
          <label className="flex items-center gap-2 text-[0.875rem]">
            <input type="checkbox" className="check" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
            Copy sections and class teachers from {current.name}
          </label>
        )}
      </div>
    </Dialog>
  );
}

type Holiday = { id: string; date: string; name: string };

function Holidays() {
  const school = useSchool();
  const toast = useToast();
  const queryClient = useQueryClient();
  const year = school.currentYear;
  const q = useQuery({ queryKey: ['holidays', year?.id], queryFn: () => api.get<Holiday[]>(withQuery('/school/holidays', { from: year?.startsOn, to: year?.endsOn })) });
  const [one, setOne] = useState({ date: '', name: '' });
  const [paste, setPaste] = useState('');
  const add = useMutation({
    mutationFn: (holidays: { date: string; name: string }[]) => api.post('/school/holidays', { holidays }),
    onSuccess: (_, list) => {
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
      queryClient.invalidateQueries({ queryKey: ['today'] });
      toast(list.length === 1 ? `Added ${list[0].name}` : `Added ${list.length} holidays`);
      setOne({ date: '', name: '' });
      setPaste('');
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/school/holidays/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['holidays'] }),
  });

  // "2026-10-20 Diwali" or "20/10/2026, Diwali", one per line.
  const parsed = paste
    .split('\n')
    .map((line) => {
      const m = line.trim().match(/^(\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4})[\s,;-]+(.+)$/);
      if (!m) return null;
      let d = m[1];
      if (!/^\d{4}/.test(d)) {
        const [dd, mm, yy] = d.split(/[/.-]/);
        d = `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
      }
      return { date: d, name: m[2].trim() };
    })
    .filter((x): x is { date: string; name: string } => Boolean(x));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <Card title={`Holidays in ${year?.name ?? 'this year'}`} pad={false}>
        {q.isPending && <div className="p-5"><Loading rows={3} /></div>}
        {q.data && q.data.length === 0 && <EmptyState icon="calendar" title="No holidays added">Days marked here show as holidays on registers and are left out of attendance percentages.</EmptyState>}
        {q.data && q.data.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {q.data.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                <span className="w-28 text-[0.875rem] text-slate-500">{dateShort(h.date)}</span>
                <span className="flex-1 font-semibold text-ink-800">{h.name}</span>
                <button type="button" className="btn btn-quiet btn-icon" aria-label={`Remove ${h.name}`} onClick={() => remove.mutate(h.id)}><Icon name="trash" size={14} /></button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="space-y-5">
        <Card title="Add a holiday">
          <FormError message={add.error ? errorMessage(add.error) : null} />
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (one.date && one.name.trim()) add.mutate([one]); }}>
            <div className="grid grid-cols-[auto_1fr] gap-2">
              <input type="date" className="input input-sm" value={one.date} onChange={(e) => setOne({ ...one, date: e.target.value })} aria-label="Date" />
              <input className="input input-sm" value={one.name} onChange={(e) => setOne({ ...one, name: e.target.value })} placeholder="Diwali" aria-label="Holiday name" />
            </div>
            <button type="submit" className="btn btn-ink btn-sm" disabled={!one.date || !one.name.trim()}>Add holiday</button>
          </form>
        </Card>
        <Card title="Paste the year’s list">
          <TextAreaField label="One per line: date, then name" rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'15/08/2026 Independence Day\n02/10/2026 Gandhi Jayanti\n2026-10-20 Diwali'} />
          <button type="button" className="btn btn-ink btn-sm mt-3" disabled={!parsed.length || add.isPending} onClick={() => add.mutate(parsed)}>
            {add.isPending && <Spinner />} Add {parsed.length || ''} {parsed.length === 1 ? 'holiday' : 'holidays'}
          </button>
        </Card>
      </div>
    </div>
  );
}

function FeeHeads() {
  const heads = useFeeHeads();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['fee-heads'] });
  const add = useMutation({ mutationFn: () => api.post('/school/fees/heads', { name: name.trim() }), onSuccess: () => { refresh(); setName(''); } });
  const rename = useMutation({ mutationFn: () => api.patch(`/school/fees/heads/${renaming!.id}`, { name: renaming!.name }), onSuccess: () => { refresh(); setRenaming(null); toast('Renamed'); } });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/school/fees/heads/${id}`), onSuccess: refresh, onError: (e) => toast(errorMessage(e), 'bad') });

  return (
    <Card title="What fees are charged for" pad={false}>
      <ul className="divide-y divide-slate-100">
        {(heads.data ?? []).map((h) => (
          <li key={h.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
            {renaming?.id === h.id ? (
              <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); rename.mutate(); }}>
                <input className="input input-sm" value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} autoFocus aria-label="Name" />
                <button type="submit" className="btn btn-ink btn-sm">Save</button>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => setRenaming(null)}>Cancel</button>
              </form>
            ) : (
              <>
                <span className="flex-1 font-semibold text-ink-800">{h.name}</span>
                <button type="button" className="btn btn-quiet btn-icon" aria-label={`Rename ${h.name}`} onClick={() => setRenaming({ id: h.id, name: h.name })}><Icon name="edit" size={14} /></button>
                <button type="button" className="btn btn-quiet btn-icon" aria-label={`Delete ${h.name}`} onClick={() => remove.mutate(h.id)}><Icon name="trash" size={14} /></button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form className="flex gap-2 border-t border-slate-100 p-4 sm:px-5" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate(); }}>
        <input className="input input-sm max-w-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="Smart class, Lab, Library" aria-label="New fee head" />
        <button type="submit" className="btn btn-ink btn-sm" disabled={add.isPending}>Add</button>
      </form>
      {add.error && <p className="px-5 pb-4 text-[0.8125rem] text-coral-700">{errorMessage(add.error)}</p>}
    </Card>
  );
}

type Event = { id: string; summary: string; actorName: string | null; action: string; createdAt: string; studentId: string | null };

function Activity() {
  const [filter, setFilter] = useState('');
  const q = useInfiniteQuery({
    queryKey: ['activity'],
    queryFn: ({ pageParam }) => api.get<Event[]>(withQuery('/school/activity', { before: pageParam, limit: 50 })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.length === 50 ? last[last.length - 1].createdAt : undefined),
  });
  const events = (q.data?.pages.flat() ?? []).filter((e) => !filter || e.action.startsWith(filter));
  const groups = new Map<string, Event[]>();
  for (const e of events) {
    const day = e.createdAt.slice(0, 10);
    groups.set(day, [...(groups.get(day) ?? []), e]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SelectField label="Show" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Everything</option>
          <option value="student">Students</option>
          <option value="fee">Fees</option>
          <option value="attendance">Attendance</option>
          <option value="staff">Staff</option>
          <option value="school">School settings</option>
        </SelectField>
      </div>
      {q.isPending && <Loading rows={6} />}
      {q.error && <ErrorState error={q.error} />}
      {[...groups.entries()].map(([day, list]) => (
        <Card key={day} title={date(day)} pad={false}>
          <ul className="divide-y divide-slate-100">
            {list.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-4 py-2.5 text-[0.875rem] sm:px-5">
                <span className="w-16 shrink-0 text-[0.75rem] text-slate-400">{new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(e.createdAt))}</span>
                <span className="min-w-0 flex-1">
                  {e.studentId ? <a href={`/app/students/${e.studentId}`} className="text-ink-800 no-underline hover:underline">{e.summary}</a> : <span className="text-ink-800">{e.summary}</span>}
                  <span className="block text-[0.75rem] text-slate-500">{e.actorName}, {timeAgo(e.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {q.hasNextPage && (
        <button type="button" className="btn btn-line btn-sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
          {q.isFetchingNextPage && <Spinner />} Earlier activity
        </button>
      )}
    </div>
  );
}
