// Fee plans: for each group of classes, a grid of instalments (rows) by fee heads
// (columns). Saving a plan charges every student in those classes; editing it updates
// whatever they have not yet paid.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';
import { addDays, date, money, parseRupees, plural, rupeesInput } from '../../lib/format';
import { classLabel, useFeeHeads, useStructure, useYears } from '../../lib/queries';
import { useSchool } from '../../lib/school';
import { FormError } from '../../components/FormError';
import { Icon } from '../../components/Icon';
import { BackLink, Card, ConfirmDialog, EmptyState, ErrorState, Loading, Page, Spinner } from '../../components/ui';
import { useToast } from '../../lib/toast';

type Plan = {
  id: string;
  name: string;
  yearId: string;
  gradeIds: string[];
  instalments: { id: string; name: string; dueOn: string; amounts: Record<string, number> }[];
  totalPerStudent: number;
  studentCount: number;
};
type PlansResponse = { year: { id: string; name: string; startsOn: string; endsOn: string }; plans: Plan[] };

type Draft = {
  id: string | null;
  name: string;
  gradeIds: string[];
  instalments: { key: string; id?: string; name: string; dueOn: string; amounts: Record<string, string> }[];
};

export function FeePlans() {
  const school = useSchool();
  const plans = useQuery({ queryKey: ['fee-plans'], queryFn: () => api.get<PlansResponse>('/school/fees/plans') });
  const structure = useStructure();
  const heads = useFeeHeads();
  const [draft, setDraft] = useState<Draft | null>(null);
  const manage = school.can('fees.manage');
  const data = plans.data;
  const grades = structure.data?.grades ?? [];
  const taken = new Map<string, string>();
  for (const p of data?.plans ?? []) for (const g of p.gradeIds) taken.set(g, p.id);
  const unplanned = grades.filter((g) => !taken.has(g.id));

  return (
    <Page
      title="Fee plans"
      lead={data ? `${data.year.name}. Each class follows one plan.` : ' '}
      back={<BackLink to="/app/fees">Fees</BackLink>}
      actions={manage && !draft && <button type="button" className="btn btn-sun btn-sm" onClick={() => setDraft(newDraft(data?.year, unplanned.map((g) => g.id)))}><Icon name="plus" size={16} /> New plan</button>}
    >
      {(plans.error || heads.error) && <ErrorState error={plans.error ?? heads.error} retry={() => plans.refetch()} />}
      {(plans.isPending || heads.isPending || structure.isPending) && <Loading rows={4} />}

      {draft && data && heads.data && (
        <PlanEditor draft={draft} setDraft={setDraft} heads={heads.data} grades={grades} taken={taken} year={data.year} onDone={() => setDraft(null)} />
      )}

      {!draft && data && heads.data && (
        <div className="space-y-5">
          {unplanned.length > 0 && data.plans.length > 0 && (
            <p className="rounded-xl bg-marigold-50 px-4 py-3 text-[0.875rem] text-marigold-700 ring-1 ring-marigold-100">
              Not on any plan yet: {unplanned.map((g) => classLabel(g.name)).join(', ')}. Students there are not being charged.
            </p>
          )}
          {data.plans.length === 0 && (
            <Card>
              <EmptyState icon="fees" title="No fee plans yet" action={manage ? <button type="button" className="btn btn-ink btn-sm" onClick={() => setDraft(newDraft(data.year, unplanned.map((g) => g.id)))}>Make the first plan</button> : undefined}>
                Many schools have three or four: pre-primary, primary, middle and senior. Each sets instalments and amounts for its classes.
              </EmptyState>
            </Card>
          )}
          {data.plans.map((p) => (
            <Card
              key={p.id}
              pad={false}
              title={
                <div>
                  <h2 className="text-[1.0625rem]">{p.name}</h2>
                  <p className="text-[0.8125rem] text-slate-500">
                    {p.gradeIds.map((g) => classLabel(grades.find((x) => x.id === g)?.name ?? '?')).join(', ')}. {plural(p.studentCount, 'student')}.
                  </p>
                </div>
              }
              action={manage && <button type="button" className="btn btn-line btn-sm" onClick={() => setDraft(toDraft(p))}><Icon name="edit" size={14} /> Edit</button>}
            >
              <PlanGrid plan={p} heads={heads.data} />
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}

function PlanGrid({ plan, heads }: { plan: Plan; heads: { id: string; name: string }[] }) {
  const used = heads.filter((h) => plan.instalments.some((i) => i.amounts[h.id]));
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Instalment</th>
            <th>Due</th>
            {used.map((h) => <th key={h.id} className="r">{h.name}</th>)}
            <th className="r">Total</th>
          </tr>
        </thead>
        <tbody>
          {plan.instalments.map((i) => (
            <tr key={i.id}>
              <td className="font-semibold">{i.name}</td>
              <td className="whitespace-nowrap text-slate-600">{date(i.dueOn)}</td>
              {used.map((h) => <td key={h.id} className="r money">{i.amounts[h.id] ? money(i.amounts[h.id]) : <span className="text-slate-300">—</span>}</td>)}
              <td className="r money font-semibold">{money(Object.values(i.amounts).reduce((a, b) => a + b, 0))}</td>
            </tr>
          ))}
          <tr className="bg-slate-50">
            <td colSpan={2} className="font-bold">Year, per student</td>
            {used.map((h) => <td key={h.id} className="r money font-semibold">{money(plan.instalments.reduce((s, i) => s + (i.amounts[h.id] ?? 0), 0))}</td>)}
            <td className="r money text-[1rem] font-bold">{money(plan.totalPerStudent)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

let keySeq = 0;
const k = () => `k${++keySeq}`;

function newDraft(year: { startsOn: string } | undefined, gradeIds: string[]): Draft {
  const start = year?.startsOn ?? new Date().toISOString().slice(0, 10);
  return {
    id: null,
    name: '',
    gradeIds,
    instalments: [
      { key: k(), name: 'Term 1', dueOn: addDays(start, 9), amounts: {} },
      { key: k(), name: 'Term 2', dueOn: addDays(start, 191), amounts: {} },
    ],
  };
}

function toDraft(p: Plan): Draft {
  return {
    id: p.id,
    name: p.name,
    gradeIds: p.gradeIds,
    instalments: p.instalments.map((i) => ({ key: k(), id: i.id, name: i.name, dueOn: i.dueOn, amounts: Object.fromEntries(Object.entries(i.amounts).map(([h, v]) => [h, rupeesInput(v)])) })),
  };
}

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function schedule(kind: 'monthly' | 'quarterly' | 'terms' | 'yearly', startsOn: string, terms: { name: string; startsOn: string }[]) {
  const [y, m] = startsOn.split('-').map(Number);
  const at = (offset: number) => {
    const d = new Date(Date.UTC(y, m - 1 + offset, 10));
    return { label: monthNames[d.getUTCMonth()], iso: d.toISOString().slice(0, 10) };
  };
  if (kind === 'monthly') return Array.from({ length: 12 }, (_, i) => ({ name: at(i).label, dueOn: at(i).iso }));
  if (kind === 'quarterly') return Array.from({ length: 4 }, (_, i) => ({ name: `Quarter ${i + 1}`, dueOn: at(i * 3).iso }));
  if (kind === 'terms' && terms.length) return terms.map((t) => ({ name: t.name, dueOn: addDays(t.startsOn, 9) }));
  return [{ name: 'Annual', dueOn: at(0).iso }];
}

function PlanEditor({
  draft,
  setDraft,
  heads,
  grades,
  taken,
  year,
  onDone,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  heads: { id: string; name: string }[];
  grades: { id: string; name: string; sections: { strength: number }[] }[];
  taken: Map<string, string>;
  year: { id: string; name: string; startsOn: string };
  onDone: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const years = useYears();
  const terms = years.data?.find((y) => y.id === year.id)?.terms ?? [];
  const [shownHeads, setShownHeads] = useState<string[]>(() => {
    const used = heads.filter((h) => draft.instalments.some((i) => i.amounts[h.id])).map((h) => h.id);
    return used.length ? used : heads.slice(0, 3).map((h) => h.id);
  });
  const [newHead, setNewHead] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const addHead = useMutation({
    mutationFn: (name: string) => api.post<{ id: string; name: string }>('/school/fees/heads', { name }),
    onSuccess: (h) => {
      queryClient.invalidateQueries({ queryKey: ['fee-heads'] });
      setShownHeads([...shownHeads, h.id]);
      setNewHead('');
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });

  const body = useMemo(
    () => ({
      name: draft.name.trim(),
      gradeIds: draft.gradeIds,
      instalments: draft.instalments.map((i) => ({
        id: i.id,
        name: i.name,
        dueOn: i.dueOn,
        // A column taken off the grid is sent as zero, so its charges are cleared rather than left behind.
        amounts: Object.fromEntries([...new Set([...shownHeads, ...Object.keys(i.amounts)])].map((h) => [h, shownHeads.includes(h) ? (parseRupees(i.amounts[h] ?? '') ?? 0) : 0])),
      })),
    }),
    [draft, shownHeads],
  );

  const save = useMutation({
    mutationFn: () => (draft.id ? api.put<{ sync: { created: number; updated: number; skipped: number } }>(`/school/fees/plans/${draft.id}`, body) : api.post<{ sync: { created: number; updated: number; skipped: number } }>('/school/fees/plans', body)),
    onSuccess: (r) => {
      queryClient.invalidateQueries();
      const s = r.sync;
      toast(
        draft.id
          ? `Saved. ${s.updated ? `${plural(s.updated, 'unpaid charge')} updated` : 'No charges needed changing'}${s.created ? `, ${s.created} added` : ''}${s.skipped ? `, ${s.skipped} left as paid` : ''}.`
          : `Plan saved. ${plural(s.created, 'charge')} created for students in these classes.`,
      );
      onDone();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/school/fees/plans/${draft.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast('Plan deleted');
      onDone();
    },
    onError: (e) => {
      setConfirmDelete(false);
      toast(errorMessage(e), 'bad');
    },
  });

  const totals = shownHeads.map((h) => draft.instalments.reduce((s, i) => s + (parseRupees(i.amounts[h] ?? '') ?? 0), 0));
  const grand = totals.reduce((a, b) => a + b, 0);
  const students = grades.filter((g) => draft.gradeIds.includes(g.id)).reduce((s, g) => s + g.sections.reduce((t, x) => t + x.strength, 0), 0);
  const setInst = (key: string, patch: Partial<Draft['instalments'][number]>) => setDraft({ ...draft, instalments: draft.instalments.map((i) => (i.key === key ? { ...i, ...patch } : i)) });

  return (
    <div className="space-y-5">
      <Card>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
          <label className="block">
            <span className="input-label">Plan name</span>
            <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Primary (1 to 5)" autoFocus />
          </label>
          <div>
            <p className="input-label">Classes on this plan</p>
            <div className="flex flex-wrap gap-1.5">
              {grades.map((g) => {
                const on = draft.gradeIds.includes(g.id);
                const elsewhere = taken.has(g.id) && taken.get(g.id) !== draft.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    disabled={elsewhere}
                    title={elsewhere ? 'On another plan' : undefined}
                    aria-pressed={on}
                    onClick={() => setDraft({ ...draft, gradeIds: on ? draft.gradeIds.filter((x) => x !== g.id) : [...draft.gradeIds, g.id] })}
                    className={`min-h-9 rounded-full border px-3 text-[0.8125rem] font-semibold disabled:cursor-not-allowed disabled:opacity-35 ${on ? 'border-ink-800 bg-ink-800 text-white' : 'border-slate-300 bg-white text-slate-600'}`}
                  >
                    {g.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Card>

      <Card
        title="Instalments and amounts"
        pad={false}
        action={
          <span className="flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-slate-500">
            Start from:
            {(['monthly', 'quarterly', 'terms', 'yearly'] as const).filter((x) => x !== 'terms' || terms.length).map((kind) => (
              <button key={kind} type="button" className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-200" onClick={() => setDraft({ ...draft, instalments: schedule(kind, year.startsOn, terms).map((s, idx) => ({ key: k(), id: draft.instalments[idx]?.id, name: s.name, dueOn: s.dueOn, amounts: draft.instalments[idx]?.amounts ?? draft.instalments[0]?.amounts ?? {} })) })}>
                {{ monthly: 'Monthly', quarterly: 'Quarterly', terms: 'By term', yearly: 'Once a year' }[kind]}
              </button>
            ))}
          </span>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-[0.875rem]">
            <thead>
              <tr className="text-left text-[0.75rem] text-slate-500">
                <th className="border-b border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Instalment</th>
                <th className="border-b border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Due on</th>
                {shownHeads.map((h) => (
                  <th key={h} className="min-w-28 border-b border-slate-200 bg-slate-50 px-3 py-2 text-right font-semibold">
                    <span className="inline-flex items-center gap-1">
                      {heads.find((x) => x.id === h)?.name}
                      <button type="button" aria-label="Remove column" className="text-slate-400 hover:text-coral-700" onClick={() => setShownHeads(shownHeads.filter((x) => x !== h))}><Icon name="x" size={12} /></button>
                    </span>
                  </th>
                ))}
                <th className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-right font-semibold">Total</th>
                <th className="w-8 border-b border-slate-200 bg-slate-50" />
              </tr>
            </thead>
            <tbody>
              {draft.instalments.map((i) => {
                const rowTotal = shownHeads.reduce((s, h) => s + (parseRupees(i.amounts[h] ?? '') ?? 0), 0);
                return (
                  <tr key={i.key}>
                    <td className="border-b border-slate-100 p-1.5"><input className="input input-sm min-w-28" value={i.name} onChange={(e) => setInst(i.key, { name: e.target.value })} aria-label="Instalment name" /></td>
                    <td className="border-b border-slate-100 p-1.5"><input type="date" className="input input-sm" value={i.dueOn} onChange={(e) => setInst(i.key, { dueOn: e.target.value })} aria-label="Due on" /></td>
                    {shownHeads.map((h) => (
                      <td key={h} className="border-b border-slate-100 p-1.5">
                        <input
                          className="input input-sm money text-right"
                          inputMode="decimal"
                          placeholder="0"
                          value={i.amounts[h] ?? ''}
                          onChange={(e) => setInst(i.key, { amounts: { ...i.amounts, [h]: e.target.value.replace(/[^\d.,]/g, '') } })}
                          aria-label={`${heads.find((x) => x.id === h)?.name}, ${i.name}`}
                        />
                      </td>
                    ))}
                    <td className="money border-b border-slate-100 px-3 text-right font-semibold">{money(rowTotal)}</td>
                    <td className="border-b border-slate-100 pr-1.5">
                      {draft.instalments.length > 1 && (
                        <button type="button" className="btn btn-quiet btn-icon" aria-label={`Remove ${i.name}`} onClick={() => setDraft({ ...draft, instalments: draft.instalments.filter((x) => x.key !== i.key) })}><Icon name="trash" size={14} /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-slate-50 font-bold">
                <td colSpan={2} className="px-3 py-2.5">Year, per student</td>
                {totals.map((t, idx) => <td key={shownHeads[idx]} className="money px-3 text-right">{money(t)}</td>)}
                <td className="money px-3 text-right text-[1rem]">{money(grand)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
          <button type="button" className="btn btn-line btn-sm" onClick={() => setDraft({ ...draft, instalments: [...draft.instalments, { key: k(), name: `Instalment ${draft.instalments.length + 1}`, dueOn: addDays(draft.instalments[draft.instalments.length - 1]?.dueOn ?? year.startsOn, 30), amounts: {} }] })}>
            <Icon name="plus" size={14} /> Instalment
          </button>
          <select className="input input-sm w-auto" value="" onChange={(e) => e.target.value && setShownHeads([...shownHeads, e.target.value])} aria-label="Add a fee head column">
            <option value="">Add a fee head column</option>
            {heads.filter((h) => !shownHeads.includes(h.id)).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (newHead.trim()) addHead.mutate(newHead.trim()); }}>
            <input className="input input-sm w-40" value={newHead} onChange={(e) => setNewHead(e.target.value)} placeholder="New fee head" aria-label="New fee head" />
            <button type="submit" className="btn btn-quiet btn-sm" disabled={addHead.isPending}>Add</button>
          </form>
        </div>
      </Card>

      <div className="sticky bottom-20 z-20 flex flex-col gap-3 rounded-2xl bg-ink-800 p-4 text-white shadow-card sm:flex-row sm:items-center lg:bottom-4" data-surface="dark">
        <p className="flex-1 text-[0.9375rem]">
          <b className="money">{money(grand)}</b> a year for each of {plural(students, 'student')} on this plan
          {students > 0 && <span className="text-slate-300"> ({money(grand * students)} in all)</span>}.
        </p>
        <FormError message={save.error ? errorMessage(save.error) : null} />
        {draft.id && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(true)}>Delete plan</button>}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>Cancel</button>
        <button type="button" className="btn btn-sun btn-sm" disabled={!body.name || !body.gradeIds.length || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Spinner />} {draft.id ? 'Save and update charges' : 'Save and charge students'}
        </button>
      </div>

      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete ${draft.name}?`} confirmLabel="Delete plan" danger pending={remove.isPending} onConfirm={() => remove.mutate()}>
        Unpaid charges from this plan are removed from every student on it. A plan that has had fees collected against it cannot be deleted.
      </ConfirmDialog>
    </div>
  );
}
