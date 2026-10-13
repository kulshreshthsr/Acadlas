// A fee receipt, laid out as the paper slip it will be printed as: school header,
// numbered receipt, what the money cleared, the amount in words as Indian receipts show
// it, and the balance left. Cancelling one keeps it on file, stamped, with the reason.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';
import { date, money, parseRupees, phone, whatsappLink } from '../../lib/format';
import { useSchool } from '../../lib/school';
import { Field } from '../../components/Field';
import { FormError } from '../../components/FormError';
import { Icon } from '../../components/Icon';
import { BackLink, Dialog, ErrorState, Loading, Page, Spinner } from '../../components/ui';
import { useToast } from '../../lib/toast';

type ReceiptData = {
  payment: {
    id: string;
    receiptNo: string;
    amount: number;
    mode: string;
    reference: string | null;
    paidOn: string;
    note: string | null;
    receivedByName: string | null;
    status: 'valid' | 'cancelled' | 'bounced';
    cancelledAt: string | null;
    cancelledByName: string | null;
    cancelReason: string | null;
    bouncedOn: string | null;
    bounceReason: string | null;
    createdAt: string;
  };
  modeLabel: string;
  statusLabel: string;
  amountInWords: string;
  lines: { label: string; amount: number; dueOn: string }[];
  student: { id: string; name: string; admissionNo: string };
  class: { label: string; rollNo: number | null } | null;
  guardian: { name: string; phone: string | null; relation: string } | null;
  school: { name: string; address: string; phone: string | null; email: string | null; affiliationNo: string | null; board: string | null };
  balanceNow: number;
};

export function Receipt() {
  const { id = '' } = useParams();
  const school = useSchool();
  const toast = useToast();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['receipt', id], queryFn: () => api.get<ReceiptData>(`/school/fees/payments/${id}`) });
  const [open, setOpen] = useState<null | 'cancel' | 'bounce'>(null);
  const [reason, setReason] = useState('');
  const [bouncedOn, setBouncedOn] = useState(school.today);
  const [bankCharge, setBankCharge] = useState('');

  const close = () => {
    setOpen(null);
    setReason('');
    setBankCharge('');
  };
  const cancel = useMutation({
    mutationFn: () => api.post(`/school/fees/payments/${id}/cancel`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast('Receipt cancelled');
      close();
    },
  });
  const bounce = useMutation({
    mutationFn: () => api.post(`/school/fees/payments/${id}/bounce`, { bouncedOn, reason, bankCharge: parseRupees(bankCharge) ?? undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast('Marked as returned by the bank');
      close();
    },
  });

  if (q.isPending) return <Page title="Receipt"><Loading /></Page>;
  if (q.error || !q.data) return <Page title="Receipt"><ErrorState error={q.error} /></Page>;
  const r = q.data;
  const p = r.payment;
  const cancelled = p.status === 'cancelled';
  const bounced = p.status === 'bounced';
  // Either way the money is off the books, so the slip is stamped and nothing may be sent.
  const voided = cancelled || bounced;
  // A bank can only send back something it was asked to clear. Cash and card cannot bounce.
  const canBounce = school.can('fees.manage') && !voided && p.mode !== 'cash' && p.mode !== 'card';
  const share = r.guardian?.phone
    ? whatsappLink(r.guardian.phone, `Dear ${r.guardian.name}, we have received ${money(p.amount)} towards the fees of ${r.student.name} (${r.class?.label ?? ''}) on ${date(p.paidOn)}. Receipt no. ${p.receiptNo}.${r.balanceNow > 0 ? ` Balance due: ${money(r.balanceNow)}.` : ' All fees due are paid.'} Thank you. — ${r.school.name}`)
    : null;

  return (
    <Page
      title={`Receipt ${p.receiptNo}`}
      lead={`${r.student.name}, ${money(p.amount)}, ${date(p.paidOn)}`}
      back={<BackLink to={`/app/fees/collect/${r.student.id}`}>{r.student.name}’s fees</BackLink>}
      actions={
        <>
          <button type="button" className="btn btn-sun btn-sm" onClick={() => window.print()}><Icon name="printer" size={16} /> Print</button>
          {share && !voided && <a href={share} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm"><Icon name="message" size={15} /> Send on WhatsApp</a>}
          {canBounce && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen('bounce')}>Returned by bank</button>}
          {school.can('fees.manage') && !voided && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen('cancel')}>Cancel receipt</button>}
        </>
      }
    >
      <article className="print-plain relative mx-auto max-w-[40rem] overflow-hidden bg-white text-ink-800 shadow-lift ring-1 ring-slate-200">
        {/* The torn edge of a receipt book. */}
        <div className="no-print h-3 bg-[radial-gradient(circle_at_8px_-2px,var(--color-paper)_7px,transparent_7.5px)] bg-[length:16px_12px] bg-repeat-x" aria-hidden="true" />
        <div className="px-6 pb-8 pt-5 sm:px-10">
          <header className="flex items-start justify-between gap-4 border-b border-dashed border-slate-300 pb-4">
            <div>
              <h2 className="text-[1.25rem]" style={{ fontStretch: '115%' }}>{r.school.name}</h2>
              {r.school.address && <p className="text-[0.75rem] text-slate-600">{r.school.address}</p>}
              <p className="text-[0.75rem] text-slate-600">{[r.school.phone && phone(r.school.phone), r.school.email, r.school.affiliationNo && `${r.school.board ?? ''} affiliation ${r.school.affiliationNo}`].filter(Boolean).join(', ')}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[0.6875rem] font-semibold text-slate-500">Fee receipt</p>
              <p className="num text-[0.9375rem] font-bold">{p.receiptNo}</p>
              <p className="text-[0.75rem] text-slate-600">{date(p.paidOn)}</p>
            </div>
          </header>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 py-4 text-[0.8125rem] sm:grid-cols-4">
            <div className="col-span-2"><dt className="text-slate-500">Received from</dt><dd className="m-0 font-semibold">{r.guardian?.name ?? '—'}</dd></div>
            <div className="col-span-2"><dt className="text-slate-500">For student</dt><dd className="m-0 font-semibold">{r.student.name}</dd></div>
            <div><dt className="text-slate-500">Class</dt><dd className="m-0 font-semibold">{r.class?.label ?? '—'}</dd></div>
            <div><dt className="text-slate-500">Roll</dt><dd className="m-0 font-semibold">{r.class?.rollNo ?? '—'}</dd></div>
            <div className="col-span-2"><dt className="text-slate-500">Admission no.</dt><dd className="num m-0 font-semibold">{r.student.admissionNo}</dd></div>
          </dl>

          <table className="w-full text-[0.875rem]">
            <thead>
              <tr className="border-y border-slate-200 text-left text-[0.75rem] text-slate-500">
                <th className="py-2 font-semibold">Towards</th>
                <th className="py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2">{l.label}</td>
                  <td className="money py-2 text-right">{money(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="pt-3 font-bold">Total received</td>
                <td className="money pt-3 text-right text-[1.25rem] font-bold" style={{ fontStretch: '112%' }}>{money(p.amount)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="mt-2 text-[0.8125rem] italic text-slate-600">{r.amountInWords}</p>

          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg bg-slate-50 p-3 text-[0.8125rem]">
            <div><dt className="text-slate-500">Paid by</dt><dd className="m-0 font-semibold">{r.modeLabel}{p.reference ? `, ${p.reference}` : ''}</dd></div>
            <div><dt className="text-slate-500">Balance due now</dt><dd className="money m-0 font-semibold">{money(r.balanceNow)}</dd></div>
            {p.note && <div className="col-span-2"><dt className="text-slate-500">Note</dt><dd className="m-0">{p.note}</dd></div>}
          </dl>

          <footer className="mt-12 flex items-end justify-between text-[0.75rem] text-slate-500">
            <span>Received by {p.receivedByName}</span>
            <span className="border-t border-slate-400 pt-1">Authorised signature</span>
          </footer>
        </div>

        {voided && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
            <span className="-rotate-12 rounded-lg border-4 border-coral-500 px-6 py-2 text-center text-[2.5rem] font-extrabold leading-none text-coral-500/80" style={{ fontStretch: '118%' }}>
              {cancelled ? 'CANCELLED' : 'RETURNED'}
            </span>
          </div>
        )}
      </article>

      {cancelled && (
        <p className="no-print mx-auto mt-4 max-w-[40rem] rounded-xl bg-coral-50 px-4 py-3 text-[0.875rem] text-coral-700 ring-1 ring-coral-100">
          Cancelled by {p.cancelledByName} on {p.cancelledAt ? date(p.cancelledAt.slice(0, 10)) : ''}: {p.cancelReason}. The amount is back on the student’s dues.
        </p>
      )}
      {bounced && (
        <p className="no-print mx-auto mt-4 max-w-[40rem] rounded-xl bg-coral-50 px-4 py-3 text-[0.875rem] text-coral-700 ring-1 ring-coral-100">
          Returned by the bank on {p.bouncedOn ? date(p.bouncedOn) : ''}: {p.bounceReason}. The fees it had cleared are due again, and any late fee on them has started
          counting again from the original due date.
        </p>
      )}
      <p className="no-print mx-auto mt-4 max-w-[40rem] text-center text-[0.8125rem] text-slate-500">
        <Link to="/app/fees/collect" className="link">Collect another fee</Link>
      </p>

      <Dialog
        open={open === 'cancel'}
        onClose={close}
        title={`Cancel receipt ${p.receiptNo}?`}
        lead="For a receipt the school should not have written — entered twice, or against the wrong student. It stays on file, marked cancelled, and the amount goes back on the student’s dues. This cannot be undone."
        footer={
          <>
            <button type="button" className="btn btn-line btn-sm" onClick={close}>Keep it</button>
            <button type="button" className="btn btn-danger btn-sm" disabled={!reason.trim() || cancel.isPending} onClick={() => cancel.mutate()}>{cancel.isPending && <Spinner />} Cancel receipt</button>
          </>
        }
      >
        <FormError message={cancel.error ? errorMessage(cancel.error) : null} />
        <Field id="cancel-reason" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Entered twice, wrong student" />
        {canBounce && (
          <p className="mt-3 text-[0.8125rem] text-slate-600">
            If the money was really taken at the counter and the bank sent it back,{' '}
            <button type="button" className="link" onClick={() => { setReason(''); setOpen('bounce'); }}>mark it returned</button>{' '}
            instead — that keeps it apart from a mistake of the school’s own.
          </p>
        )}
      </Dialog>

      <Dialog
        open={open === 'bounce'}
        onClose={close}
        title={`Returned by the bank?`}
        lead={`Receipt ${p.receiptNo} for ${money(p.amount)} by ${r.modeLabel.toLowerCase()}. The fees it cleared go back on the student’s dues, and the receipt stays on file marked as returned — not cancelled, because the school did nothing wrong.`}
        footer={
          <>
            <button type="button" className="btn btn-line btn-sm" onClick={close}>Keep it</button>
            <button type="button" className="btn btn-danger btn-sm" disabled={!reason.trim() || bounce.isPending} onClick={() => bounce.mutate()}>{bounce.isPending && <Spinner />} Mark returned</button>
          </>
        }
      >
        <div className="space-y-4">
          <FormError message={bounce.error ? errorMessage(bounce.error) : null} />
          <Field id="bounce-reason" label="What the bank said" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Insufficient funds, signature mismatch, cheque stale" />
          <div className="grid grid-cols-2 gap-3">
            <Field id="bounced-on" label="Date on the return memo" type="date" min={p.paidOn} max={school.today} value={bouncedOn} onChange={(e) => setBouncedOn(e.target.value)} />
            <Field
              id="bank-charge"
              label="Charge to pass on (₹)"
              inputMode="decimal"
              value={bankCharge}
              onChange={(e) => setBankCharge(e.target.value.replace(/[^\d.,]/g, ''))}
              placeholder="Optional"
              hint="Added to the student’s dues as a bank charge."
            />
          </div>
        </div>
      </Dialog>
    </Page>
  );
}
