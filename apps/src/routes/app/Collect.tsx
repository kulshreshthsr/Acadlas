// Collecting a fee at the counter: find the student (a parent usually gives a phone
// number or a name), see exactly what is owed, take the money, print the receipt.
//
// The amount is split across dues oldest-first, which is how the office would apply cash
// handed over the counter; the split is shown before anything is saved.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';
import { date, money, ordinal, parseRupees, phone, plural, rupeesInput } from '../../lib/format';
import { useFamily, useFeeHeads } from '../../lib/queries';
import { useSchool } from '../../lib/school';
import { Field } from '../../components/Field';
import { FormError } from '../../components/FormError';
import { Icon } from '../../components/Icon';
import { Avatar, BackLink, Card, CheckRow, ConfirmDialog, Dialog, EmptyState, ErrorState, Loading, Page, SelectField, Spinner } from '../../components/ui';
import { useToast } from '../../lib/toast';

type Charge = {
  id: string;
  label: string;
  headId: string;
  yearId: string;
  instalmentName: string | null;
  dueOn: string;
  amount: number;
  concession: number;
  concessionNote: string | null;
  net: number;
  paid: number;
  balance: number;
  manual: boolean;
  kind: 'plan' | 'fine' | 'manual';
};
/** An earlier year the student still owes for. Promotion moves the child, not the debt. */
type BroughtForward = { yearId: string; yearName: string; startsOn: string; net: number; paid: number; balance: number; charges: Charge[] };
type Ledger = {
  student: { id: string; name: string; admissionNo: string; status: string; isRte: boolean };
  class: { label: string; rollNo: number | null } | null;
  guardian: { name: string; phone: string | null; relation: string } | null;
  year: { name: string };
  charges: Charge[];
  broughtForward: BroughtForward[];
  payments: { id: string; receiptNo: string; amount: number; mode: string; paidOn: string; status: string; reference: string | null; receivedByName: string | null; cancelReason: string | null; allocations: { chargeId: string; label: string; amount: number }[] }[];
  concessions: { id: string; headId: string | null; headName: string | null; percent: number; reason: string }[];
  totals: {
    gross: number;
    concession: number;
    net: number;
    paid: number;
    balance: number;
    overdue: number;
    fine: number;
    broughtForward: number;
    /** Everything owed across every year — what a payment may actually be made against. */
    balanceAll: number;
  };
};

const modes = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'bank', label: 'Bank' },
] as const;

export function Collect() {
  const { studentId } = useParams();
  return studentId ? <LedgerScreen studentId={studentId} /> : <PickStudent />;
}

function PickStudent() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(id);
  }, [q]);
  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get<{ students: { id: string; name: string; admissionNo: string; classLabel: string | null; guardianPhone: string | null; status: string }[] }>(`/school/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
  });

  return (
    <Page title="Collect a fee" lead="Find the student by name, admission number or a parent’s phone number." back={<BackLink to="/app/fees">Fees</BackLink>}>
      <div className="mx-auto max-w-2xl">
        <label className="relative block">
          <span className="sr-only">Find a student</span>
          <Icon name="search" size={19} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input min-h-14 rounded-2xl pl-12 text-[1.0625rem]" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Aarav, ADM/2026/0418 or 98765 43210" autoFocus />
        </label>
        {debounced.length >= 2 && results.data && (
          <ul className="card mt-3 divide-y divide-slate-100">
            {results.data.students.length === 0 && <li className="p-5 text-center text-[0.875rem] text-slate-500">No student matches “{debounced}”.</li>}
            {results.data.students.map((s) => (
              <li key={s.id}>
                <Link to={`/app/fees/collect/${s.id}`} className="flex items-center gap-3 px-4 py-3 no-underline hover:bg-slate-50">
                  <Avatar name={s.name} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink-800">{s.name}</span>
                    <span className="block truncate text-[0.8125rem] text-slate-500">{[s.classLabel ?? 'No class', s.admissionNo, s.guardianPhone && phone(s.guardianPhone)].filter(Boolean).join(', ')}</span>
                  </span>
                  <Icon name="chevron-right" size={16} className="text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Page>
  );
}

function LedgerScreen({ studentId }: { studentId: string }) {
  const school = useSchool();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const ledger = useQuery({ queryKey: ['ledger', studentId], queryFn: () => api.get<Ledger>(`/school/fees/students/${studentId}`) });
  const [typedAmount, setAmountText] = useState<string | null>(null);
  const [mode, setMode] = useState<(typeof modes)[number]['value']>('cash');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(school.today);
  const [note, setNote] = useState('');
  const [dialog, setDialog] = useState<null | 'charge' | 'concession' | { waive: Charge } | { removeConcession: string }>(null);

  const l = ledger.data;
  // Money handed over the counter clears the oldest dues first across every year, so the
  // preview has to work from the same list in the same order the server will: last year's
  // unpaid instalment before this year's, and an instalment before its own late fee.
  const outstanding = useMemo(() => {
    if (!l) return [];
    return [...l.broughtForward.flatMap((y) => y.charges), ...l.charges]
      .filter((c) => c.balance > 0)
      .sort(
        (a, b) =>
          a.dueOn.localeCompare(b.dueOn) ||
          Number(a.kind === 'fine') - Number(b.kind === 'fine') ||
          a.label.localeCompare(b.label),
      );
  }, [l]);

  // Arrears are overdue by definition, so they belong in the figure the office reaches for.
  const overdueAll = l ? l.totals.broughtForward + l.totals.overdue : 0;
  // Charged, paid and due are shown across every year a balance is still open in, so the
  // three figures reconcile — charged minus paid is the due — rather than one of them
  // quietly covering this year while the money went to last year's instalment.
  const chargedAll = l ? l.totals.net + l.broughtForward.reduce((sum, y) => sum + y.net, 0) : 0;
  const paidAll = l ? l.totals.paid + l.broughtForward.reduce((sum, y) => sum + y.paid, 0) : 0;

  // Until someone types an amount, suggest what is overdue (or the next due).
  const amountText = typedAmount ?? rupeesInput(l ? overdueAll || outstanding[0]?.balance || 0 : 0);

  const amount = parseRupees(amountText);
  const split = useMemo(() => {
    const result: { charge: Charge; take: number }[] = [];
    let left = amount ?? 0;
    for (const c of outstanding) {
      if (left <= 0) break;
      const take = Math.min(left, c.balance);
      result.push({ charge: c, take });
      left -= take;
    }
    return { parts: result, over: Math.max(0, left) };
  }, [amount, outstanding]);

  const pay = useMutation({
    mutationFn: () => api.post<{ id: string; receiptNo: string }>('/school/fees/payments', { studentId, amount, mode, reference: reference || null, paidOn, note: note || null }),
    onSuccess: (p) => {
      queryClient.invalidateQueries();
      toast(`Receipt ${p.receiptNo} saved`);
      navigate(`/app/fees/receipts/${p.id}`);
    },
  });

  if (ledger.isPending) return <Page title="Collect a fee" back={<BackLink to="/app/fees/collect">Find another student</BackLink>}><Loading rows={6} /></Page>;
  if (ledger.error || !l) return <Page title="Collect a fee"><ErrorState error={ledger.error} retry={() => ledger.refetch()} /></Page>;

  const quick = [
    l.totals.broughtForward > 0 ? { label: 'Arrears', value: l.totals.broughtForward } : null,
    overdueAll > 0 ? { label: 'Overdue', value: overdueAll } : null,
    outstanding[0]
      ? {
          // Name the year when the oldest due is an earlier year's, so "Term 1" cannot be
          // mistaken for this year's Term 1 sitting further down the same list.
          label: `${outstanding[0].instalmentName ?? outstanding[0].label}${l.broughtForward.find((y) => y.yearId === outstanding[0].yearId) ? ` (${l.broughtForward.find((y) => y.yearId === outstanding[0].yearId)!.yearName})` : ''}`,
          value: outstanding.filter((c) => c.dueOn === outstanding[0].dueOn).reduce((s, c) => s + c.balance, 0),
        }
      : null,
    l.totals.balanceAll > 0 ? { label: 'Everything due', value: l.totals.balanceAll } : null,
  ].filter((x, i, arr): x is { label: string; value: number } => Boolean(x) && arr.findIndex((y) => y?.value === x!.value) === i);

  const canCollect = school.can('fees.collect');
  const manage = school.can('fees.manage');

  return (
    <Page
      title={l.student.name}
      lead={[l.class ? `Class ${l.class.label}` : 'No class', l.student.admissionNo, l.guardian ? `${l.guardian.name}${l.guardian.phone ? `, ${phone(l.guardian.phone)}` : ''}` : null].filter(Boolean).join(', ')}
      back={<BackLink to="/app/fees/collect">Find another student</BackLink>}
      actions={<Link to={`/app/students/${studentId}`} className="btn btn-ghost btn-sm"><Icon name="record" size={15} /> Student record</Link>}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="min-w-0 space-y-5">
          <section className="card grid grid-cols-3 divide-x divide-slate-100">
            {[
              {
                k: 'Charged',
                v: money(chargedAll),
                c: 'text-ink-800',
                // With arrears the three figures span years, so say what this year's share is.
                note: l.broughtForward.length > 0 ? `${money(l.totals.net)} of it this year` : l.totals.fine > 0 ? `${money(l.totals.fine)} late fee` : null,
              },
              { k: 'Paid', v: money(paidAll), c: 'text-lagoon-700', note: null },
              {
                k: 'Due',
                v: money(l.totals.balanceAll),
                c: overdueAll ? 'text-coral-700' : 'text-ink-800',
                note: l.totals.broughtForward > 0 ? `${money(l.totals.broughtForward)} of it from earlier years` : null,
              },
            ].map((t) => (
              <div key={t.k} className="px-4 py-4 sm:px-5">
                <p className="text-[0.75rem] font-semibold text-slate-500">{t.k}</p>
                <p className={`money text-[1.25rem] font-bold sm:text-[1.5rem] ${t.c}`} style={{ fontStretch: '112%' }}>{t.v}</p>
                {t.note && <p className="mt-0.5 text-[0.75rem] text-slate-500">{t.note}</p>}
              </div>
            ))}
          </section>

          {l.broughtForward.map((y) => (
            <Card
              key={y.yearId}
              title={`Brought forward from ${y.yearName}`}
              pad={false}
              action={<span className="money text-[0.9375rem] font-bold text-coral-700">{money(y.balance)}</span>}
            >
              <ul className="divide-y divide-slate-100">
                {y.charges
                  .filter((c) => c.balance > 0)
                  .map((c) => {
                    const inSplit = split.parts.find((p) => p.charge.id === c.id);
                    return (
                      <li key={c.id} className={`flex items-center gap-3 px-4 py-3 sm:px-5 ${inSplit ? 'bg-marigold-50/60' : ''}`}>
                        <span className="size-2 shrink-0 rounded-full bg-coral-500" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[0.9375rem] font-semibold text-ink-800">
                            {c.label}
                            {c.kind === 'fine' && <span className="tag tag-slate ml-1.5">Late fee</span>}
                          </span>
                          <span className="block text-[0.75rem] text-coral-700">Was due {date(c.dueOn)}</span>
                        </span>
                        {inSplit && <span className="tag tag-sun hidden sm:inline-flex">−{money(inSplit.take)}</span>}
                        <span className="money font-semibold text-ink-800">{money(c.balance)}</span>
                        {manage && (
                          <button type="button" className="btn btn-quiet btn-xs" onClick={() => setDialog({ waive: c })} title="Waive">Waive</button>
                        )}
                      </li>
                    );
                  })}
              </ul>
            </Card>
          ))}

          <Card
            title={`Charges, ${l.year.name}`}
            pad={false}
            action={manage && (
              <span className="flex gap-1">
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => setDialog('concession')}><Icon name="percent" size={14} /> Concession</button>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => setDialog('charge')}><Icon name="plus" size={14} /> Add charge</button>
              </span>
            )}
          >
            {l.charges.length === 0 ? (
              <EmptyState icon="fees" title="Nothing charged this year">
                {l.student.isRte ? 'RTE admission — fees are waived.' : 'This student’s class has no fee plan yet.'}
              </EmptyState>
            ) : (
              <ul className="divide-y divide-slate-100">
                {l.charges.map((c) => {
                  const overdue = c.balance > 0 && c.dueOn < school.today;
                  const inSplit = split.parts.find((p) => p.charge.id === c.id);
                  return (
                    <li key={c.id} className={`flex items-center gap-3 px-4 py-3 sm:px-5 ${inSplit ? 'bg-marigold-50/60' : ''}`}>
                      <span className={`size-2 shrink-0 rounded-full ${c.balance === 0 ? 'bg-lagoon-500' : overdue ? 'bg-coral-500' : 'bg-slate-300'}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.9375rem] font-semibold text-ink-800">
                          {c.label}
                          {c.kind === 'fine' && <span className="tag tag-slate ml-1.5">Late fee</span>}
                        </span>
                        <span className={`block text-[0.75rem] ${overdue ? 'text-coral-700' : 'text-slate-500'}`}>
                          {c.balance === 0 ? 'Paid' : `Due ${date(c.dueOn)}`}
                          {c.concession > 0 && <span className="text-slate-500">, {money(c.concession)} off ({c.concessionNote})</span>}
                        </span>
                      </span>
                      {inSplit && <span className="tag tag-sun hidden sm:inline-flex">−{money(inSplit.take)}</span>}
                      <span className="text-right">
                        <span className={`money block font-semibold ${c.balance === 0 ? 'text-slate-400 line-through' : 'text-ink-800'}`}>{money(c.balance === 0 ? c.net : c.balance)}</span>
                        {c.paid > 0 && c.balance > 0 && <span className="money block text-[0.75rem] text-slate-500">of {money(c.net)}</span>}
                      </span>
                      {manage && c.balance > 0 && (
                        <button type="button" className="btn btn-quiet btn-xs" onClick={() => setDialog({ waive: c })} title="Waive">Waive</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {l.concessions.length > 0 && (
            <Card title="Standing concessions">
              <ul className="space-y-2 text-[0.875rem]">
                {l.concessions.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3">
                    <span><b className="text-ink-800">{c.percent}%</b> off {c.headName ?? 'all fees'}: {c.reason}</span>
                    {manage && <button type="button" className="btn btn-quiet btn-xs" onClick={() => setDialog({ removeConcession: c.id })}>Remove</button>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Receipts" pad={false}>
            {l.payments.length === 0 ? (
              <p className="px-5 py-4 text-[0.875rem] text-slate-500">No payments yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {l.payments.map((p) => (
                  <li key={p.id}>
                    <Link to={`/app/fees/receipts/${p.id}`} className={`flex items-center gap-3 px-4 py-3 no-underline hover:bg-slate-50 sm:px-5 ${p.status === 'valid' ? '' : 'opacity-55'}`}>
                      <Icon name="receipt" size={17} className="shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1">
                        <span className="num block font-semibold text-ink-800">
                          {p.receiptNo}{' '}
                          {p.status === 'cancelled' && <span className="tag tag-coral">Cancelled</span>}
                          {p.status === 'bounced' && <span className="tag tag-coral">Returned by bank</span>}
                        </span>
                        <span className="block truncate text-[0.75rem] text-slate-500">{date(p.paidOn)}, {modes.find((m) => m.value === p.mode)?.label}, {p.allocations.map((a) => a.label).join('; ')}</span>
                      </span>
                      <span className={`money font-semibold text-ink-800 ${p.status === 'valid' ? '' : 'line-through'}`}>{money(p.amount)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {canCollect && (
          <aside className="order-first min-w-0 lg:order-none">
            <div className="sticky top-6 overflow-hidden rounded-[var(--radius-xl)] bg-white shadow-lift ring-1 ring-slate-200">
              <div className="bg-ink-800 px-5 py-4" data-surface="dark">
                <h2 className="text-[1.0625rem]">Receive a payment</h2>
                <p className="text-[0.8125rem] text-slate-300">{l.totals.balanceAll ? `${money(l.totals.balanceAll)} due in all` : 'Nothing is due right now'}</p>
              </div>
              {l.totals.balanceAll === 0 ? (
                <p className="p-5 text-[0.875rem] text-slate-600">Every charge is paid. Add a charge first if money is being received for something new.</p>
              ) : (
                <form
                  className="space-y-4 p-5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (amount && !split.over) pay.mutate();
                  }}
                >
                  <FormError message={pay.error ? errorMessage(pay.error) : null} />
                  <div>
                    <label className="input-label" htmlFor="amount">Amount received</label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[1.375rem] font-bold text-slate-400">₹</span>
                      <input id="amount" inputMode="decimal" className="input money min-h-14 pl-10 text-[1.5rem] font-bold" value={amountText} onChange={(e) => setAmountText(e.target.value.replace(/[^\d.,]/g, ''))} aria-invalid={amountText !== '' && (!amount || split.over > 0) ? true : undefined} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {quick.map((qk) => (
                        <button key={qk.label} type="button" onClick={() => setAmountText(rupeesInput(qk.value))} className="rounded-full bg-slate-100 px-2.5 py-1 text-[0.75rem] font-semibold text-slate-700 hover:bg-slate-200">
                          {qk.label}: {money(qk.value)}
                        </button>
                      ))}
                    </div>
                    {split.over > 0 && <p className="input-error">That is {money(split.over)} more than is due. Add a charge first for anything extra.</p>}
                  </div>

                  <div>
                    <p className="input-label">Paid by</p>
                    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-3 xl:grid-cols-5">
                      {modes.map((m) => (
                        <button key={m.value} type="button" aria-pressed={mode === m.value} onClick={() => setMode(m.value)} className={`min-h-10 rounded-xl border px-2 text-[0.8125rem] font-semibold ${mode === m.value ? 'border-ink-800 bg-ink-800 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {mode !== 'cash' && (
                    <Field id="ref" label={mode === 'cheque' ? 'Cheque number and bank' : mode === 'upi' ? 'UPI reference (UTR)' : 'Reference'} value={reference} onChange={(e) => setReference(e.target.value)} placeholder={mode === 'cheque' ? '004512, SBI' : 'Optional'} />
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <Field id="paid-on" label="Date" type="date" max={school.today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
                    <Field id="note" label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
                  </div>

                  {split.parts.length > 0 && !split.over && (
                    <div className="rounded-xl bg-slate-50 p-3 text-[0.8125rem]">
                      <p className="mb-1.5 font-semibold text-slate-600">This clears</p>
                      <ul className="space-y-1">
                        {split.parts.map((p) => {
                          const from = l.broughtForward.find((y) => y.yearId === p.charge.yearId);
                          return (
                            <li key={p.charge.id} className="flex justify-between gap-3">
                              <span className="truncate text-ink-800">
                                {p.charge.label}
                                {from ? ` (${from.yearName})` : ''}
                                {p.take < p.charge.balance ? ' (part)' : ''}
                              </span>
                              <span className="money font-semibold text-ink-800">{money(p.take)}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  <button type="submit" className="btn btn-sun w-full" disabled={!amount || split.over > 0 || pay.isPending || (mode === 'cheque' && !reference.trim())}>
                    {pay.isPending && <Spinner />}
                    {pay.isPending ? 'Saving receipt' : `Save receipt${amount ? ` for ${money(amount)}` : ''}`}
                  </button>
                </form>
              )}
            </div>
          </aside>
        )}
      </div>

      {dialog === 'charge' && <AddChargeDialog studentId={studentId} onClose={() => setDialog(null)} />}
      {dialog === 'concession' && <ConcessionDialog studentId={studentId} onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === 'object' && 'waive' in dialog && <WaiveDialog charge={dialog.waive} studentId={studentId} onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === 'object' && 'removeConcession' in dialog && <RemoveConcession id={dialog.removeConcession} studentId={studentId} onClose={() => setDialog(null)} />}
    </Page>
  );
}

function useLedgerMutation(studentId: string, fn: () => Promise<unknown>, done: string, onClose: () => void) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ledger', studentId] });
      queryClient.invalidateQueries({ queryKey: ['student', studentId] });
      queryClient.invalidateQueries({ queryKey: ['fee-summary'] });
      queryClient.invalidateQueries({ queryKey: ['dues'] });
      toast(done);
      onClose();
    },
  });
}

function AddChargeDialog({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const school = useSchool();
  const heads = useFeeHeads();
  const [form, setForm] = useState({ headId: '', label: '', amount: '', dueOn: school.today });
  const save = useLedgerMutation(studentId, () => api.post(`/school/fees/students/${studentId}/charges`, { headId: form.headId, label: form.label || null, amount: parseRupees(form.amount), dueOn: form.dueOn }), 'Charge added', onClose);
  return (
    <Dialog open onClose={onClose} title="Add a charge" lead="Something only this student owes: a late fine, a lost ID card, a trip." footer={<><button type="button" className="btn btn-line btn-sm" onClick={onClose}>Cancel</button><button type="button" className="btn btn-ink btn-sm" disabled={!form.headId || !parseRupees(form.amount) || save.isPending} onClick={() => save.mutate()}>{save.isPending && <Spinner />} Add charge</button></>}>
      <div className="space-y-4">
        <FormError message={save.error ? errorMessage(save.error) : null} />
        <SelectField label="Fee head" value={form.headId} onChange={(e) => setForm({ ...form, headId: e.target.value })}>
          <option value="">Choose</option>
          {(heads.data ?? []).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </SelectField>
        <Field id="ch-label" label="Description" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Late fee, October" />
        <div className="grid grid-cols-2 gap-3">
          <Field id="ch-amount" label="Amount (₹)" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <Field id="ch-due" label="Due on" type="date" value={form.dueOn} onChange={(e) => setForm({ ...form, dueOn: e.target.value })} />
        </div>
      </div>
    </Dialog>
  );
}

/**
 * A standing discount. A sibling discount is decided for the family rather than child by
 * child, so the other children are offered here and the whole family is done in one
 * transaction — the alternative is remembering to repeat it on each record, and a family
 * where only some of the children got the discount is the usual result.
 */
function ConcessionDialog({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const heads = useFeeHeads();
  const toast = useToast();
  const queryClient = useQueryClient();
  const family = useFamily(studentId);
  const [form, setForm] = useState({ headId: '', percent: '25', reason: '' });
  const [also, setAlso] = useState<Record<string, boolean>>({});

  const others = (family.data?.family ?? []).filter((s) => !s.isSelf && s.status === 'active');
  const alsoIds = others.filter((s) => also[s.id]).map((s) => s.id);

  const save = useMutation({
    mutationFn: () =>
      api.post<{ applied: number }>(`/school/fees/students/${studentId}/concessions`, {
        headId: form.headId || null,
        percent: Number(form.percent),
        reason: form.reason,
        alsoStudentIds: alsoIds.length > 0 ? alsoIds : undefined,
      }),
    onSuccess: (r) => {
      // Siblings' ledgers changed too, so nothing cached about fees can be trusted.
      queryClient.invalidateQueries();
      toast(r.applied > 1 ? `Concession applied to ${plural(r.applied, 'child', 'children')}` : 'Concession applied to unpaid fees');
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Give a concession"
      lead="A standing discount. It applies to every unpaid charge this year and to new ones."
      footer={
        <>
          <button type="button" className="btn btn-line btn-sm" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-ink btn-sm" disabled={!form.reason.trim() || !Number(form.percent) || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Spinner />} Apply{alsoIds.length > 0 ? ` to ${alsoIds.length + 1}` : ''}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={save.error ? errorMessage(save.error) : null} />
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="On" value={form.headId} onChange={(e) => setForm({ ...form, headId: e.target.value })}>
            <option value="">All fees</option>
            {(heads.data ?? []).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </SelectField>
          <Field id="pc" label="Percent off" inputMode="numeric" value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
        </div>
        <div>
          <Field id="reason" label="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Second child, staff ward, merit scholarship" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {['Sibling', 'Staff ward', 'Merit scholarship', 'Financial hardship'].map((r) => (
              <button
                key={r}
                type="button"
                className="rounded-full bg-slate-100 px-2.5 py-1 text-[0.75rem] font-semibold text-slate-600 hover:bg-slate-200"
                onClick={() => {
                  setForm({ ...form, reason: r });
                  // "Sibling" is a discount for the family, so offer it that way at once.
                  if (r === 'Sibling') setAlso(Object.fromEntries(others.map((s) => [s.id, true])));
                }}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {others.length > 0 && (
          <div>
            <p className="input-label">Also apply to</p>
            <div className="space-y-1.5 rounded-xl bg-slate-50 p-3">
              {others.map((s) => (
                <CheckRow
                  key={s.id}
                  checked={Boolean(also[s.id])}
                  onChange={(v) => setAlso({ ...also, [s.id]: v })}
                  label={s.name}
                  hint={[s.classLabel ?? 'No class', `${ordinal(s.birthOrder)} child`, s.isRte ? 'RTE, fees already waived' : null].filter(Boolean).join(', ')}
                  disabled={s.isRte}
                />
              ))}
            </div>
            <p className="mt-1.5 text-[0.75rem] text-slate-500">Brothers and sisters already on file, by the parent’s phone number.</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function WaiveDialog({ charge, studentId, onClose }: { charge: Charge; studentId: string; onClose: () => void }) {
  const [amount, setAmount] = useState(rupeesInput(charge.balance));
  const [reason, setReason] = useState('');
  const save = useLedgerMutation(studentId, () => api.post(`/school/fees/charges/${charge.id}/waive`, { amount: parseRupees(amount), reason }), 'Waived', onClose);
  return (
    <Dialog open onClose={onClose} title={`Waive part of ${charge.label}`} lead={`${money(charge.balance)} is unpaid on it.`} footer={<><button type="button" className="btn btn-line btn-sm" onClick={onClose}>Cancel</button><button type="button" className="btn btn-ink btn-sm" disabled={!reason.trim() || !parseRupees(amount) || save.isPending} onClick={() => save.mutate()}>{save.isPending && <Spinner />} Waive {parseRupees(amount) ? money(parseRupees(amount)) : ''}</button></>}>
      <div className="space-y-4">
        <FormError message={save.error ? errorMessage(save.error) : null} />
        <Field id="w-amount" label="Amount to waive (₹)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Field id="w-reason" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Approved by the principal" />
      </div>
    </Dialog>
  );
}

function RemoveConcession({ id, studentId, onClose }: { id: string; studentId: string; onClose: () => void }) {
  const save = useLedgerMutation(studentId, () => api.del(`/school/fees/concessions/${id}`), 'Concession removed', onClose);
  return (
    <ConfirmDialog open onClose={onClose} title="Remove this concession?" confirmLabel="Remove concession" pending={save.isPending} onConfirm={() => save.mutate()}>
      Unpaid charges go back to their full amount. Anything already paid is not affected.
    </ConfirmDialog>
  );
}
