// One receipt, as the parent keeps it: the same slip the school prints, without anything
// internal to the office (who took the money, notes, why a receipt was cancelled).
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { date, money, phone } from '../../lib/format';
import type { ParentReceipt as ReceiptData } from '../../lib/parent';
import { Icon } from '../../components/Icon';
import { ErrorState, Loading } from '../../components/ui';

export function ParentReceipt() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['parent', 'receipt', id], queryFn: () => api.get<ReceiptData>(`/parent/receipts/${id}`) });

  return (
    <div className="flex flex-1 flex-col">
      <div data-surface="dark" className="no-print wrap max-w-3xl pb-5 pt-6">
        <button type="button" onClick={() => navigate(-1)} className="inline-flex items-center gap-1 text-[0.8125rem] font-semibold text-slate-400 hover:text-white">
          <Icon name="chevron-left" size={15} /> Back
        </button>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-[1.5rem]">Receipt</h1>
          {q.data && (
            <button type="button" className="btn btn-sun btn-sm" onClick={() => window.print()}>
              <Icon name="printer" size={16} /> Print or save
            </button>
          )}
        </div>
      </div>

      <div className="sheet-paper print-plain flex-1 pb-16">
        <div className="wrap max-w-3xl pt-5">
          {q.isPending ? <Loading rows={6} /> : q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : <Slip r={q.data} />}
        </div>
      </div>
    </div>
  );
}

function Slip({ r }: { r: ReceiptData }) {
  const p = r.receipt;
  const voided = p.status !== 'valid';
  return (
    <>
      <article className="print-plain relative mx-auto max-w-[40rem] overflow-hidden bg-white text-ink-800 shadow-lift ring-1 ring-slate-200">
        <div className="no-print h-3 bg-[radial-gradient(circle_at_8px_-2px,var(--color-paper)_7px,transparent_7.5px)] bg-[length:16px_12px] bg-repeat-x" aria-hidden="true" />
        <div className="px-5 pb-8 pt-5 sm:px-10">
          <header className="flex items-start justify-between gap-4 border-b border-dashed border-slate-300 pb-4">
            <div className="min-w-0">
              <h2 className="text-[1.125rem] sm:text-[1.25rem]" style={{ fontStretch: '115%' }}>
                {r.school.name}
              </h2>
              {r.school.address && <p className="text-[0.75rem] text-slate-600">{r.school.address}</p>}
              <p className="text-[0.75rem] text-slate-600">
                {[r.school.phone && phone(r.school.phone), r.school.email, r.school.affiliationNo && `${r.school.board ?? ''} affiliation ${r.school.affiliationNo}`]
                  .filter(Boolean)
                  .join(', ')}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[0.6875rem] font-semibold text-slate-500">Fee receipt</p>
              <p className="num text-[0.875rem] font-bold sm:text-[0.9375rem]">{p.receiptNo}</p>
              <p className="text-[0.75rem] text-slate-600">{date(p.paidOn)}</p>
            </div>
          </header>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 py-4 text-[0.8125rem]">
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-slate-500">For student</dt>
              <dd className="m-0 font-semibold">{r.student.name}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Class</dt>
              <dd className="m-0 font-semibold">{r.student.classLabel ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Admission no.</dt>
              <dd className="num m-0 font-semibold">{r.student.admissionNo}</dd>
            </div>
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
                <td className="money pt-3 text-right text-[1.25rem] font-bold" style={{ fontStretch: '112%' }}>
                  {money(p.amount)}
                </td>
              </tr>
            </tfoot>
          </table>
          <p className="mt-2 text-[0.8125rem] italic text-slate-600">{p.amountInWords}</p>

          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg bg-slate-50 p-3 text-[0.8125rem]">
            <div>
              <dt className="text-slate-500">Paid by</dt>
              <dd className="m-0 font-semibold">
                {p.modeLabel}
                {p.reference ? `, ${p.reference}` : ''}
              </dd>
            </div>
            {r.balanceNow !== null && (
              <div>
                <dt className="text-slate-500">Balance due now</dt>
                <dd className="money m-0 font-semibold">{money(r.balanceNow)}</dd>
              </div>
            )}
          </dl>
        </div>

        {voided && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
            <span className="-rotate-12 rounded-lg border-4 border-coral-500 px-6 py-2 text-center text-[2.25rem] font-extrabold leading-none text-coral-500/80" style={{ fontStretch: '118%' }}>
              {p.status === 'cancelled' ? 'CANCELLED' : 'RETURNED'}
            </span>
          </div>
        )}
      </article>

      {voided && (
        <p className="no-print mx-auto mt-4 max-w-[40rem] rounded-xl bg-coral-50 px-4 py-3 text-[0.875rem] text-coral-700 ring-1 ring-coral-100">
          {p.status === 'bounced'
            ? `The bank returned this payment${p.bouncedOn ? ` on ${date(p.bouncedOn)}` : ''}, so the fees it was for are due again. Ask the school office if this is unexpected.`
            : 'The school cancelled this receipt, so it does not count as a payment. Ask the school office if this is unexpected.'}
        </p>
      )}
      <p className="no-print mx-auto mt-4 max-w-[40rem] text-center text-[0.8125rem] text-slate-500">
        To keep a copy, choose “Print or save”, then “Save as PDF”. <Link to="/parent">Back to home</Link>
      </p>
    </>
  );
}
