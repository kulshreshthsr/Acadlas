// Year-end: moving each section up into next year's classes, or marking the final class
// as passed out. Done one section at a time, with every student ticked by default and
// the ones being held back unticked — which is how schools actually make the decision.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, withQuery, errorMessage } from '../../lib/api';
import { plural, todayISO } from '../../lib/format';
import { sectionOptions, useStructure, useYears } from '../../lib/queries';
import { useSchool } from '../../lib/school';
import { Field } from '../../components/Field';
import { FormError } from '../../components/FormError';
import { Icon } from '../../components/Icon';
import { Avatar, BackLink, Card, CheckRow, EmptyState, Notice, Page, SelectField, Spinner } from '../../components/ui';
import { useToast } from '../../lib/toast';
import type { StudentRow } from './Students';

export function Promote() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const years = useYears();
  const current = years.data?.find((y) => y.isCurrent);
  const targets = (years.data ?? []).filter((y) => !y.isCurrent && current && y.startsOn > current.startsOn);
  const [targetYearId, setTargetYearId] = useState('');
  const targetYear = targets.find((y) => y.id === targetYearId) ?? targets[0];

  const from = useStructure(current?.id);
  const to = useStructure(targetYear?.id);
  const fromSections = sectionOptions(from.data);
  const toSections = sectionOptions(to.data);

  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [graduate, setGraduate] = useState(false);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const fromSection = fromSections.find((s) => s.id === fromId);

  const students = useQuery({
    queryKey: ['students', 'promote', fromId],
    queryFn: () => api.get<{ rows: StudentRow[] }>(withQuery('/school/students', { sectionId: fromId, pageSize: 500, yearId: current?.id })),
    enabled: Boolean(fromId),
  });

  // Suggest the same section letter one class up: 6-B → 7-B.
  const suggestion = (() => {
    if (!fromSection || !from.data || !to.data) return null;
    const gradeIndex = from.data.grades.findIndex((g) => g.id === fromSection.gradeId);
    const nextGrade = from.data.grades[gradeIndex + 1];
    if (!nextGrade) return null;
    const letter = fromSection.label.split('-').pop();
    return toSections.find((s) => s.gradeId === nextGrade.id && s.label.endsWith(`-${letter}`)) ?? toSections.find((s) => s.gradeId === nextGrade.id) ?? null;
  })();

  const chosen = (students.data?.rows ?? []).filter((s) => !unticked.has(s.id));

  const promote = useMutation({
    mutationFn: () =>
      api.post<{ moved: number; graduated: number; skipped: number }>('/school/promotions', {
        fromSectionId: fromId,
        toSectionId: graduate ? null : toId || suggestion?.id,
        studentIds: chosen.map((s) => s.id),
        graduate,
        date: graduate ? todayISO() : targetYear?.startsOn,
      }),
    onSuccess: (r) => {
      queryClient.invalidateQueries();
      toast(graduate ? `${plural(r.graduated, 'student')} marked as passed out` : `Promoted ${plural(r.moved, 'student')}${r.skipped ? `, ${r.skipped} already placed` : ''}`);
      setFromId('');
      setToId('');
      setUnticked(new Set());
    },
  });

  if (years.isPending) return <Page title="Promote to next year"><div /></Page>;

  return (
    <Page title="Promote to next year" lead="One section at a time. Untick anyone who is staying in the same class." back={<BackLink to="/app/classes">Classes</BackLink>}>
      {targets.length === 0 ? (
        <NewYear current={current} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <Card title="From and to">
            <div className="space-y-4">
              <SelectField label={`From (${current?.name})`} value={fromId} onChange={(e) => { setFromId(e.target.value); setToId(''); setUnticked(new Set()); }}>
                <option value="">Choose a section</option>
                {fromSections.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.strength})</option>)}
              </SelectField>
              {targets.length > 1 && (
                <SelectField label="Into year" value={targetYear?.id} onChange={(e) => setTargetYearId(e.target.value)}>
                  {targets.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
                </SelectField>
              )}
              <CheckRow checked={graduate} onChange={setGraduate} label="This is the final class" hint="Mark the ticked students as passed out instead of moving them." />
              {!graduate && (
                <SelectField label={`To (${targetYear?.name})`} value={toId || suggestion?.id || ''} onChange={(e) => setToId(e.target.value)}>
                  <option value="">Choose a section</option>
                  {toSections.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.strength} already)</option>)}
                </SelectField>
              )}
              {!graduate && toSections.length === 0 && (
                <Notice tone="warn">{targetYear?.name} has no sections yet. Add them in Classes, choosing that year at the top.</Notice>
              )}
            </div>
          </Card>

          <Card title={fromSection ? `${fromSection.label}: ${chosen.length} of ${students.data?.rows.length ?? 0} ticked` : 'Students'} pad={false}>
            {!fromId ? (
              <EmptyState icon="students" title="Choose a section to start" />
            ) : (
              <>
                <ul className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto">
                  {(students.data?.rows ?? []).map((s) => (
                    <li key={s.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-slate-50 sm:px-5">
                        <input type="checkbox" className="check" checked={!unticked.has(s.id)} onChange={(e) => {
                          const next = new Set(unticked);
                          if (e.target.checked) next.delete(s.id); else next.add(s.id);
                          setUnticked(next);
                        }} />
                        <span className="num w-7 text-[0.8125rem] text-slate-500">{s.rollNo}</span>
                        <Avatar name={s.name} size={28} />
                        <span className="font-semibold text-ink-800">{s.name}</span>
                        {unticked.has(s.id) && <span className="tag tag-sun ml-auto">Staying back</span>}
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="border-t border-slate-100 p-4 sm:p-5">
                  <FormError message={promote.error ? errorMessage(promote.error) : null} />
                  <button type="button" className="btn btn-ink w-full" disabled={!chosen.length || promote.isPending || (!graduate && !(toId || suggestion))} onClick={() => promote.mutate()}>
                    {promote.isPending && <Spinner />}
                    {graduate ? `Mark ${plural(chosen.length, 'student')} as passed out` : `Promote ${plural(chosen.length, 'student')} to ${toSections.find((s) => s.id === (toId || suggestion?.id))?.label ?? '…'}`}
                  </button>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </Page>
  );
}

/** No next year exists yet: create it, copying this year's sections and class teachers. */
function NewYear({ current }: { current?: { id: string; name: string; startsOn: string; endsOn: string } }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const school = useSchool();
  const startYear = current ? Number(current.startsOn.slice(0, 4)) + 1 : new Date().getFullYear();
  const [form, setForm] = useState({ name: `${startYear}–${String(startYear + 1).slice(2)}`, startsOn: `${startYear}-04-01`, endsOn: `${startYear + 1}-03-31` });
  const create = useMutation({
    mutationFn: () => api.post('/school/years', { ...form, terms: [], makeCurrent: false, copySectionsFrom: current?.id }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast(`Created ${form.name}`);
    },
  });
  if (!school.can('school.manage')) {
    return <Card><EmptyState icon="calendar" title="Next year has not been created">Ask an administrator to create it in Settings.</EmptyState></Card>;
  }
  return (
    <Card title="First, create next year">
      <p className="mb-4 text-[0.875rem] text-slate-600">
        Its sections and class teachers are copied from {current?.name ?? 'this year'}, without students. {current?.name} stays the current year until you switch in <Link to="/app/settings?tab=years" className="link">Settings</Link>.
      </p>
      <FormError message={create.error ? errorMessage(create.error) : null} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="ny-name" label="Year" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Field id="ny-start" label="Starts" type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} />
        <Field id="ny-end" label="Ends" type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} />
      </div>
      <button type="button" className="btn btn-ink mt-5" onClick={() => create.mutate()} disabled={create.isPending}>
        {create.isPending && <Spinner />} Create {form.name} <Icon name="arrow-right" size={16} />
      </button>
    </Card>
  );
}
