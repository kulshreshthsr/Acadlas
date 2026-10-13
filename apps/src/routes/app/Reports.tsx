// Reports: answers from the records already there, printable and exportable to Excel so
// nothing is typed into a spreadsheet again.
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, withQuery } from '../../lib/api';
import { downloadCsv } from '../../lib/csv';
import { date, monthName, phone } from '../../lib/format';
import { sectionOptions, useStructure } from '../../lib/queries';
import { useSchool } from '../../lib/school';
import type { Permission } from '../../lib/school';
import type { IconName } from '../../lib/icons';
import { Icon } from '../../components/Icon';
import { BackLink, Card, EmptyState, ErrorState, Loading, Page } from '../../components/ui';
import type { StudentRow } from './Students';

type ReportId = 'strength' | 'class-list' | 'attendance';

const reports: { id: ReportId | string; title: string; note: string; icon: IconName; anyOf: Permission[]; to?: string }[] = [
  { id: 'class-list', title: 'Class list', note: 'Roll numbers, names, dates of birth and parents’ numbers for one section.', icon: 'students', anyOf: ['reports.academic'] },
  { id: 'strength', title: 'Class strength', note: 'Students in every section, girls and boys, and RTE admissions — for UDISE+ and board returns.', icon: 'grid', anyOf: ['reports.academic', 'reports.fees'] },
  { id: 'attendance', title: 'Attendance by section', note: 'Each section’s month: registers taken and the share present.', icon: 'attendance', anyOf: ['reports.academic', 'attendance.view'] },
  { id: 'fees', title: 'Fees by class', note: 'Charged, collected and overdue for each class this year.', icon: 'fees', anyOf: ['reports.fees'], to: '/app/fees' },
  { id: 'dues', title: 'Fees due', note: 'Every student with overdue fees, with a reminder ready to send.', icon: 'alert', anyOf: ['fees.view'], to: '/app/fees/dues' },
  { id: 'collections', title: 'Collections', note: 'Receipts for a day or a range, totalled by cash, UPI, cheque and bank.', icon: 'receipt', anyOf: ['fees.view'], to: '/app/fees/collections' },
  { id: 'daybook', title: 'Day book', note: 'One day’s receipts, by who took them, signed off against the cash counted.', icon: 'lock', anyOf: ['fees.view'], to: '/app/fees/daybook' },
];

export function Reports() {
  const school = useSchool();
  const [params, setParams] = useSearchParams();
  const current = params.get('r') as ReportId | null;
  const visible = reports.filter((r) => school.can(...r.anyOf));

  if (current) {
    const report = reports.find((r) => r.id === current);
    return (
      <Page title={report?.title ?? 'Report'} lead={school.currentYear?.name} back={<BackLink to="/app/reports">Reports</BackLink>} wide={current === 'attendance'}>
        {current === 'strength' && <Strength />}
        {current === 'class-list' && <ClassList sectionId={params.get('section') ?? ''} setSection={(id) => setParams({ r: 'class-list', section: id })} />}
        {current === 'attendance' && <AttendanceReport month={params.get('month') ?? school.today.slice(0, 7)} setMonth={(m) => setParams({ r: 'attendance', month: m })} />}
      </Page>
    );
  }

  return (
    <Page title="Reports" lead="Everything here prints on one page and exports to Excel.">
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((r) => (
          <li key={r.id}>
            <Link to={r.to ?? `/app/reports?r=${r.id}`} className="card flex h-full items-start gap-3.5 p-4 no-underline transition-colors hover:border-ink-800">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-lagoon-50 text-lagoon-600"><Icon name={r.icon} size={19} /></span>
              <span>
                <span className="block font-bold text-ink-800" style={{ fontStretch: '110%' }}>{r.title}</span>
                <span className="mt-0.5 block text-[0.8125rem] leading-snug text-slate-500">{r.note}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}

function Toolbar({ onExport, children }: { onExport: () => void; children?: React.ReactNode }) {
  return (
    <div className="no-print mb-4 flex flex-wrap items-center gap-2">
      {children}
      <span className="ml-auto flex gap-2">
        <button type="button" className="btn btn-line btn-sm" onClick={onExport}><Icon name="download" size={14} /> Export</button>
        <button type="button" className="btn btn-line btn-sm" onClick={() => window.print()}><Icon name="printer" size={14} /> Print</button>
      </span>
    </div>
  );
}

function PrintHeading({ children }: { children: React.ReactNode }) {
  const school = useSchool();
  return <h2 className="mb-3 hidden print:block">{school.school.name}: {children}</h2>;
}

type StrengthData = { year: { name: string }; rows: { sectionId: string; label: string; gradeName: string; classTeacher: string | null; total: number; boys: number; girls: number; rte: number }[]; totals: { total: number; boys: number; girls: number; rte: number } };

function Strength() {
  const q = useQuery({ queryKey: ['report-strength'], queryFn: () => api.get<StrengthData>('/school/reports/strength') });
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (q.isPending) return <Loading rows={8} />;
  const d = q.data;
  return (
    <>
      <Toolbar onExport={() => downloadCsv(`class-strength-${d.year.name}.csv`, [['Section', 'Class teacher', 'Girls', 'Boys', 'Total', 'RTE'], ...d.rows.map((r) => [r.label, r.classTeacher, r.girls, r.boys, r.total, r.rte]), ['Total', '', d.totals.girls, d.totals.boys, d.totals.total, d.totals.rte]])} />
      <PrintHeading>class strength, {d.year.name}</PrintHeading>
      <div className="card print-plain overflow-x-auto">
        <table className="table">
          <thead><tr><th>Section</th><th>Class teacher</th><th className="r">Girls</th><th className="r">Boys</th><th className="r">Total</th><th className="r">RTE</th></tr></thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.sectionId}>
                <td className="font-semibold">{r.label}</td>
                <td className="text-slate-600">{r.classTeacher ?? '—'}</td>
                <td className="r num">{r.girls}</td>
                <td className="r num">{r.boys}</td>
                <td className="r num font-semibold">{r.total}</td>
                <td className="r num text-slate-600">{r.rte || '—'}</td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-bold">
              <td colSpan={2}>Whole school</td>
              <td className="r num">{d.totals.girls}</td>
              <td className="r num">{d.totals.boys}</td>
              <td className="r num">{d.totals.total}</td>
              <td className="r num">{d.totals.rte}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function ClassList({ sectionId, setSection }: { sectionId: string; setSection: (id: string) => void }) {
  const structure = useStructure();
  const sections = sectionOptions(structure.data);
  const id = sectionId || sections[0]?.id || '';
  const q = useQuery({ queryKey: ['students', 'class-list', id], queryFn: () => api.get<{ rows: StudentRow[] }>(withQuery('/school/students', { sectionId: id, pageSize: 500 })), enabled: Boolean(id) });
  const label = sections.find((s) => s.id === id)?.label ?? '';
  const teacher = structure.data?.grades.flatMap((g) => g.sections).find((s) => s.id === id)?.classTeacherName;

  return (
    <>
      <Toolbar onExport={() => q.data && downloadCsv(`class-list-${label}.csv`, [['Roll', 'Admission no.', 'Student', 'Gender', 'Date of birth', 'Guardian', 'Phone'], ...q.data.rows.map((s) => [s.rollNo, s.admissionNo, s.name, s.gender, s.dateOfBirth, s.guardianName, s.guardianPhone])])}>
        <select className="input input-sm w-auto min-w-32" value={id} onChange={(e) => setSection(e.target.value)} aria-label="Section">
          {sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </Toolbar>
      <PrintHeading>class list, {label}{teacher ? `, class teacher ${teacher}` : ''}</PrintHeading>
      {q.isPending && id && <Loading rows={8} />}
      {!id && <Card><EmptyState icon="classes" title="No sections yet" /></Card>}
      {q.data && (
        <div className="card print-plain overflow-x-auto">
          <table className="table">
            <thead><tr><th className="w-12">Roll</th><th>Student</th><th>Admission no.</th><th>Date of birth</th><th>Guardian</th><th>Phone</th></tr></thead>
            <tbody>
              {q.data.rows.map((s) => (
                <tr key={s.id}>
                  <td className="num">{s.rollNo}</td>
                  <td className="font-semibold">{s.name}</td>
                  <td className="num text-slate-600">{s.admissionNo}</td>
                  <td className="text-slate-600">{date(s.dateOfBirth)}</td>
                  <td>{s.guardianName}</td>
                  <td className="num">{phone(s.guardianPhone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

type AttendanceReportData = { month: string; rows: { sectionId: string; label: string; registers: number; present: number; late: number; absent: number; percent: number | null }[] };

function AttendanceReport({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const school = useSchool();
  const q = useQuery({ queryKey: ['report-attendance', month], queryFn: () => api.get<AttendanceReportData>(withQuery('/school/reports/attendance', { month })) });
  return (
    <>
      <Toolbar onExport={() => q.data && downloadCsv(`attendance-${month}.csv`, [['Section', 'Registers taken', 'Present', 'Late', 'Absent', '% present'], ...q.data.rows.map((r) => [r.label, r.registers, r.present, r.late, r.absent, r.percent])])}>
        <input type="month" className="input input-sm w-auto" value={month} max={school.today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />
      </Toolbar>
      <PrintHeading>attendance by section, {monthName(month)}</PrintHeading>
      {q.isPending && <Loading rows={8} />}
      {q.data && (
        <div className="card print-plain overflow-x-auto">
          <table className="table">
            <thead><tr><th>Section</th><th className="r">Registers</th><th className="r">Present</th><th className="r">Late</th><th className="r">Absent</th><th className="w-1/3">Present</th></tr></thead>
            <tbody>
              {q.data.rows.map((r) => (
                <tr key={r.sectionId}>
                  <td className="font-semibold"><Link to={withQuery(`/app/attendance/${r.sectionId}/month`, { month })} className="text-ink-800 no-underline hover:underline">{r.label}</Link></td>
                  <td className="r num">{r.registers}</td>
                  <td className="r num">{r.present}</td>
                  <td className="r num">{r.late}</td>
                  <td className="r num text-coral-700">{r.absent}</td>
                  <td>
                    {r.percent === null ? <span className="text-slate-400">No registers</span> : (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-coral-100"><div className={`h-full ${r.percent < 75 ? 'bg-coral-500' : 'bg-lagoon-500'}`} style={{ width: `${r.percent}%` }} /></div>
                        <span className="num w-12 text-right text-[0.8125rem] font-semibold">{r.percent}%</span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

