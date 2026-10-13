// Fees: where the year stands, who owes what, and what came in.
import { useState } from 'react';
import { Link, NavLink, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, withQuery } from '../../lib/api';
import { downloadCsv } from '../../lib/csv';
import { addDays, date, dateLong, money, parseRupees, phone, plural, whatsappLink } from '../../lib/format';
import { classLabel, sectionOptions, useStructure } from '../../lib/queries';
import { useSchool } from '../../lib/school';
import { Field } from '../../components/Field';
import { FormError } from '../../components/FormError';
import { Icon } from '../../components/Icon';
import { Avatar, Card, Dialog, EmptyState, ErrorState, Loading, Notice, Page, Spinner, Stat } from '../../components/ui';
import { useToast } from '../../lib/toast';

type Summary = {
  year: { name: string };
  rows: { gradeId: string | null; gradeName: string; students: number; billed: number; concession: number; collected: number; outstanding: number; overdue: number; fine: number; broughtForward: number }[];
  totals: { billed: number; concession: number; collected: number; outstanding: number; overdue: number; fine: number; broughtForward: number };
};
type Dues = {
  asOf: string;
  /** Everything unpaid, this year and earlier. */
  total: number;
  thisYear: number;
  broughtForward: number;
  fine: number;
  rows: {
    studentId: string;
    name: string;
    admissionNo: string;
    classLabel: string | null;
    rollNo: number | null;
    /** This year only. `total` is what the parent actually owes. */
    due: number;
    broughtForward: number;
    fine: number;
    total: number;
    oldestDue: string;
    charges: number;
    guardianName: string | null;
    guardianPhone: string | null;
  }[];
};
type Collections = {
  from: string;
  to: string;
  total: number;
  count: number;
  byMode: Record<string, number>;
  rows: { id: string; receiptNo: string; amount: number; mode: string; modeLabel: string; reference: string | null; paidOn: string; status: string; receivedByName: string | null; cancelReason: string | null; studentId: string; studentName: string; admissionNo: string }[];
};

/** One day's receipts as the accountant signs them off. */
type DayBookData = {
  date: string;
  close: { id: string; day: string; expectedCash: number; countedCash: number; variance: number; note: string | null; closedByName: string | null; closedAt: string } | null;
  expectedCash: number;
  totals: { collected: number; count: number; cancelled: number; cancelledCount: number; bounced: number; bouncedCount: number };
  byMode: { mode: string; modeLabel: string; amount: number; count: number }[];
  byCollector: { name: string; amount: number; count: number }[];
  stillOpen: { day: string; total: number }[];
  rows: {
    id: string;
    receiptNo: string;
    amount: number;
    mode: string;
    modeLabel: string;
    reference: string | null;
    status: 'valid' | 'cancelled' | 'bounced';
    statusLabel: string;
    note: string | null;
    receivedByName: string | null;
    cancelReason: string | null;
    bounceReason: string | null;
    studentId: string;
    studentName: string;
    admissionNo: string;
  }[];
};

export function Fees({ tab = 'overview' }: { tab?: 'overview' | 'dues' | 'collections' | 'daybook' }) {
  const school = useSchool();
  const tabs = [
    { to: '/app/fees', label: 'Overview', end: true },
    { to: '/app/fees/dues', label: 'Dues' },
    { to: '/app/fees/collections', label: 'Collections' },
    { to: '/app/fees/daybook', label: 'Day book' },
  ];
  return (
    <Page
      title="Fees"
      lead={school.currentYear ? `${school.currentYear.name}` : undefined}
      actions={
        <>
          {school.can('fees.collect') && (
            <Link to="/app/fees/collect" className="btn btn-sun btn-sm">
              <Icon name="fees" size={16} /> Collect a fee
            </Link>
          )}
          <Link to="/app/fees/plans" className="btn btn-ghost btn-sm">
            Fee plans
          </Link>
        </>
      }
      under={
        <nav className="seg border-white/10 bg-white/5" aria-label="Fees">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? '!bg-white !text-ink-800' : '!text-slate-300 hover:!text-white')}>
              {t.label}
            </NavLink>
          ))}
        </nav>
      }
    >
      {tab === 'overview' && <Overview />}
      {tab === 'dues' && <DuesList />}
      {tab === 'collections' && <CollectionsList />}
      {tab === 'daybook' && <DayBook />}
    </Page>
  );
}

function Overview() {
  const school = useSchool();
  const summary = useQuery({ queryKey: ['fee-summary'], queryFn: () => api.get<Summary>('/school/fees/summary'), enabled: school.can('reports.fees') });
  const today = useQuery({ queryKey: ['collections', school.today, school.today], queryFn: () => api.get<Collections>('/school/fees/collections') });

  if (!school.can('reports.fees')) {
    return (
      <div className="grid gap-5 sm:grid-cols-2">
        <Card><Stat label="Collected today" value={money(today.data?.total ?? 0)} note={plural(today.data?.count ?? 0, 'receipt')} /></Card>
        <Card><Link to="/app/fees/dues" className="link">See who has fees due</Link></Card>
      </div>
    );
  }

  if (summary.error) return <ErrorState error={summary.error} retry={() => summary.refetch()} />;
  if (summary.isPending) return <Loading rows={6} />;
  const s = summary.data;
  const pct = s.totals.billed - s.totals.concession > 0 ? Math.round((s.totals.collected / (s.totals.billed - s.totals.concession)) * 100) : 0;

  if (s.rows.length === 0) {
    return (
      <Card>
        <EmptyState icon="fees" title="No fees charged yet" action={school.can('fees.manage') ? <Link to="/app/fees/plans" className="btn btn-ink btn-sm">Make a fee plan</Link> : undefined}>
          A fee plan sets the instalments and amounts for each class. Every student in those classes is charged automatically.
        </EmptyState>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <section className="card grid grid-cols-2 divide-slate-100 md:grid-cols-5 md:divide-x">
        <div className="col-span-2 border-b border-slate-100 p-5 md:col-span-1 md:border-b-0">
          <p className="text-[0.8125rem] font-semibold text-slate-500">Collected so far</p>
          <p className="mt-1 text-[2.25rem] font-bold leading-none text-ink-800" style={{ fontStretch: '118%' }}>{pct}%</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-lagoon-500" style={{ width: `${pct}%` }} /></div>
        </div>
        <div className="p-5"><Stat label="Charged" value={money(s.totals.billed - s.totals.concession)} note={s.totals.concession ? `after ${money(s.totals.concession)} concessions` : undefined} /></div>
        <div className="p-5"><Stat label="Collected" value={money(s.totals.collected)} tone="lagoon" /></div>
        <div className="p-5"><Stat label="Still due" value={money(s.totals.outstanding)} note={s.totals.broughtForward ? `and ${money(s.totals.broughtForward)} from earlier years` : undefined} /></div>
        <div className="p-5"><Stat label="Overdue" value={money(s.totals.overdue)} tone={s.totals.overdue ? 'coral' : undefined} note={<Link to="/app/fees/dues" className="link">Who owes it</Link>} /></div>
      </section>

      <Card title="By class" pad={false}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Class</th>
                <th className="r">Students</th>
                <th className="r">Charged</th>
                <th className="r">Collected</th>
                <th className="w-[22%]">Progress</th>
                <th className="r">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r) => {
                const net = r.billed - r.concession;
                const p = net ? (r.collected / net) * 100 : 0;
                return (
                  <tr key={r.gradeId ?? 'none'}>
                    <td className="font-semibold">{classLabel(r.gradeName)}</td>
                    <td className="r num">{r.students}</td>
                    <td className="r money">{money(net)}</td>
                    <td className="r money text-lagoon-700">{money(r.collected)}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-lagoon-500" style={{ width: `${p}%` }} /></div>
                        <span className="num w-9 text-right text-[0.75rem] text-slate-500">{Math.round(p)}%</span>
                      </div>
                    </td>
                    <td className={`r money ${r.overdue ? 'font-semibold text-coral-700' : 'text-slate-400'}`}>{r.overdue ? money(r.overdue) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function DuesList() {
  const school = useSchool();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const sectionId = params.get('section') ?? '';
  const overdueOnly = params.get('all') !== '1';
  const structure = useStructure();
  const sections = sectionOptions(structure.data);
  const dues = useQuery({ queryKey: ['dues', sectionId, overdueOnly], queryFn: () => api.get<Dues>(withQuery('/school/fees/dues', { sectionId, overdueOnly })) });
  const d = dues.data;

  // A late fee grows with the calendar rather than with anything anyone does, so this list
  // can sit behind the fines until someone opens each student's ledger. Running it brings
  // every student's late fee up to today in one pass.
  const fines = useMutation({
    mutationFn: () => api.post<{ created: number; updated: number; removed: number }>('/school/fees/fines/apply', {}),
    onSuccess: (r) => {
      queryClient.invalidateQueries();
      const changed = r.created + r.updated + r.removed;
      toast(changed === 0 ? 'Late fees were already up to date' : `Late fees brought up to date on ${plural(changed, 'instalment')}`);
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input input-sm w-auto min-w-36" value={sectionId} onChange={(e) => setParams({ ...(e.target.value ? { section: e.target.value } : {}), ...(overdueOnly ? {} : { all: '1' }) })} aria-label="Class">
          <option value="">All classes</option>
          {sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <div className="seg">
          <button type="button" aria-pressed={overdueOnly} onClick={() => setParams({ ...(sectionId ? { section: sectionId } : {}) })}>Overdue</button>
          <button type="button" aria-pressed={!overdueOnly} onClick={() => setParams({ ...(sectionId ? { section: sectionId } : {}), all: '1' })}>Everything unpaid</button>
        </div>
        {d && (
          <p className="ml-auto text-[0.875rem] text-slate-600">
            <b className="money text-ink-800">{money(d.total)}</b> from {plural(d.rows.length, 'student')}
            {d.broughtForward > 0 && <span className="text-slate-500">, {money(d.broughtForward)} of it from earlier years</span>}
          </p>
        )}
        {school.can('fees.manage') && (
          <button type="button" className="btn btn-line btn-sm" onClick={() => fines.mutate()} disabled={fines.isPending} title="Work out every student’s late fee as of today">
            {fines.isPending ? <Spinner /> : <Icon name="refresh" size={14} />} Update late fees
          </button>
        )}
        <button
          type="button"
          className="btn btn-line btn-sm"
          disabled={!d?.rows.length}
          onClick={() =>
            downloadCsv(`fees-due-${school.today}.csv`, [
              ['Admission no.', 'Student', 'Class', 'Roll', 'Due this year (₹)', 'Earlier years (₹)', 'Late fee (₹)', 'Total due (₹)', 'Oldest due date', 'Guardian', 'Phone'],
              ...d!.rows.map((r) => [r.admissionNo, r.name, r.classLabel, r.rollNo, r.due / 100, r.broughtForward / 100, r.fine / 100, r.total / 100, r.oldestDue, r.guardianName, r.guardianPhone]),
            ])
          }
        >
          <Icon name="download" size={14} /> Export
        </button>
      </div>

      {dues.error && <ErrorState error={dues.error} retry={() => dues.refetch()} />}
      {dues.isPending && <Loading rows={6} />}
      {d && d.rows.length === 0 && (
        <Card><EmptyState icon="check" title={overdueOnly ? 'Nothing overdue' : 'Nothing unpaid'}>{overdueOnly ? 'Every instalment that has fallen due is paid.' : 'Every charge this year is paid.'}</EmptyState></Card>
      )}
      {d && d.rows.length > 0 && (
        <ul className="card divide-y divide-slate-100">
          {d.rows.map((r) => {
            const days = Math.round((new Date(`${school.today}T00:00:00Z`).getTime() - new Date(`${r.oldestDue}T00:00:00Z`).getTime()) / 86400000);
            return (
              <li key={r.studentId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
                <Link to={`/app/students/${r.studentId}`} className="flex min-w-0 flex-1 basis-56 items-center gap-3 no-underline">
                  <Avatar name={r.name} size={34} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink-800">{r.name}</span>
                    <span className="block truncate text-[0.8125rem] text-slate-500">{r.classLabel ?? '—'}{r.guardianPhone ? `, ${r.guardianName ?? ''} ${phone(r.guardianPhone)}` : ''}</span>
                  </span>
                </Link>
                <span className="w-44 text-[0.8125rem] text-slate-500">
                  {days > 0 ? <span className="text-coral-700">{plural(days, 'day')} overdue</span> : `due ${date(r.oldestDue)}`}
                  {r.broughtForward > 0 && <span className="block text-[0.75rem] text-coral-700">{money(r.broughtForward)} from earlier years</span>}
                  {r.fine > 0 && <span className="block text-[0.75rem] text-slate-500">{money(r.fine)} late fee</span>}
                </span>
                <span className="money w-24 text-right text-[1rem] font-bold text-ink-800">{money(r.total)}</span>
                <span className="flex gap-1.5">
                  {r.guardianPhone && (
                    <a
                      className="btn btn-line btn-xs"
                      target="_blank"
                      rel="noreferrer"
                      href={whatsappLink(r.guardianPhone, `Dear ${r.guardianName ?? 'Parent'}, this is a reminder that fees of ${money(r.total)} for ${r.name} (${r.classLabel}) are pending${days > 0 ? ` since ${date(r.oldestDue)}` : ''}. Please pay at the school office at the earliest. — ${school.school.name}`)}
                    >
                      <Icon name="message" size={13} /> Remind
                    </a>
                  )}
                  {school.can('fees.collect') && <Link to={`/app/fees/collect/${r.studentId}`} className="btn btn-ink btn-xs">Collect</Link>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CollectionsList() {
  const school = useSchool();
  const navigate = useNavigate();
  const [range, setRange] = useState({ from: school.today, to: school.today });
  const q = useQuery({ queryKey: ['collections', range.from, range.to], queryFn: () => api.get<Collections>(withQuery('/school/fees/collections', range)) });
  const d = q.data;
  const presets = [
    { label: 'Today', from: school.today, to: school.today },
    { label: 'Yesterday', from: addDays(school.today, -1), to: addDays(school.today, -1) },
    { label: 'Last 7 days', from: addDays(school.today, -6), to: school.today },
    { label: 'This month', from: `${school.today.slice(0, 7)}-01`, to: school.today },
  ];

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-2">
        <div className="seg">
          {presets.map((p) => (
            <button key={p.label} type="button" aria-pressed={range.from === p.from && range.to === p.to} onClick={() => setRange({ from: p.from, to: p.to })}>{p.label}</button>
          ))}
        </div>
        <input type="date" className="input input-sm w-auto" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} aria-label="From" />
        <span className="text-slate-400">to</span>
        <input type="date" className="input input-sm w-auto" value={range.to} min={range.from} max={school.today} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} aria-label="To" />
        <span className="ml-auto flex gap-2">
          <button type="button" className="btn btn-line btn-sm" disabled={!d?.rows.length} onClick={() => downloadCsv(`collections-${range.from}-to-${range.to}.csv`, [['Date', 'Receipt', 'Student', 'Admission no.', 'Mode', 'Reference', 'Amount (₹)', 'Received by', 'Status'], ...d!.rows.map((r) => [r.paidOn, r.receiptNo, r.studentName, r.admissionNo, r.modeLabel, r.reference, r.amount / 100, r.receivedByName, r.status])])}>
            <Icon name="download" size={14} /> Export
          </button>
          <button type="button" className="btn btn-line btn-sm" onClick={() => window.print()}><Icon name="printer" size={14} /> Print</button>
        </span>
      </div>

      {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Loading rows={6} />}
      {d && (
        <>
          <section className="card flex flex-wrap gap-x-10 gap-y-4 p-5">
            <Stat label={range.from === range.to ? `Collected, ${date(range.from)}` : `Collected, ${date(range.from)} to ${date(range.to)}`} value={money(d.total)} note={plural(d.count, 'receipt')} />
            {Object.entries(d.byMode).map(([mode, amount]) => (
              <Stat key={mode} label={{ cash: 'Cash', upi: 'UPI', card: 'Card', cheque: 'Cheque', bank: 'Bank transfer' }[mode] ?? mode} value={<span className="text-[1.125rem]">{money(amount)}</span>} />
            ))}
          </section>
          {d.rows.length === 0 ? (
            <Card><EmptyState icon="receipt" title="No receipts in these dates" /></Card>
          ) : (
            <div className="card overflow-x-auto">
              <table className="table">
                <thead>
                  <tr><th>Receipt</th><th>Date</th><th>Student</th><th>Mode</th><th className="r">Amount</th><th>Received by</th></tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.id} data-href onClick={() => navigate(`/app/fees/receipts/${r.id}`)} className={r.status === 'cancelled' ? 'opacity-55' : ''}>
                      <td className="num whitespace-nowrap font-semibold">{r.receiptNo}{r.status === 'cancelled' && <span className="tag tag-coral ml-2">Cancelled</span>}</td>
                      <td className="whitespace-nowrap text-slate-600">{date(r.paidOn)}</td>
                      <td>{r.studentName}</td>
                      <td className="text-slate-600">{r.modeLabel}{r.reference ? <span className="block text-[0.75rem] text-slate-400">{r.reference}</span> : null}</td>
                      <td className={`r money font-semibold ${r.status === 'cancelled' ? 'line-through' : ''}`}>{money(r.amount)}</td>
                      <td className="text-slate-600">{r.receivedByName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The day book: every receipt written on one day, totalled the way the person who took
 * the money has to account for it — by how it was paid, and by who took it.
 *
 * Closing a day is the accountant's signature on it. What was counted out of the drawer is
 * recorded next to what the system expected, so a shortfall is on file against the day it
 * happened instead of surfacing in a bank reconciliation weeks later. Once a day is
 * closed, nothing dated that day can be received, cancelled or returned, so the figure
 * that was reported upwards stays the figure on file.
 */
function DayBook() {
  const school = useSchool();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const day = params.get('day') ?? school.today;
  const q = useQuery({ queryKey: ['daybook', day], queryFn: () => api.get<DayBookData>(withQuery('/school/fees/daybook', { date: day })) });
  const [reopening, setReopening] = useState(false);
  const manage = school.can('fees.manage');
  const d = q.data;

  function go(value: string) {
    const next = new URLSearchParams(params);
    if (value === school.today) next.delete('day');
    else next.set('day', value);
    setParams(next, { replace: true });
  }

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" className="btn btn-line btn-sm" onClick={() => go(addDays(day, -1))} aria-label="The day before">
            <Icon name="chevron-left" size={15} />
          </button>
          <input type="date" className="input input-sm w-auto" max={school.today} value={day} onChange={(e) => e.target.value && go(e.target.value)} aria-label="Day" />
          <button type="button" className="btn btn-line btn-sm" onClick={() => go(addDays(day, 1))} disabled={day >= school.today} aria-label="The day after">
            <Icon name="chevron-right" size={15} />
          </button>
        </div>
        {day !== school.today && (
          <button type="button" className="btn btn-line btn-sm" onClick={() => go(school.today)}>
            Today
          </button>
        )}
        <span className="ml-auto flex gap-2">
          <button
            type="button"
            className="btn btn-line btn-sm"
            disabled={!d?.rows.length}
            onClick={() =>
              downloadCsv(`day-book-${day}.csv`, [
                ['Receipt', 'Student', 'Admission no.', 'Mode', 'Reference', 'Amount (₹)', 'Received by', 'Status', 'Reason'],
                ...d!.rows.map((r) => [r.receiptNo, r.studentName, r.admissionNo, r.modeLabel, r.reference, r.amount / 100, r.receivedByName, r.statusLabel, r.cancelReason ?? r.bounceReason]),
              ])
            }
          >
            <Icon name="download" size={14} /> Export
          </button>
          <button type="button" className="btn btn-line btn-sm" onClick={() => window.print()}>
            <Icon name="printer" size={14} /> Print
          </button>
        </span>
      </div>

      {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Loading rows={6} />}

      {d && (
        <>
          <p className="hidden text-[0.9375rem] font-semibold text-ink-800 print:block">Day book, {dateLong(d.date)}</p>

          {d.stillOpen.length > 0 && (
            <Notice tone="warn" icon="alert">
              <span className="font-semibold">
                {plural(d.stillOpen.length, 'earlier day')} took money and {d.stillOpen.length === 1 ? 'was' : 'were'} never signed off.
              </span>{' '}
              {d.stillOpen.slice(0, 6).map((o, i) => (
                <span key={o.day}>
                  {i > 0 && ', '}
                  <button type="button" className="link" onClick={() => go(o.day)}>
                    {date(o.day)} ({money(o.total)})
                  </button>
                </span>
              ))}
              {d.stillOpen.length > 6 && ` and ${d.stillOpen.length - 6} more`}.
            </Notice>
          )}

          {d.close ? (
            <section className="overflow-hidden rounded-[var(--radius-xl)] bg-white shadow-lift ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center gap-3 bg-ink-800 px-5 py-4" data-surface="dark">
                <Icon name="lock" size={18} className="text-lagoon-300" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-[1.0625rem]">Signed off</h2>
                  <p className="text-[0.8125rem] text-slate-300">
                    Closed by {d.close.closedByName} on {date(d.close.closedAt.slice(0, 10))}
                  </p>
                </div>
                {manage && (
                  <button type="button" className="btn btn-ghost btn-sm no-print" onClick={() => setReopening(true)}>
                    <Icon name="undo" size={15} /> Reopen
                  </button>
                )}
              </div>
              <dl className="grid grid-cols-3 divide-x divide-slate-100">
                <div className="px-4 py-4 sm:px-5">
                  <dt className="text-[0.75rem] font-semibold text-slate-500">Cash expected</dt>
                  <dd className="money m-0 text-[1.25rem] font-bold text-ink-800">{money(d.close.expectedCash)}</dd>
                </div>
                <div className="px-4 py-4 sm:px-5">
                  <dt className="text-[0.75rem] font-semibold text-slate-500">Cash counted</dt>
                  <dd className="money m-0 text-[1.25rem] font-bold text-ink-800">{money(d.close.countedCash)}</dd>
                </div>
                <div className="px-4 py-4 sm:px-5">
                  <dt className="text-[0.75rem] font-semibold text-slate-500">Difference</dt>
                  <dd className={`money m-0 text-[1.25rem] font-bold ${d.close.variance === 0 ? 'text-lagoon-700' : 'text-coral-700'}`}>
                    {d.close.variance === 0 ? 'Agrees' : `${d.close.variance > 0 ? 'Over' : 'Short'} ${money(Math.abs(d.close.variance))}`}
                  </dd>
                </div>
              </dl>
              {d.close.note && <p className="border-t border-slate-100 px-5 py-3 text-[0.875rem] text-slate-600">{d.close.note}</p>}
            </section>
          ) : (
            manage && d.totals.count > 0 && <CloseDay key={day} day={day} expectedCash={d.expectedCash} />
          )}

          <section className="card flex flex-wrap gap-x-10 gap-y-4 p-5">
            <Stat label={`Collected, ${date(d.date)}`} value={money(d.totals.collected)} note={plural(d.totals.count, 'receipt')} />
            {d.byMode.map((m) => (
              <Stat key={m.mode} label={m.modeLabel} value={<span className="text-[1.125rem]">{money(m.amount)}</span>} note={plural(m.count, 'receipt')} />
            ))}
            {d.totals.cancelledCount > 0 && (
              <Stat label="Cancelled" value={<span className="text-[1.125rem]">{money(d.totals.cancelled)}</span>} note={plural(d.totals.cancelledCount, 'receipt')} tone="coral" />
            )}
            {d.totals.bouncedCount > 0 && (
              <Stat label="Returned by bank" value={<span className="text-[1.125rem]">{money(d.totals.bounced)}</span>} note={plural(d.totals.bouncedCount, 'receipt')} tone="coral" />
            )}
          </section>

          {d.byCollector.length > 1 && (
            <Card title="Who took it" pad={false}>
              <ul className="divide-y divide-slate-100">
                {d.byCollector.map((c) => (
                  <li key={c.name} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                    <Avatar name={c.name} size={30} />
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink-800">{c.name}</span>
                    <span className="text-[0.8125rem] text-slate-500">{plural(c.count, 'receipt')}</span>
                    <span className="money w-28 text-right font-semibold text-ink-800">{money(c.amount)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {d.rows.length === 0 ? (
            <Card>
              <EmptyState icon="receipt" title={`Nothing was received on ${date(d.date)}`}>
                {day === school.today ? 'Receipts written today will appear here as they are taken.' : 'There is nothing to sign off for this day.'}
              </EmptyState>
            </Card>
          ) : (
            <Card title="Receipts" pad={false}>
              {/* Phones: a list, not a table squeezed off the side of the screen. */}
              <ul className="divide-y divide-slate-100 md:hidden">
                {d.rows.map((r) => (
                  <li key={r.id}>
                    <Link to={`/app/fees/receipts/${r.id}`} className={`flex items-center gap-3 px-4 py-3 no-underline ${r.status === 'valid' ? '' : 'opacity-55'}`}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-ink-800">{r.studentName}</span>
                        <span className="num block truncate text-[0.75rem] text-slate-500">
                          {r.receiptNo}, {r.modeLabel}
                          {r.status === 'cancelled' ? ', cancelled' : r.status === 'bounced' ? ', returned' : ''}
                        </span>
                      </span>
                      <span className={`money font-semibold text-ink-800 ${r.status === 'valid' ? '' : 'line-through'}`}>{money(r.amount)}</span>
                      <Icon name="chevron-right" size={16} className="shrink-0 text-slate-400" />
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto md:block">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Receipt</th>
                      <th>Student</th>
                      <th>Mode</th>
                      <th className="r">Amount</th>
                      <th>Received by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r) => (
                      <tr key={r.id} data-href onClick={() => navigate(`/app/fees/receipts/${r.id}`)} className={r.status === 'valid' ? '' : 'opacity-55'}>
                        <td className="num whitespace-nowrap font-semibold">
                          {r.receiptNo}
                          {r.status !== 'valid' && <span className="tag tag-coral ml-2">{r.statusLabel}</span>}
                        </td>
                        <td>
                          <span className="block">{r.studentName}</span>
                          <span className="num block text-[0.75rem] text-slate-500">{r.admissionNo}</span>
                        </td>
                        <td className="text-slate-600">
                          {r.modeLabel}
                          {r.reference ? <span className="block text-[0.75rem] text-slate-400">{r.reference}</span> : null}
                        </td>
                        <td className={`r money font-semibold ${r.status === 'valid' ? '' : 'line-through'}`}>{money(r.amount)}</td>
                        <td className="text-slate-600">
                          {r.receivedByName}
                          {(r.cancelReason ?? r.bounceReason) && <span className="block text-[0.75rem] text-coral-700">{r.cancelReason ?? r.bounceReason}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {d.close && reopening && <ReopenDay day={day} onClose={() => setReopening(false)} />}
        </>
      )}
    </div>
  );
}

/**
 * Signing a day off. The cash the system expects is shown against what was actually
 * counted, and the difference is named in plain words before anything is saved — an
 * accountant should not have to work out whether ₹49,800 against ₹50,000 is short or over.
 */
function CloseDay({ day, expectedCash }: { day: string; expectedCash: number }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  // Deliberately not prefilled with what the system expects: the figure is worth recording
  // only if somebody actually counted the drawer, and a prefilled box invites a nod.
  const [countedText, setCounted] = useState('');
  const [note, setNote] = useState('');
  const counted = parseRupees(countedText);
  const variance = counted === null ? null : counted - expectedCash;

  const close = useMutation({
    mutationFn: () => api.post('/school/fees/daybook/close', { day, countedCash: counted, note: note || null }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast(`Day book closed for ${date(day)}`);
    },
  });

  return (
    <section className="no-print overflow-hidden rounded-[var(--radius-xl)] bg-white shadow-lift ring-1 ring-slate-200">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-[1.0625rem]">Close the day</h2>
        <p className="text-[0.875rem] text-slate-600">
          Count the cash in the drawer and record what is really there. Afterwards nothing dated {date(day)} can be received, cancelled or returned.
        </p>
      </div>
      <form
        className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (counted !== null) close.mutate();
        }}
      >
        <div>
          <p className="input-label">Cash the system expects</p>
          <p className="money text-[1.75rem] font-bold leading-none text-ink-800" style={{ fontStretch: '112%' }}>
            {money(expectedCash)}
          </p>
          <p className="mt-1 text-[0.75rem] text-slate-500">Cash receipts only. UPI, cheques and transfers are not in the drawer.</p>
        </div>
        <Field
          id="counted"
          label="Cash counted"
          inputMode="decimal"
          value={countedText}
          onChange={(e) => setCounted(e.target.value.replace(/[^\d.,]/g, ''))}
          placeholder="Count it, then type the total"
          error={countedText !== '' && counted === null ? 'Enter the amount counted.' : undefined}
          hint={
            variance === null ? undefined : variance === 0 ? (
              <span className="font-semibold text-lagoon-700">Agrees with the receipts.</span>
            ) : (
              <span className="font-semibold text-coral-700">
                {variance > 0 ? 'Over' : 'Short'} by {money(Math.abs(variance))}, which will be recorded against this day.
              </span>
            )
          }
        />
        <button type="submit" className="btn btn-ink" disabled={counted === null || close.isPending}>
          {close.isPending && <Spinner />} Close the day
        </button>
        <div className="sm:col-span-3">
          <FormError message={close.error ? errorMessage(close.error) : null} />
          {variance !== null && variance !== 0 && (
            <Field id="close-note" label="Note on the difference" value={note} onChange={(e) => setNote(e.target.value)} placeholder="₹200 paid out for stationery, slip in the drawer" />
          )}
        </div>
      </form>
    </section>
  );
}

function ReopenDay({ day, onClose }: { day: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const reopen = useMutation({
    mutationFn: () => api.post('/school/fees/daybook/reopen', { day, reason }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast(`Day book reopened for ${date(day)}`);
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Reopen ${dateLong(day)}?`}
      lead="Receipts dated that day can be taken, cancelled or returned again. The reopening is recorded with your name and reason, and the day has to be closed again afterwards."
      footer={
        <>
          <button type="button" className="btn btn-line btn-sm" onClick={onClose}>
            Leave it closed
          </button>
          <button type="button" className="btn btn-ink btn-sm" disabled={!reason.trim() || reopen.isPending} onClick={() => reopen.mutate()}>
            {reopen.isPending && <Spinner />} Reopen the day
          </button>
        </>
      }
    >
      <FormError message={reopen.error ? errorMessage(reopen.error) : null} />
      <Field id="reopen-reason" label="Why" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="A receipt was entered against the wrong student" />
    </Dialog>
  );
}
