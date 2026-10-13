// A section's month: the paper register schools keep, with totals worked out.
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, withQuery } from '../../lib/api';
import { downloadCsv } from '../../lib/csv';
import { monthName } from '../../lib/format';
import { useSchool } from '../../lib/school';
import { Icon } from '../../components/Icon';
import { BackLink, Card, EmptyState, ErrorState, Loading, Page } from '../../components/ui';

type MonthData = {
  section: { id: string; label: string };
  month: string;
  days: { date: string; working: boolean; holiday: string | null; taken: boolean }[];
  students: { id: string; name: string; rollNo: number | null; marks: Record<string, 'P' | 'A' | 'L'>; present: number; absent: number; late: number; percent: number | null }[];
  registersTaken: number;
};

function shiftMonth(month: string, by: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

export function AttendanceMonth() {
  const { sectionId = '' } = useParams();
  const school = useSchool();
  const [params, setParams] = useSearchParams();
  const month = params.get('month') ?? school.today.slice(0, 7);
  const q = useQuery({ queryKey: ['attendance-month', sectionId, month], queryFn: () => api.get<MonthData>(withQuery('/school/attendance/month', { sectionId, month })) });
  const d = q.data;

  function exportCsv() {
    if (!d) return;
    const days = d.days.filter((x) => x.taken);
    downloadCsv(`attendance-${d.section.label}-${month}.csv`, [
      ['Roll', 'Student', ...days.map((x) => x.date.slice(8)), 'Present', 'Late', 'Absent', '%'],
      ...d.students.map((s) => [s.rollNo, s.name, ...days.map((x) => s.marks[x.date] ?? ''), s.present, s.late, s.absent, s.percent]),
    ]);
  }

  return (
    <Page
      title={d ? `${d.section.label}, ${monthName(month)}` : monthName(month)}
      lead={d ? `${d.registersTaken} registers taken this month.` : ' '}
      back={<BackLink to={`/app/attendance/${sectionId}`}>Today’s register</BackLink>}
      wide
      actions={
        <>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Previous month" onClick={() => setParams({ month: shiftMonth(month, -1) })}><Icon name="chevron-left" size={16} /></button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Next month" disabled={month >= school.today.slice(0, 7)} onClick={() => setParams({ month: shiftMonth(month, 1) })}><Icon name="chevron-right" size={16} /></button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv} disabled={!d?.students.length}><Icon name="download" size={15} /> Export</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.print()}><Icon name="printer" size={15} /> Print</button>
        </>
      }
    >
      {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Loading rows={8} />}
      {d && d.students.length === 0 && <Card><EmptyState icon="students" title="No students in this section" /></Card>}
      {d && d.students.length > 0 && (
        <div className="card print-plain overflow-x-auto">
          <h2 className="hidden px-2 py-3 print:block">{school.school.name}: {d.section.label} attendance, {monthName(month)}</h2>
          <table className="w-full border-separate border-spacing-0 text-[0.75rem]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-500">Student</th>
                {d.days.map((day) => (
                  <th key={day.date} title={day.holiday ?? undefined} className={`min-w-[1.6rem] border-b border-slate-200 px-0.5 py-2 text-center font-semibold ${day.working ? 'bg-slate-50 text-slate-500' : 'bg-slate-100 text-slate-300'}`}>
                    {Number(day.date.slice(8))}
                  </th>
                ))}
                <th className="border-b border-slate-200 bg-slate-50 px-2 py-2 text-right font-semibold text-slate-500">P</th>
                <th className="border-b border-slate-200 bg-slate-50 px-2 py-2 text-right font-semibold text-slate-500">A</th>
                <th className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-right font-semibold text-slate-500">%</th>
              </tr>
            </thead>
            <tbody>
              {d.students.map((s) => (
                <tr key={s.id}>
                  <td className="sticky left-0 z-10 whitespace-nowrap border-b border-slate-100 bg-white px-3 py-1.5">
                    <Link to={`/app/students/${s.id}`} className="font-semibold text-ink-800 no-underline hover:underline">
                      <span className="num mr-1.5 text-slate-400">{s.rollNo}</span>
                      {s.name}
                    </Link>
                  </td>
                  {d.days.map((day) => {
                    const m = s.marks[day.date];
                    return (
                      <td key={day.date} className={`border-b border-slate-100 p-0.5 text-center ${day.working ? '' : 'bg-slate-50'}`}>
                        {m && (
                          <span className={`mx-auto grid size-5 place-items-center rounded text-[0.625rem] font-bold ${m === 'P' ? 'text-lagoon-600' : m === 'A' ? 'bg-coral-500 text-white' : 'bg-marigold-300 text-marigold-700'}`}>
                            {m === 'P' ? '•' : m}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="num border-b border-slate-100 px-2 text-right font-semibold text-ink-800">{s.present + s.late}</td>
                  <td className="num border-b border-slate-100 px-2 text-right font-semibold text-coral-700">{s.absent || ''}</td>
                  <td className={`num border-b border-slate-100 px-3 text-right font-bold ${s.percent !== null && s.percent < 75 ? 'text-coral-700' : 'text-ink-800'}`}>{s.percent ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="no-print mt-3 text-[0.8125rem] text-slate-500">Shaded columns are holidays or non-working days. Below 75% is marked in red.</p>
    </Page>
  );
}
