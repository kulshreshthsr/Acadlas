// Today: the first screen of the school day.
//
// Its centre is the registers board — the school laid out as a map of class levels and
// their sections, each tile filling as its register comes in — because the first question
// every morning is "has every class been marked?". Around it: who is absent (with a
// WhatsApp message to their family one tap away), the day's fee collection, birthdays,
// and what changed recently.
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { dateLong, money, moneyShort, plural, timeAgo, whatsappLink } from '../../lib/format';
import { useSchool } from '../../lib/school';
import type { AcademicYear } from '../../lib/school';
import { Icon } from '../../components/Icon';
import { Avatar, Card, EmptyState, ErrorState, Loading, Page } from '../../components/ui';

type TodayData = {
  today: string;
  workingDay: boolean;
  holiday: { name: string } | null;
  year: AcademicYear | null;
  registers: { sectionId: string; label: string; gradeName: string; position: number; strength: number; taken: boolean; present: number; absent: number; late: number; takenByName: string | null; mine: boolean }[];
  fees: { collectedToday: number; receiptsToday: number; overdue: number; overdueStudents: number; lastSeven: { date: string; total: number }[] } | null;
  birthdays: { id: string; name: string; classLabel: string | null }[];
  activity: { id: string; summary: string; actorName: string | null; createdAt: string; studentId: string | null }[];
  checklist: { studentsAdded: boolean; staffInvited: boolean; feePlanCreated: boolean; firstRegister: boolean; firstReceipt: boolean } | null;
};

type Absentee = { id: string; name: string; classLabel: string | null; guardianName: string | null; guardianPhone: string | null };

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function Today() {
  const school = useSchool();
  const location = useLocation();
  const welcome = Boolean((location.state as { welcome?: boolean } | null)?.welcome);
  const today = useQuery({ queryKey: ['today'], queryFn: () => api.get<TodayData>('/school/today'), refetchInterval: 60_000 });
  const absentees = useQuery({
    queryKey: ['absentees', school.today],
    queryFn: () => api.get<Absentee[]>('/school/attendance/absentees'),
    enabled: school.can('attendance.view'),
    refetchInterval: 60_000,
  });

  const firstName = school.user.name.split(' ')[0];
  const data = today.data;

  return (
    <Page
      title={dateLong(school.today)}
      lead={`${greeting()}, ${firstName}. ${school.currentYear ? `${school.school.name}, ${school.currentYear.name}.` : ''}`}
      actions={
        <>
          {school.can('attendance.mark.all', 'attendance.mark.own') && (
            <Link to="/app/attendance" className="btn btn-sun btn-sm">
              <Icon name="attendance" size={16} /> Take attendance
            </Link>
          )}
          {school.can('fees.collect') && (
            <Link to="/app/fees/collect" className="btn btn-ghost btn-sm">
              <Icon name="fees" size={16} /> Collect a fee
            </Link>
          )}
          {school.can('students.edit') && (
            <Link to="/app/students/new" className="btn btn-ghost btn-sm">
              <Icon name="admission" size={16} /> Admit
            </Link>
          )}
        </>
      }
    >
      {today.error && <ErrorState error={today.error} retry={() => today.refetch()} />}
      {today.isPending && <Loading rows={5} />}

      {data && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
          <div className="min-w-0 space-y-5">
            {data.checklist && Object.values(data.checklist).some((done) => !done) && <Checklist items={data.checklist} welcome={welcome} />}
            <RegistersBoard data={data} />
            {absentees.data && absentees.data.length > 0 && <Absentees list={absentees.data} schoolName={school.school.name} today={school.today} />}
          </div>

          <div className="min-w-0 space-y-5">
            {data.fees && <FeesToday fees={data.fees} />}
            {data.birthdays.length > 0 && (
              <Card title={<h2 className="flex items-center gap-2 text-[1rem]"><Icon name="cake" size={17} className="text-marigold-600" /> Birthdays today</h2>}>
                <ul className="space-y-2.5">
                  {data.birthdays.map((b) => (
                    <li key={b.id}>
                      <Link to={`/app/students/${b.id}`} className="flex items-center gap-3 text-ink-800 no-underline hover:underline">
                        <Avatar name={b.name} size={32} tone="bg-marigold-100 text-marigold-700" />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{b.name}</span>
                          <span className="block text-[0.8125rem] text-slate-500">{b.classLabel ?? 'No class'}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {data.activity.length > 0 && (
              <Card title="Recently" action={<Link className="link text-[0.8125rem]" to="/app/settings?tab=activity">All activity</Link>}>
                <ol className="space-y-3">
                  {data.activity.map((a) => (
                    <li key={a.id} className="flex gap-3 text-[0.875rem]">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-lagoon-400" aria-hidden="true" />
                      <span className="min-w-0">
                        {a.studentId ? (
                          <Link to={`/app/students/${a.studentId}`} className="text-ink-800 no-underline hover:underline">
                            {a.summary}
                          </Link>
                        ) : (
                          <span className="text-ink-800">{a.summary}</span>
                        )}
                        <span className="block text-[0.75rem] text-slate-500">
                          {a.actorName}, {timeAgo(a.createdAt)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </Card>
            )}
          </div>
        </div>
      )}
    </Page>
  );
}

// ---------------------------------------------------------------------------

function RegistersBoard({ data }: { data: TodayData }) {
  const school = useSchool();
  const regs = data.registers;
  const taken = regs.filter((r) => r.taken);
  // Sections with nobody in them are not waiting for a register.
  const expected = regs.filter((r) => r.taken || r.strength > 0).length;
  const present = taken.reduce((s, r) => s + r.present + r.late, 0);
  const marked = taken.reduce((s, r) => s + r.present + r.late + r.absent, 0);
  const absent = taken.reduce((s, r) => s + r.absent, 0);

  if (!data.year) {
    return (
      <Card>
        <EmptyState icon="calendar" title="No academic year yet">
          {school.can('school.manage') ? 'Set one up in Settings to start taking registers.' : 'Your administrator needs to set up the academic year.'}
        </EmptyState>
      </Card>
    );
  }

  if (!data.workingDay) {
    return (
      <Card>
        <EmptyState icon="sun" title={data.holiday ? `Holiday: ${data.holiday.name}` : 'Not a school day'}>
          No registers are expected today.
        </EmptyState>
      </Card>
    );
  }

  if (regs.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="attendance"
          title={school.can('attendance.mark.all') ? 'No sections in this year yet' : 'No sections assigned to you'}
          action={school.can('school.manage') ? <Link to="/app/classes" className="btn btn-ink btn-sm">Set up classes</Link> : undefined}
        >
          {school.can('attendance.mark.all') ? 'Add classes and sections to start taking registers.' : 'Ask the office to make you class teacher of a section.'}
        </EmptyState>
      </Card>
    );
  }

  // Group sections by class level, in the school's own order.
  const rows: { grade: string; sections: TodayData['registers'] }[] = [];
  for (const r of regs) {
    const row = rows.find((x) => x.grade === r.gradeName);
    if (row) row.sections.push(r);
    else rows.push({ grade: r.gradeName, sections: [r] });
  }

  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-end justify-between gap-4 px-4 pb-4 pt-4 sm:px-5">
        <div>
          <h2 className="text-[1rem]">Today’s registers</h2>
          <p className="mt-0.5 text-[0.875rem] text-slate-500">
            <b className="text-ink-800">{taken.length}</b> of {expected} taken
            {marked > 0 && (
              <>
                {', '}
                <b className="text-ink-800">{Math.round((present / marked) * 100)}%</b> present, {plural(absent, 'absence')}
              </>
            )}
          </p>
        </div>
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100 sm:w-56" aria-hidden="true">
          <span className="h-full bg-lagoon-500 transition-[width] duration-700" style={{ width: `${expected ? (taken.length / expected) * 100 : 0}%` }} />
        </div>
      </header>

      <div className={`grid gap-x-6 gap-y-2 border-t border-slate-100 bg-slate-50/60 px-3 py-4 sm:px-5 ${rows.every((r) => r.sections.length <= 3) && rows.length > 6 ? 'md:grid-cols-2' : ''}`}>
        {rows.map((row) => (
          <div key={row.grade} className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-right text-[0.75rem] font-bold text-slate-500 sm:w-16" style={{ fontStretch: '110%' }}>
              {/^\d+$/.test(row.grade) ? `Class ${row.grade}` : row.grade}
            </span>
            <div className="flex flex-1 flex-wrap gap-1.5">
              {row.sections.map((s) => (
                <SectionTile key={s.sectionId} s={s} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <footer className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-slate-100 px-4 py-2.5 text-[0.75rem] text-slate-500 sm:px-5">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-lagoon-500" /> Present</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-coral-500" /> Absent</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm border border-dashed border-slate-400" /> Not taken yet</span>
      </footer>
    </section>
  );
}

function SectionTile({ s }: { s: TodayData['registers'][number] }) {
  const total = s.present + s.late + s.absent;
  const presentPct = total ? ((s.present + s.late) / total) * 100 : 0;
  const name = s.label.split('-').slice(-1)[0];
  return (
    <Link
      to={`/app/attendance/${s.sectionId}`}
      title={s.taken ? `${s.label}: ${s.present + s.late} present, ${s.absent} absent — taken by ${s.takenByName}` : `${s.label}: not taken yet`}
      className={`group relative flex h-14 w-[4.25rem] flex-col justify-between overflow-hidden rounded-xl px-2 py-1.5 no-underline transition-transform hover:-translate-y-0.5 ${
        s.taken ? 'bg-white shadow-soft ring-1 ring-slate-200' : s.strength === 0 ? 'border border-slate-200 bg-transparent opacity-50' : 'border border-dashed border-slate-300 bg-white/40'
      } ${s.mine ? 'outline outline-2 outline-offset-1 outline-marigold-400' : ''}`}
    >
      <span className="relative z-10 flex items-baseline justify-between">
        <span className="text-[1rem] font-extrabold leading-none text-ink-800" style={{ fontStretch: '115%' }}>
          {name}
        </span>
        {s.taken ? (
          s.absent > 0 && <span className="text-[0.6875rem] font-bold text-coral-700">{s.absent}</span>
        ) : (
          <span className="text-[0.6875rem] font-semibold text-slate-400">{s.strength}</span>
        )}
      </span>
      {s.taken ? (
        <span className="relative z-10 flex h-1.5 overflow-hidden rounded-full bg-coral-500/80">
          <span className="h-full bg-lagoon-500" style={{ width: `${presentPct}%` }} />
        </span>
      ) : (
        <span className="relative z-10 text-[0.625rem] font-semibold text-slate-400 group-hover:text-ink-800">{s.strength === 0 ? 'Empty' : 'Take'}</span>
      )}
    </Link>
  );
}

function Absentees({ list, schoolName, today }: { list: Absentee[]; schoolName: string; today: string }) {
  return (
    <Card
      pad={false}
      title={<h2 className="text-[1rem]">Absent today <span className="ml-1 text-slate-400">{list.length}</span></h2>}
      action={<span className="text-[0.75rem] text-slate-500">Message a family on WhatsApp</span>}
    >
      <ul className="divide-y divide-slate-100">
        {list.slice(0, 30).map((a) => (
          <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
            <Avatar name={a.name} size={32} />
            <Link to={`/app/students/${a.id}`} className="min-w-0 flex-1 text-ink-800 no-underline hover:underline">
              <span className="block truncate font-semibold">{a.name}</span>
              <span className="block truncate text-[0.8125rem] text-slate-500">
                {a.classLabel}
                {a.guardianName ? `, ${a.guardianName}` : ''}
              </span>
            </Link>
            {a.guardianPhone ? (
              <a
                className="btn btn-line btn-xs"
                target="_blank"
                rel="noreferrer"
                href={whatsappLink(
                  a.guardianPhone,
                  `Dear ${a.guardianName ?? 'Parent'}, ${a.name} of class ${a.classLabel} is marked absent at ${schoolName} today (${dateLong(today)}). Please let the class teacher know the reason. — ${schoolName}`,
                )}
              >
                <Icon name="message" size={14} /> WhatsApp
              </a>
            ) : (
              <span className="text-[0.75rem] text-slate-400">No phone</span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function FeesToday({ fees }: { fees: NonNullable<TodayData['fees']> }) {
  const max = Math.max(...fees.lastSeven.map((d) => d.total), 1);
  return (
    <section className="card overflow-hidden">
      <div className="p-4 sm:p-5">
        <p className="text-[0.8125rem] font-semibold text-slate-500">Collected today</p>
        <p className="money mt-0.5 text-[2rem] font-bold leading-tight tracking-tight text-ink-800" style={{ fontStretch: '115%' }}>
          {money(fees.collectedToday)}
        </p>
        <p className="text-[0.8125rem] text-slate-500">{plural(fees.receiptsToday, 'receipt')}</p>

        <div className="mt-4 flex h-14 items-end gap-1.5" role="img" aria-label="Collection over the last seven days">
          {fees.lastSeven.map((d, i) => (
            <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
              <span
                className={`w-full rounded-t-md ${i === 6 ? 'bg-marigold-500' : 'bg-slate-200'}`}
                style={{ height: `${Math.max(3, (d.total / max) * 44)}px` }}
                title={`${d.date}: ${money(d.total)}`}
              />
              <span className="text-[0.625rem] font-semibold text-slate-400">
                {new Intl.DateTimeFormat('en-IN', { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(`${d.date}T00:00:00Z`))}
              </span>
            </div>
          ))}
        </div>
      </div>
      <Link to="/app/fees/dues" className="flex items-center justify-between gap-3 border-t border-slate-100 bg-coral-50/60 px-4 py-3 no-underline hover:bg-coral-50 sm:px-5">
        <span>
          <span className="block text-[0.8125rem] font-semibold text-coral-700">Overdue</span>
          <span className="block text-[0.8125rem] text-slate-600">{plural(fees.overdueStudents, 'student')}</span>
        </span>
        <span className="money text-[1.125rem] font-bold text-coral-700" style={{ fontStretch: '112%' }}>
          {moneyShort(fees.overdue)}
        </span>
      </Link>
    </section>
  );
}

function Checklist({ items, welcome }: { items: NonNullable<TodayData['checklist']>; welcome: boolean }) {
  const steps = [
    { done: items.studentsAdded, label: 'Add your students', note: 'Admit them one by one, or import a spreadsheet.', to: '/app/students/import' },
    { done: items.feePlanCreated, label: 'Make a fee plan', note: 'Instalments and amounts for each class.', to: '/app/fees/plans' },
    { done: items.staffInvited, label: 'Invite your staff', note: 'Teachers mark registers from their phones.', to: '/app/staff?add=1' },
    { done: items.firstRegister, label: 'Take the first register', note: 'One tap per absent student.', to: '/app/attendance' },
    { done: items.firstReceipt, label: 'Record the first fee', note: 'A numbered receipt, ready to print.', to: '/app/fees/collect' },
  ];
  const done = steps.filter((s) => s.done).length;
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between gap-4 bg-ink-800 px-4 py-3.5 sm:px-5" data-surface="dark">
        <div>
          <h2 className="text-[1rem]">{welcome ? 'Your school is ready' : 'Getting started'}</h2>
          <p className="text-[0.8125rem] text-slate-300">{done} of {steps.length} done. Each one takes a few minutes.</p>
        </div>
        <span className="flex gap-1" aria-hidden="true">
          {steps.map((s) => (
            <span key={s.label} className={`h-1.5 w-5 rounded-full ${s.done ? 'bg-marigold-500' : 'bg-white/15'}`} />
          ))}
        </span>
      </header>
      <ol className="grid gap-px bg-slate-100 sm:grid-cols-2">
        {steps.map((s, i) => (
          <li key={s.label} className={`bg-white ${i === steps.length - 1 && steps.length % 2 ? 'sm:col-span-2' : ''}`}>
            <Link to={s.to} className={`flex h-full items-start gap-3 px-4 py-3 no-underline sm:px-5 ${s.done ? 'opacity-60' : 'hover:bg-slate-50'}`}>
              <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[0.75rem] font-bold ${s.done ? 'bg-lagoon-500 text-white' : 'border border-slate-300 text-slate-500'}`}>
                {s.done ? <Icon name="check" size={13} /> : i + 1}
              </span>
              <span>
                <span className={`block font-semibold ${s.done ? 'text-slate-500 line-through' : 'text-ink-800'}`}>{s.label}</span>
                <span className="block text-[0.8125rem] text-slate-500">{s.note}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

