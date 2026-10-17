// One child, as a parent sees them: today first, then what the school shares — attendance,
// fees, receipts, details — each a tab only if the school has it switched on. The server
// refuses anything switched off, so a missing tab is never just hidden data.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { date, money, monthName, phone } from '../../lib/format';
import { markLabel, useChild } from '../../lib/parent';
import type { AttendanceMonth, ChildSummary, ParentFees, ParentReceipts } from '../../lib/parent';
import { Icon } from '../../components/Icon';
import type { IconName } from '../../lib/icons';
import { Avatar, Card, EmptyState, ErrorState, Loading } from '../../components/ui';
import { TodayPill } from './parts';

type Tab = 'overview' | 'attendance' | 'fees' | 'receipts';

export function ParentChild() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const q = useChild(id);

  if (q.isPending) {
    return (
      <Frame>
        <Loading rows={5} />
      </Frame>
    );
  }
  if (q.error || !q.data) {
    return (
      <Frame>
        <ErrorState error={q.error} retry={() => q.refetch()} />
      </Frame>
    );
  }

  const d = q.data;
  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'overview', label: 'Overview', icon: 'record' },
    ...(d.sections.attendance !== 'off' ? [{ id: 'attendance' as const, label: 'Attendance', icon: 'attendance' as const }] : []),
    ...(d.sections.fees ? [{ id: 'fees' as const, label: 'Fees', icon: 'fees' as const }] : []),
    ...(d.sections.receipts !== 'off' ? [{ id: 'receipts' as const, label: 'Receipts', icon: 'receipt' as const }] : []),
  ];
  const asked = params.get('tab') as Tab | null;
  const tab: Tab = tabs.some((t) => t.id === asked) ? asked! : 'overview';

  return (
    <div className="flex flex-1 flex-col">
      <div data-surface="dark" className="wrap max-w-3xl pb-5 pt-6">
        <div className="flex items-center gap-3.5">
          <Avatar name={d.child.name} size={52} tone="bg-marigold-400 text-night" />
          <div className="min-w-0">
            <h1 className="truncate text-[1.5rem] sm:text-[1.75rem]">{d.child.name}</h1>
            <p className="truncate text-[0.875rem] text-slate-300">
              {[d.child.classLabel && `Class ${d.child.classLabel}`, d.child.rollNo && `Roll ${d.child.rollNo}`, d.school.name].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        {d.attendance && (
          <div className="mt-4">
            <TodayPill today={d.attendance.today} large />
          </div>
        )}
        {tabs.length > 1 && (
          <div className="seg mt-5 w-full border-white/10 bg-white/5 sm:w-auto" role="tablist" aria-label="Sections">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setParams(t.id === 'overview' ? {} : { tab: t.id }, { replace: true })}
                className={`flex-1 sm:flex-none ${tab === t.id ? '!bg-white !text-ink-800' : '!text-slate-300 hover:!text-white'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="sheet-paper flex-1 pb-16">
        <div className="wrap max-w-3xl pt-5">
          {tab === 'overview' && <Overview d={d} go={(t) => setParams({ tab: t }, { replace: true })} />}
          {tab === 'attendance' && <AttendanceTab id={id} mode={d.sections.attendance} />}
          {tab === 'fees' && <FeesTab id={id} />}
          {tab === 'receipts' && <ReceiptsTab id={id} />}
        </div>
      </div>
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="sheet-paper mt-6 flex-1 pb-16">
      <div className="wrap max-w-3xl pt-5">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function Overview({ d, go }: { d: ChildSummary; go: (t: Tab) => void }) {
  const a = d.attendance?.thisYear;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {d.attendance && a && (
        <Tile icon="attendance" title="Attendance this year" onOpen={() => go('attendance')}>
          {a.total === 0 ? (
            <p className="text-[0.9375rem] text-slate-500">No registers taken yet this year.</p>
          ) : (
            <>
              <p className="text-[2rem] font-bold leading-none text-ink-800" style={{ fontStretch: '112%' }}>
                {a.percent}%
              </p>
              <p className="mt-1.5 text-[0.8125rem] text-slate-500">
                {a.present + a.late} of {a.total} days in school{a.late ? `, ${a.late} late` : ''}
                {a.absent ? `, ${a.absent} absent` : ''}
              </p>
              <Meter present={a.present} late={a.late} absent={a.absent} />
            </>
          )}
        </Tile>
      )}

      {d.fees && (
        <Tile icon="fees" title="Fees" onOpen={() => go('fees')}>
          {d.fees.due === 0 ? (
            <p className="flex items-center gap-2 text-[1.0625rem] font-bold text-lagoon-700">
              <Icon name="check" size={18} /> All paid up
            </p>
          ) : (
            <>
              <p className={`money text-[2rem] font-bold leading-none ${d.fees.overdue > 0 ? 'text-coral-700' : 'text-ink-800'}`} style={{ fontStretch: '112%' }}>
                {money(d.fees.due)}
              </p>
              <p className="mt-1.5 text-[0.8125rem] text-slate-500">
                {d.fees.overdue > 0 ? (
                  <b className="text-coral-700">{money(d.fees.overdue)} is overdue.</b>
                ) : d.fees.nextDue ? (
                  <>
                    Next: {d.fees.nextDue.label}, {money(d.fees.nextDue.balance)} by {date(d.fees.nextDue.dueOn)}
                  </>
                ) : (
                  'Due'
                )}
              </p>
            </>
          )}
        </Tile>
      )}

      <Card className="sm:col-span-2" title="School">
        <dl className="grid gap-x-6 gap-y-3 text-[0.9375rem] sm:grid-cols-2">
          <Fact label="School" value={d.school.name} />
          {d.child.classLabel && <Fact label="Class" value={`${d.child.classLabel}${d.child.yearName ? `, ${d.child.yearName}` : ''}`} />}
          {d.classTeacher && <Fact label="Class teacher" value={d.classTeacher} />}
          <Fact label="Admission no." value={<span className="num">{d.child.admissionNo}</span>} />
          {d.details?.dateOfBirth && <Fact label="Date of birth" value={date(d.details.dateOfBirth)} />}
          {d.details?.bloodGroup && <Fact label="Blood group" value={d.details.bloodGroup} />}
          {d.details?.address && <Fact label="Address" value={d.details.address} wide />}
        </dl>
        {(d.school.phone || d.school.email) && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            {d.school.phone && (
              <a href={`tel:+91${d.school.phone}`} className="btn btn-line btn-sm">
                <Icon name="phone" size={15} /> Call the school, <span className="num">{phone(d.school.phone)}</span>
              </a>
            )}
            {d.school.email && (
              <a href={`mailto:${d.school.email}`} className="btn btn-line btn-sm">
                <Icon name="mail" size={15} /> Email
              </a>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function Tile({ icon, title, onOpen, children }: { icon: IconName; title: string; onOpen: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onOpen} className="card block w-full p-4 text-left transition-shadow hover:shadow-lift sm:p-5">
      <p className="mb-3 flex items-center justify-between text-[0.8125rem] font-bold text-slate-500">
        <span className="flex items-center gap-1.5">
          <Icon name={icon} size={15} className="text-lagoon-600" /> {title}
        </span>
        <Icon name="chevron-right" size={16} className="text-slate-400" />
      </p>
      {children}
    </button>
  );
}

function Fact({ label, value, wide }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-[0.75rem] font-semibold text-slate-500">{label}</dt>
      <dd className="m-0 font-semibold text-ink-800">{value}</dd>
    </div>
  );
}

function Meter({ present, late, absent }: { present: number; late: number; absent: number }) {
  const total = present + late + absent || 1;
  return (
    <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
      <span className="bg-lagoon-500" style={{ width: `${(present / total) * 100}%` }} />
      <span className="bg-marigold-400" style={{ width: `${(late / total) * 100}%` }} />
      <span className="bg-coral-500" style={{ width: `${(absent / total) * 100}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function AttendanceTab({ id, mode }: { id: string; mode: 'off' | 'summary' | 'daily' }) {
  const thisMonth = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const q = useQuery({ queryKey: ['parent', 'attendance', id, month], queryFn: () => api.get<AttendanceMonth>(`/parent/children/${id}/attendance?month=${month}`) });

  return (
    <Card
      title={
        <div className="flex w-full items-center justify-between gap-2">
          <button type="button" className="btn btn-quiet btn-icon" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
            <Icon name="chevron-left" size={18} />
          </button>
          <h2 className="text-[1rem]">{monthName(month)}</h2>
          <button type="button" className="btn btn-quiet btn-icon" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth} aria-label="Next month">
            <Icon name="chevron-right" size={18} />
          </button>
        </div>
      }
    >
      {q.isPending ? (
        <Loading rows={3} />
      ) : q.error ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Count n={q.data.summary.present} label="Present" tone="text-lagoon-700" />
            <Count n={q.data.summary.late} label="Late" tone="text-marigold-700" />
            <Count n={q.data.summary.absent} label="Absent" tone="text-coral-700" />
          </div>
          {q.data.summary.total === 0 && <p className="mt-4 text-center text-[0.875rem] text-slate-500">No registers taken this month.</p>}
          {q.data.days && <Calendar days={q.data.days} />}
          {mode === 'summary' && q.data.summary.total > 0 && (
            <p className="mt-4 text-center text-[0.8125rem] text-slate-500">
              {q.data.summary.percent}% this month. The school shares monthly totals, not each day.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function Count({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className="rounded-xl bg-slate-50 py-3">
      <p className={`num text-[1.5rem] font-bold leading-none ${tone}`}>{n}</p>
      <p className="mt-1 text-[0.75rem] font-semibold text-slate-500">{label}</p>
    </div>
  );
}

function Calendar({ days }: { days: NonNullable<AttendanceMonth['days']> }) {
  // Weeks start on Monday, as Indian school timetables do.
  const first = new Date(`${days[0].date}T00:00:00Z`).getUTCDay();
  const lead = (first + 6) % 7;
  const styles = { P: 'bg-lagoon-500 text-white', L: 'bg-marigold-400 text-night', A: 'bg-coral-500 text-white' } as const;
  return (
    <div className="mt-5">
      <div className="grid grid-cols-7 gap-1.5 text-center text-[0.6875rem] font-bold text-slate-400" aria-hidden="true">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <ol className="mt-1.5 grid grid-cols-7 gap-1.5">
        {Array.from({ length: lead }, (_, i) => (
          <li key={`lead-${i}`} aria-hidden="true" />
        ))}
        {days.map((d) => {
          const n = Number(d.date.slice(8));
          const label = d.mark ? markLabel[d.mark] : d.holiday ? `Holiday: ${d.holiday}` : !d.working ? 'No school' : d.future ? '' : 'Not marked';
          return (
            <li
              key={d.date}
              title={label}
              aria-label={`${date(d.date)}${label ? `: ${label}` : ''}`}
              className={`grid aspect-square place-items-center rounded-lg text-[0.8125rem] font-semibold ${
                d.mark ? styles[d.mark] : d.holiday ? 'bg-slate-200 text-slate-500' : !d.working || d.future ? 'text-slate-300' : 'bg-white text-slate-500 ring-1 ring-slate-200'
              }`}
            >
              {n}
            </li>
          );
        })}
      </ol>
      <ul className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[0.75rem] text-slate-500">
        <Legend className="bg-lagoon-500" label="Present" />
        <Legend className="bg-marigold-400" label="Late" />
        <Legend className="bg-coral-500" label="Absent" />
        <Legend className="bg-slate-200" label="Holiday" />
      </ul>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className={`size-2.5 rounded-sm ${className}`} aria-hidden="true" />
      {label}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------

function FeesTab({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['parent', 'fees', id], queryFn: () => api.get<ParentFees>(`/parent/children/${id}/fees`) });
  if (q.isPending) return <Loading rows={4} />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const f = q.data;
  const open = f.charges.filter((c) => c.balance > 0);
  const paid = f.charges.filter((c) => c.balance <= 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <p className="text-[0.75rem] font-bold text-slate-500">Due</p>
          <p className={`money mt-1 text-[1.5rem] font-bold ${f.totals.due > 0 ? 'text-ink-800' : 'text-lagoon-700'}`}>{money(f.totals.due)}</p>
        </div>
        <div className="card p-4">
          <p className="text-[0.75rem] font-bold text-slate-500">Overdue</p>
          <p className={`money mt-1 text-[1.5rem] font-bold ${f.totals.overdue > 0 ? 'text-coral-700' : 'text-slate-400'}`}>{money(f.totals.overdue)}</p>
        </div>
      </div>

      {f.charges.length === 0 ? (
        <div className="card">
          <EmptyState icon="fees" title="No fees yet">
            Nothing has been charged for {f.yearName ?? 'this year'} so far.
          </EmptyState>
        </div>
      ) : (
        <>
          {open.length > 0 && (
            <Card title="To pay" pad={false}>
              <ul className="divide-y divide-slate-100">
                {open.map((c) => (
                  <ChargeRow key={c.id} c={c} />
                ))}
              </ul>
            </Card>
          )}
          {paid.length > 0 && (
            <Card title="Paid" pad={false}>
              <ul className="divide-y divide-slate-100">
                {paid.map((c) => (
                  <ChargeRow key={c.id} c={c} />
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
      <p className="text-center text-[0.8125rem] text-slate-500">To pay, visit the school office.</p>
    </div>
  );
}

function ChargeRow({ c }: { c: ParentFees['charges'][number] }) {
  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <p className="font-semibold text-ink-800">
          {c.label}
          {c.lateFee && <span className="tag tag-coral ml-1.5 align-middle">Late fee</span>}
          {c.earlierYear && <span className="tag tag-slate ml-1.5 align-middle">Last year</span>}
        </p>
        <p className={`text-[0.8125rem] ${c.overdue ? 'font-semibold text-coral-700' : 'text-slate-500'}`}>
          {c.balance > 0 ? `${c.overdue ? 'Was due' : 'Due'} ${date(c.dueOn)}` : `Due ${date(c.dueOn)}`}
          {c.concession > 0 && <span className="font-normal text-slate-500"> · {money(c.concession)} concession</span>}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {c.balance > 0 ? (
          <>
            <p className="money font-bold text-ink-800">{money(c.balance)}</p>
            {c.paid > 0 && <p className="money text-[0.75rem] text-slate-500">of {money(c.net)}</p>}
          </>
        ) : (
          <p className="flex items-center gap-1 text-[0.875rem] font-semibold text-lagoon-700">
            <Icon name="check" size={14} /> <span className="money">{money(c.net)}</span>
          </p>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

function ReceiptsTab({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['parent', 'receipts', id], queryFn: () => api.get<ParentReceipts>(`/parent/children/${id}/receipts`) });
  if (q.isPending) return <Loading rows={4} />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { receipts, canOpen } = q.data;
  if (receipts.length === 0) {
    return (
      <div className="card">
        <EmptyState icon="receipt" title="No receipts yet">
          Receipts appear here as soon as the school records a payment.
        </EmptyState>
      </div>
    );
  }
  return (
    <Card pad={false}>
      <ul className="divide-y divide-slate-100">
        {receipts.map((r) => {
          const body = (
            <>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-lagoon-50 text-lagoon-600">
                <Icon name="receipt" size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="num block truncate font-semibold text-ink-800">{r.receiptNo}</span>
                <span className="block text-[0.8125rem] text-slate-500">
                  {date(r.paidOn)} · {r.modeLabel}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className={`money block font-bold ${r.status === 'valid' ? 'text-ink-800' : 'text-slate-400 line-through'}`}>{money(r.amount)}</span>
                {r.status !== 'valid' && <span className="tag tag-coral">{r.status === 'bounced' ? 'Returned by bank' : 'Cancelled'}</span>}
              </span>
              {canOpen && <Icon name="chevron-right" size={16} className="shrink-0 text-slate-400" />}
            </>
          );
          return (
            <li key={r.id}>
              {canOpen ? (
                <Link to={`/parent/receipts/${r.id}`} className="flex items-center gap-3 px-4 py-3 no-underline hover:bg-slate-50 sm:px-5">
                  {body}
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3 sm:px-5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
