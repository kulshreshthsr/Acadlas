// Attendance for one day across the school: which registers are in, which are not.
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, withQuery } from '../../lib/api';
import { addDays, dateLong, plural, timeAgo } from '../../lib/format';
import { useSchool } from '../../lib/school';
import { Icon } from '../../components/Icon';
import { Card, EmptyState, ErrorState, Loading, Page } from '../../components/ui';

export type AttendanceSections = {
  date: string;
  holiday: { name: string } | null;
  workingDay: boolean;
  sections: { id: string; label: string; strength: number; mine: boolean; canMark: boolean; register: { present: number; absent: number; late: number; takenByName: string | null; updatedAt: string } | null }[];
};

export function Attendance() {
  const school = useSchool();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? school.today;
  const q = useQuery({ queryKey: ['attendance-sections', date], queryFn: () => api.get<AttendanceSections>(withQuery('/school/attendance/sections', { date })), refetchInterval: 45_000 });
  const data = q.data;
  const sections = [...(data?.sections ?? [])].sort((a, b) => Number(b.mine) - Number(a.mine));
  const taken = sections.filter((s) => s.register).length;
  const expected = sections.filter((s) => s.register || s.strength > 0).length;
  const markable = sections.filter((s) => s.canMark);

  return (
    <Page
      title="Attendance"
      lead={data ? `${dateLong(date)}. ${taken} of ${plural(expected, 'register')} taken.` : ' '}
      under={
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Previous day" onClick={() => setParams({ date: addDays(date, -1) })}>
            <Icon name="chevron-left" size={16} />
          </button>
          <input type="date" className="input input-sm w-auto border-white/20 bg-white/10 text-white [color-scheme:dark]" value={date} max={school.today} onChange={(e) => e.target.value && setParams({ date: e.target.value })} aria-label="Date" />
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Next day" disabled={date >= school.today} onClick={() => setParams({ date: addDays(date, 1) })}>
            <Icon name="chevron-right" size={16} />
          </button>
          {date !== school.today && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParams({})}>
              Today
            </button>
          )}
        </div>
      }
    >
      {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Loading rows={6} />}
      {data && !data.workingDay && (
        <div className="mb-4 rounded-xl bg-marigold-50 px-4 py-3 text-[0.875rem] text-marigold-700 ring-1 ring-marigold-100">
          {data.holiday ? `${data.holiday.name} is marked as a holiday.` : 'This is not a working day.'} Registers can still be taken if the school was open.
        </div>
      )}
      {data && sections.length === 0 && (
        <Card>
          <EmptyState icon="attendance" title={school.can('attendance.mark.all') ? 'No sections this year' : 'No sections assigned to you'}>
            {school.can('attendance.mark.all') ? 'Set up classes first.' : 'Ask the office to make you class teacher of a section.'}
          </EmptyState>
        </Card>
      )}
      {data && sections.length > 0 && (
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {sections.map((s) => {
            const r = s.register;
            const total = r ? r.present + r.absent + r.late : 0;
            const empty = !r && s.strength === 0;
            return (
              <li key={s.id}>
                <Link
                  to={withQuery(`/app/attendance/${s.id}`, { date: date === school.today ? null : date })}
                  className={`flex h-full flex-col rounded-2xl p-3.5 no-underline transition-transform hover:-translate-y-0.5 ${
                    r ? 'bg-white shadow-soft ring-1 ring-slate-200' : empty ? 'border border-slate-200 opacity-60' : s.canMark ? 'border-2 border-dashed border-marigold-400 bg-marigold-50/50' : 'border border-dashed border-slate-300'
                  }`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-[1.25rem] font-extrabold leading-none text-ink-800" style={{ fontStretch: '118%' }}>{s.label}</span>
                    {s.mine && <span className="tag tag-sun">Yours</span>}
                  </span>
                  {r ? (
                    <>
                      <span className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-coral-500">
                        <span className="bg-lagoon-500" style={{ width: `${((r.present + r.late) / total) * 100}%` }} />
                      </span>
                      <span className="mt-2 text-[0.8125rem] text-slate-600">
                        <b className="text-ink-800">{r.present + r.late}</b> present{r.absent > 0 && <>, <b className="text-coral-700">{r.absent}</b> absent</>}
                      </span>
                      <span className="mt-auto pt-1 text-[0.6875rem] text-slate-400">{r.takenByName}, {timeAgo(r.updatedAt)}</span>
                    </>
                  ) : (
                    <>
                      <span className="mt-3 text-[0.8125rem] text-slate-500">{plural(s.strength, 'student')}</span>
                      {!empty && <span className={`mt-auto pt-2 text-[0.8125rem] font-bold ${s.canMark ? 'text-marigold-700' : 'text-slate-400'}`}>{s.canMark ? 'Take register' : 'Not taken'}</span>}
                    </>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {data && markable.length === 0 && sections.length > 0 && <p className="mt-4 text-[0.8125rem] text-slate-500">You can view these registers. Marking them is for class teachers and the office.</p>}
    </Page>
  );
}
