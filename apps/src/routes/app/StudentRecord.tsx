// The student record — "one student, one record" made literal.
//
// The masthead shows the student with their linked records around them, the same
// constellation the website uses to explain Acadlas: family, class, attendance, fees and
// admission, each a live summary that jumps to its part of the page. Below, on paper:
// attendance, fees and the full history of the record, with the details and family beside.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, downloadFromApi, errorMessage } from '../../lib/api';
import { age, date, dateShort, money, phone, timeAgo, todayISO, whatsappLink } from '../../lib/format';
import { sectionOptions, useStructure } from '../../lib/queries';
import { useSchool } from '../../lib/school';
import { Field } from '../../components/Field';
import { FormError } from '../../components/FormError';
import { Icon } from '../../components/Icon';
import type { IconName } from '../../lib/icons';
import { Avatar, BackLink, Card, CheckRow, Dialog, ErrorState, Loading, Notice, Page, Seg, SelectField, Spinner, TextAreaField } from '../../components/ui';
import { useToast } from '../../lib/toast';

type Guardian = {
  id: string;
  name: string;
  phone: string | null;
  altPhone: string | null;
  email: string | null;
  occupation: string | null;
  address: string | null;
  relation: 'father' | 'mother' | 'guardian' | 'other';
  isPrimary: boolean;
};

type StudentData = {
  student: {
    id: string;
    name: string;
    firstName: string;
    lastName: string | null;
    admissionNo: string;
    gender: 'female' | 'male' | 'other' | null;
    dateOfBirth: string | null;
    bloodGroup: string | null;
    apaarId: string | null;
    pen: string | null;
    category: string | null;
    isRte: boolean;
    address: string | null;
    previousSchool: string | null;
    notes: string | null;
    status: 'active' | 'withdrawn' | 'graduated';
    admittedOn: string;
    leftOn: string | null;
    leftReason: string | null;
    consentRecordedAt: string | null;
    consentMethod: string | null;
  };
  guardians: Guardian[];
  siblings: { id: string; name: string; status: string; classLabel: string | null }[];
  current: { yearId: string; yearName: string; sectionId: string; gradeId: string; label: string; rollNo: number | null; enrolledOn: string } | null;
  history: { yearId: string; yearName: string; sectionId: string; label: string; rollNo: number | null; isCurrent: boolean }[];
  attendance: { present: number; late: number; absent: number; total: number; percent: number | null; recent: { date: string; mark: 'P' | 'A' | 'L' }[] } | null;
  fees: { net: number; paid: number; balance: number; overdue: number; nextDue: { label: string; dueOn: string; balance: number } | null } | null;
  timeline: { id: string; action: string; summary: string; actorName: string | null; createdAt: string }[];
  can: { edit: boolean; fees: boolean; collect: boolean; manageFees: boolean };
};

const relationLabel = { father: 'Father', mother: 'Mother', guardian: 'Guardian', other: 'Other' } as const;

export function StudentRecord() {
  const { id = '' } = useParams();
  const school = useSchool();
  const record = useQuery({ queryKey: ['student', id], queryFn: () => api.get<StudentData>(`/school/students/${id}`) });
  const [dialog, setDialog] = useState<null | 'edit' | 'move' | 'leave' | 'consent' | 'guardian-add' | { guardian: Guardian }>(null);

  if (record.isPending) {
    return (
      <Page title=" " back={<BackLink to="/app/students">Students</BackLink>}>
        <Loading rows={6} />
      </Page>
    );
  }
  if (record.error || !record.data) {
    return (
      <Page title="Student" back={<BackLink to="/app/students">Students</BackLink>}>
        <ErrorState error={record.error} retry={() => record.refetch()} />
      </Page>
    );
  }

  const d = record.data;
  const s = d.student;
  const left = s.status !== 'active';

  return (
    <Page
      title={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {s.name}
          {s.isRte && <span className="tag tag-sun align-middle text-[0.75rem]">RTE</span>}
          {left && <span className="tag tag-slate align-middle text-[0.75rem]">{s.status === 'withdrawn' ? 'Left the school' : 'Passed out'}</span>}
        </span>
      }
      lead={[d.current ? `Class ${d.current.label}` : left ? null : 'No class this year', d.current?.rollNo ? `roll ${d.current.rollNo}` : null, s.admissionNo].filter(Boolean).join(', ')}
      back={<BackLink to="/app/students">Students</BackLink>}
      actions={<RecordActions data={d} open={setDialog} />}
      under={<Constellation data={d} />}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="min-w-0 space-y-5">
          {left && (
            <Notice tone="info" icon="info">
              {s.status === 'withdrawn' ? 'Left' : 'Passed out'} on {date(s.leftOn)}
              {s.leftReason ? `: ${s.leftReason}` : ''}. The record is kept as it was.
            </Notice>
          )}
          {!s.consentRecordedAt && !left && d.can.edit && (
            <Notice tone="warn">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span>Guardian consent to keep these records has not been recorded.</span>
                <button type="button" className="btn btn-line btn-xs" onClick={() => setDialog('consent')}>
                  Record consent
                </button>
              </span>
            </Notice>
          )}

          <AttendanceCard data={d} />
          {d.fees && <FeesCard data={d} />}

          <Card title="History" pad={false}>
            {d.timeline.length === 0 ? (
              <p className="p-5 text-[0.875rem] text-slate-500">Nothing has changed on this record yet.</p>
            ) : (
              <ol className="relative px-4 py-4 sm:px-5">
                <span className="absolute bottom-6 left-[1.6rem] top-6 w-px bg-slate-200 sm:left-[1.85rem]" aria-hidden="true" />
                {d.timeline.map((e) => (
                  <li key={e.id} className="relative flex gap-3 py-2">
                    <span className={`relative z-10 mt-1 grid size-5 shrink-0 place-items-center rounded-full ring-4 ring-white ${timelineTone(e.action)}`}>
                      <Icon name={timelineIcon(e.action)} size={11} />
                    </span>
                    <span className="min-w-0 text-[0.875rem]">
                      <span className="block text-ink-800">{e.summary}</span>
                      <span className="block text-[0.75rem] text-slate-500">
                        {e.actorName}, {timeAgo(e.createdAt)}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card id="details" title="Details" action={d.can.edit && <button type="button" className="btn btn-quiet btn-sm" onClick={() => setDialog('edit')}><Icon name="edit" size={14} /> Edit</button>}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[0.875rem]">
              <Fact label="Date of birth" value={s.dateOfBirth ? `${date(s.dateOfBirth)} (${age(s.dateOfBirth, school.today)})` : '—'} wide />
              <Fact label="Gender" value={s.gender ? { female: 'Girl', male: 'Boy', other: 'Other' }[s.gender] : '—'} />
              <Fact label="Blood group" value={s.bloodGroup ?? '—'} />
              <Fact label="APAAR ID" value={s.apaarId ?? '—'} />
              <Fact label="PEN" value={s.pen ?? '—'} />
              <Fact label="Admitted" value={date(s.admittedOn)} />
              <Fact label="Category" value={s.category ?? '—'} />
              <Fact label="Address" value={s.address ?? '—'} wide />
              {s.previousSchool && <Fact label="Previous school" value={s.previousSchool} wide />}
              {s.notes && <Fact label="Notes" value={s.notes} wide />}
              <Fact
                label="Consent"
                value={s.consentRecordedAt ? `${{ paper: 'Signed form', digital: 'Online form', verbal: 'In person' }[s.consentMethod ?? 'paper'] ?? s.consentMethod}, ${date(s.consentRecordedAt.slice(0, 10))}` : 'Not recorded'}
                wide
              />
            </dl>
          </Card>

          <Card id="family" title="Family" pad={false} action={d.can.edit && <button type="button" className="btn btn-quiet btn-sm" onClick={() => setDialog('guardian-add')}><Icon name="plus" size={14} /> Add</button>}>
            <ul className="divide-y divide-slate-100">
              {d.guardians.map((g) => (
                <li key={g.id} className="px-4 py-3.5 sm:px-5">
                  <div className="flex items-start gap-3">
                    <Avatar name={g.name} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 font-semibold text-ink-800">
                        {g.name}
                        {g.isPrimary && <span className="tag tag-ink">Main contact</span>}
                      </p>
                      <p className="text-[0.8125rem] text-slate-500">
                        {relationLabel[g.relation]}
                        {g.occupation ? `, ${g.occupation}` : ''}
                      </p>
                      {g.email && <p className="truncate text-[0.8125rem] text-slate-500">{g.email}</p>}
                    </div>
                    {d.can.edit && (
                      <button type="button" className="btn btn-quiet btn-icon" aria-label={`Edit ${g.name}`} onClick={() => setDialog({ guardian: g })}>
                        <Icon name="edit" size={15} />
                      </button>
                    )}
                  </div>
                  {g.phone && (
                    <div className="mt-2.5 flex flex-wrap gap-2 pl-12">
                      <a href={`tel:+91${g.phone}`} className="btn btn-line btn-xs">
                        <Icon name="phone" size={13} /> <span className="num">{phone(g.phone)}</span>
                      </a>
                      <a href={whatsappLink(g.phone, `Dear ${g.name}, `)} target="_blank" rel="noreferrer" className="btn btn-line btn-xs">
                        <Icon name="message" size={13} /> WhatsApp
                      </a>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {d.siblings.length > 0 && (
              <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 sm:px-5">
                <p className="text-[0.75rem] font-semibold text-slate-500">Brothers and sisters here</p>
                <ul className="mt-1.5 flex flex-wrap gap-2">
                  {d.siblings.map((sib) => (
                    <li key={sib.id}>
                      <Link to={`/app/students/${sib.id}`} className="inline-flex items-center gap-2 rounded-full bg-white py-1 pl-1 pr-3 text-[0.8125rem] font-semibold text-ink-800 no-underline ring-1 ring-slate-200 hover:ring-ink-800">
                        <Avatar name={sib.name} size={24} />
                        {sib.name}
                        <span className="font-normal text-slate-500">{sib.classLabel ?? (sib.status !== 'active' ? 'left' : '')}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          {d.history.length > 0 && (
            <Card id="classes" title="Classes">
              <ol className="space-y-2 text-[0.875rem]">
                {d.history.map((h) => (
                  <li key={h.yearId} className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">{h.yearName}</span>
                    <span className="font-semibold text-ink-800">
                      {h.label}
                      {h.rollNo ? <span className="font-normal text-slate-500">, roll {h.rollNo}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </div>
      </div>

      <EditStudentDialog open={dialog === 'edit'} onClose={() => setDialog(null)} data={d} />
      <MoveDialog open={dialog === 'move'} onClose={() => setDialog(null)} data={d} />
      <LeaveDialog open={dialog === 'leave'} onClose={() => setDialog(null)} data={d} />
      <ConsentDialog open={dialog === 'consent'} onClose={() => setDialog(null)} data={d} />
      <GuardianDialog open={dialog === 'guardian-add' || (typeof dialog === 'object' && dialog !== null)} onClose={() => setDialog(null)} studentId={s.id} guardian={typeof dialog === 'object' && dialog ? dialog.guardian : null} canRemove={d.guardians.length > 1} />
    </Page>
  );
}

// ---------------------------------------------------------------------------

function Constellation({ data }: { data: StudentData }) {
  const s = data.student;
  const g = data.guardians[0];
  const a = data.attendance;
  const f = data.fees;
  const nodes: { key: string; icon: IconName; label: string; value: string; note?: string; target: string; tone?: 'coral' | 'lagoon' }[] = [
    { key: 'family', icon: 'students', label: 'Family', value: g ? g.name : 'No guardian', note: g?.phone ? phone(g.phone) : undefined, target: 'family' },
    { key: 'class', icon: 'classes', label: 'Class', value: data.current ? data.current.label : '—', note: data.current?.rollNo ? `Roll ${data.current.rollNo}` : undefined, target: 'classes' },
    {
      key: 'attendance',
      icon: 'attendance',
      label: 'Attendance',
      value: a?.percent !== null && a?.percent !== undefined ? `${a.percent}%` : 'Not marked yet',
      note: a && a.total ? `${a.absent} absent of ${a.total} days` : undefined,
      target: 'attendance',
      tone: a?.percent !== null && a?.percent !== undefined && a.percent < 75 ? 'coral' : undefined,
    },
    ...(f
      ? [
          {
            key: 'fees',
            icon: 'fees' as IconName,
            label: 'Fees',
            value: f.balance > 0 ? `${money(f.balance)} due` : f.net > 0 ? 'Paid up' : 'No fees',
            note: f.overdue > 0 ? `${money(f.overdue)} overdue` : f.nextDue ? `Next: ${dateShort(f.nextDue.dueOn)}` : undefined,
            target: 'fees',
            tone: (f.overdue > 0 ? 'coral' : f.balance === 0 && f.net > 0 ? 'lagoon' : undefined) as 'coral' | 'lagoon' | undefined,
          },
        ]
      : []),
    { key: 'admission', icon: 'admission', label: 'Admission', value: s.admissionNo, note: date(s.admittedOn), target: 'details' },
  ];

  return (
    <div className="relative">
      {/* The thread that ties the records to the student, as on the website's hero. */}
      <svg className="pointer-events-none absolute inset-x-0 top-1/2 hidden h-px w-full -translate-y-1/2 overflow-visible md:block" aria-hidden="true">
        <line x1="0" y1="0" x2="100%" y2="0" stroke="rgba(248,187,76,.55)" strokeWidth="1.5" strokeDasharray="2.5 6" strokeLinecap="round" />
      </svg>
      <ul className="relative flex gap-2.5 overflow-x-auto pb-1 md:grid md:overflow-visible md:pb-0" style={{ gridTemplateColumns: `repeat(${nodes.length}, minmax(0, 1fr))` }}>
        {nodes.map((n, i) => (
          <li key={n.key} className="pop min-w-[11rem] md:min-w-0" style={{ '--d': `${120 + i * 70}ms` } as React.CSSProperties}>
            <button
              type="button"
              onClick={() => document.getElementById(n.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className="orbit-card flex w-full items-center gap-2.5 p-2.5 text-left"
            >
              <span className="orbit-icon shrink-0">
                <Icon name={n.icon} size={16} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="orbit-label">{n.label}</span>
                <span className={`orbit-value truncate ${n.tone === 'coral' ? '!text-coral-100' : n.tone === 'lagoon' ? '!text-lagoon-200' : ''}`}>{n.value}</span>
                {n.note && <span className="truncate text-[0.6875rem] text-slate-400">{n.note}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecordActions({ data, open }: { data: StudentData; open: (d: 'edit' | 'move' | 'leave' | 'consent') => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [menu, setMenu] = useState(false);
  const s = data.student;
  const reinstate = useMutation({
    mutationFn: () => api.post(`/school/students/${s.id}/reinstate`),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast(`${s.firstName} has rejoined`);
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });

  return (
    <>
      {data.can.collect && s.status === 'active' && (
        <Link to={`/app/fees/collect/${s.id}`} className="btn btn-sun btn-sm">
          <Icon name="fees" size={16} /> Collect fee
        </Link>
      )}
      <div className="relative">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMenu((v) => !v)} aria-expanded={menu} aria-haspopup="menu">
          More <Icon name="chevron-down" size={14} />
        </button>
        {menu && (
          <div role="menu" className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-60 overflow-hidden rounded-2xl bg-white py-1.5 shadow-card ring-1 ring-slate-200" onClick={() => setMenu(false)}>
            {data.can.edit && s.status === 'active' && (
              <>
                <MenuItem icon="edit" onClick={() => open('edit')}>Edit details</MenuItem>
                <MenuItem icon="move" onClick={() => open('move')}>Move to another section</MenuItem>
                <MenuItem icon="logout" onClick={() => open('leave')}>Mark as left</MenuItem>
              </>
            )}
            {data.can.edit && s.status !== 'active' && <MenuItem icon="undo" onClick={() => reinstate.mutate()}>Rejoin the school</MenuItem>}
            <MenuLink icon="printer" to={`/app/students/${s.id}/certificate`}>{s.status === 'active' ? 'Bonafide certificate' : 'Leaving certificate'}</MenuLink>
            {data.can.edit && (
              <MenuItem
                icon="download"
                onClick={() =>
                  downloadFromApi(`/school/students/${s.id}/export`, `${s.admissionNo.replace(/[^A-Za-z0-9-]/g, '_')}-records.json`)
                    .then(() => toast('Downloaded everything held about this student'))
                    .catch((e) => toast(errorMessage(e), 'bad'))
                }
              >
                Download all data
              </MenuItem>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function MenuItem({ icon, children, onClick }: { icon: IconName; children: ReactNode; onClick: () => void }) {
  return (
    <button role="menuitem" type="button" onClick={onClick} className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[0.875rem] font-medium text-ink-800 hover:bg-slate-50">
      <Icon name={icon} size={16} className="text-slate-500" />
      {children}
    </button>
  );
}

function MenuLink({ icon, children, to }: { icon: IconName; children: ReactNode; to: string }) {
  return (
    <Link role="menuitem" to={to} className="flex w-full items-center gap-2.5 px-4 py-2 text-[0.875rem] font-medium text-ink-800 no-underline hover:bg-slate-50">
      <Icon name={icon} size={16} className="text-slate-500" />
      {children}
    </Link>
  );
}

function Fact({ label, value, wide }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <dt className="text-[0.75rem] font-semibold text-slate-500">{label}</dt>
      <dd className="m-0 font-medium text-ink-800">{value}</dd>
    </div>
  );
}

function AttendanceCard({ data }: { data: StudentData }) {
  const a = data.attendance;
  return (
    <section id="attendance" className="card scroll-mt-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
        <h2 className="text-[1rem]">Attendance this year</h2>
        {data.current && (
          <Link to={`/app/attendance/${data.current.sectionId}/month`} className="link text-[0.8125rem]">
            {data.current.label} month view
          </Link>
        )}
      </header>
      <div className="card-pad">
        {!a || a.total === 0 ? (
          <p className="text-[0.875rem] text-slate-500">No registers with this student have been taken this year.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
              <div>
                <p className={`text-[2rem] font-bold leading-none ${a.percent !== null && a.percent < 75 ? 'text-coral-700' : 'text-ink-800'}`} style={{ fontStretch: '115%' }}>
                  {a.percent}%
                </p>
                <p className="mt-1 text-[0.8125rem] text-slate-500">of {a.total} school {a.total === 1 ? 'day' : 'days'}</p>
              </div>
              <dl className="flex gap-6 text-[0.875rem]">
                <div><dt className="text-slate-500">Present</dt><dd className="m-0 font-bold text-ink-800">{a.present}</dd></div>
                <div><dt className="text-slate-500">Late</dt><dd className="m-0 font-bold text-marigold-700">{a.late}</dd></div>
                <div><dt className="text-slate-500">Absent</dt><dd className="m-0 font-bold text-coral-700">{a.absent}</dd></div>
              </dl>
            </div>
            {a.percent !== null && a.percent < 75 && (
              <p className="mt-3 text-[0.8125rem] font-medium text-coral-700">Below the 75% most boards require to sit exams.</p>
            )}
            <div className="mt-4">
              <p className="mb-1.5 text-[0.75rem] font-semibold text-slate-500">{a.recent.length === 1 ? 'The one day marked so far' : `Last ${a.recent.length} school days, newest first`}</p>
              <ol className="flex flex-wrap gap-1">
                {a.recent.map((m) => (
                  <li
                    key={m.date}
                    title={`${dateShort(m.date)}: ${m.mark === 'P' ? 'present' : m.mark === 'A' ? 'absent' : 'late'}`}
                    className={`grid size-6 place-items-center rounded-md text-[0.625rem] font-bold ${
                      m.mark === 'P' ? 'bg-lagoon-100 text-lagoon-700' : m.mark === 'A' ? 'bg-coral-500 text-white' : 'bg-marigold-300 text-marigold-700'
                    }`}
                  >
                    {Number(m.date.slice(8))}
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function FeesCard({ data }: { data: StudentData }) {
  const f = data.fees!;
  return (
    <section id="fees" className="card scroll-mt-6 overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
        <h2 className="text-[1rem]">Fees, {data.current?.yearName ?? 'this year'}</h2>
        <Link to={`/app/fees/collect/${data.student.id}`} className="link text-[0.8125rem]">
          Full ledger
        </Link>
      </header>
      <div className="grid grid-cols-3 divide-x divide-slate-100">
        {[
          ['Charged', money(f.net), 'text-ink-800'],
          ['Paid', money(f.paid), 'text-lagoon-700'],
          ['Due', money(f.balance), f.overdue > 0 ? 'text-coral-700' : 'text-ink-800'],
        ].map(([k, v, c]) => (
          <div key={k} className="px-4 py-3.5 sm:px-5">
            <p className="text-[0.75rem] font-semibold text-slate-500">{k}</p>
            <p className={`money text-[1.125rem] font-bold ${c}`} style={{ fontStretch: '110%' }}>{v}</p>
          </div>
        ))}
      </div>
      {(f.overdue > 0 || f.nextDue) && (
        <p className={`border-t border-slate-100 px-4 py-2.5 text-[0.8125rem] sm:px-5 ${f.overdue > 0 ? 'bg-coral-50 text-coral-700' : 'bg-slate-50 text-slate-600'}`}>
          {f.overdue > 0 ? `${money(f.overdue)} is overdue.` : `Next: ${f.nextDue!.label}, ${money(f.nextDue!.balance)} by ${date(f.nextDue!.dueOn)}.`}
        </p>
      )}
    </section>
  );
}

function timelineIcon(action: string): IconName {
  if (action.startsWith('fee.received')) return 'receipt';
  if (action.startsWith('fee')) return 'fees';
  if (action.startsWith('attendance')) return 'attendance';
  if (action.includes('moved') || action.includes('promoted')) return 'move';
  if (action.includes('admitted') || action.includes('imported')) return 'admission';
  if (action.includes('guardian')) return 'students';
  if (action.includes('withdrawn') || action.includes('graduated')) return 'logout';
  if (action.includes('consent')) return 'shield';
  return 'edit';
}

function timelineTone(action: string): string {
  if (action === 'fee.received') return 'bg-lagoon-500 text-white';
  if (action === 'fee.cancelled' || action.includes('withdrawn')) return 'bg-coral-500 text-white';
  if (action.includes('admitted') || action.includes('imported')) return 'bg-marigold-500 text-night';
  return 'bg-slate-100 text-slate-600';
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function useRecordMutation<T>(studentId: string, fn: (body: T) => Promise<unknown>, done: string, onClose: () => void) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student', studentId] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
      queryClient.invalidateQueries({ queryKey: ['today'] });
      toast(done);
      onClose();
    },
  });
}

function EditStudentDialog({ open, onClose, data }: { open: boolean; onClose: () => void; data: StudentData }) {
  const s = data.student;
  const [form, setForm] = useState(() => ({
    firstName: s.firstName,
    lastName: s.lastName ?? '',
    admissionNo: s.admissionNo,
    gender: s.gender ?? ('' as '' | 'female' | 'male' | 'other'),
    dateOfBirth: s.dateOfBirth ?? '',
    bloodGroup: s.bloodGroup ?? '',
    apaarId: s.apaarId ?? '',
    pen: s.pen ?? '',
    category: s.category ?? '',
    isRte: s.isRte,
    address: s.address ?? '',
    previousSchool: s.previousSchool ?? '',
    notes: s.notes ?? '',
  }));
  const save = useRecordMutation(s.id, () => api.patch(`/school/students/${s.id}`, { ...form, gender: form.gender || null, dateOfBirth: form.dateOfBirth || null }), 'Saved', onClose);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Edit ${s.firstName}’s details`}
      wide
      footer={
        <>
          <button type="button" className="btn btn-line btn-sm" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-ink btn-sm" onClick={() => save.mutate(undefined)} disabled={save.isPending}>
            {save.isPending && <Spinner />} Save changes
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={save.error ? errorMessage(save.error) : null} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="e-first" label="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          <Field id="e-last" label="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          <Field id="e-adm" label="Admission number" value={form.admissionNo} onChange={(e) => setForm({ ...form, admissionNo: e.target.value })} />
          <Field id="e-dob" label="Date of birth" type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
          <div>
            <p className="input-label">Gender</p>
            <Seg label="Gender" value={form.gender} onChange={(v) => setForm({ ...form, gender: v })} options={[{ value: 'female', label: 'Girl' }, { value: 'male', label: 'Boy' }, { value: 'other', label: 'Other' }]} />
          </div>
          <SelectField label="Blood group" value={form.bloodGroup} onChange={(e) => setForm({ ...form, bloodGroup: e.target.value })}>
            <option value="">Not known</option>
            {['A+', 'A−', 'B+', 'B−', 'AB+', 'AB−', 'O+', 'O−'].map((b) => <option key={b}>{b}</option>)}
          </SelectField>
          <Field id="e-apaar" label="APAAR ID" value={form.apaarId} onChange={(e) => setForm({ ...form, apaarId: e.target.value })} />
          <Field id="e-pen" label="PEN" value={form.pen} onChange={(e) => setForm({ ...form, pen: e.target.value })} />
          <SelectField label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            <option value="">Not recorded</option>
            {['General', 'EWS', 'OBC', 'SC', 'ST'].map((c) => <option key={c}>{c}</option>)}
          </SelectField>
          <Field id="e-prev" label="Previous school" value={form.previousSchool} onChange={(e) => setForm({ ...form, previousSchool: e.target.value })} />
          <div className="sm:col-span-2"><TextAreaField label="Address" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div className="sm:col-span-2"><TextAreaField label="Notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <CheckRow checked={form.isRte} onChange={(v) => setForm({ ...form, isRte: v })} label="Admitted under RTE" hint="Changing this recalculates this year’s unpaid fees." />
      </div>
    </Dialog>
  );
}

function MoveDialog({ open, onClose, data }: { open: boolean; onClose: () => void; data: StudentData }) {
  const structure = useStructure();
  const all = sectionOptions(structure.data).filter((s) => s.id !== data.current?.sectionId);
  // Another section of the same class is by far the usual move, so those come first.
  const sameClass = all.filter((s) => s.gradeId === data.current?.gradeId);
  const otherClasses = all.filter((s) => s.gradeId !== data.current?.gradeId);
  const sections = all;
  const [sectionId, setSectionId] = useState('');
  const move = useRecordMutation(data.student.id, () => api.post(`/school/students/${data.student.id}/move`, { sectionId }), `Moved ${data.student.firstName}`, onClose);
  const target = sections.find((s) => s.id === sectionId);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Move ${data.student.firstName} to another section`}
      lead={data.current ? `Now in ${data.current.label}. Past registers stay with ${data.current.label}.` : undefined}
      footer={
        <>
          <button type="button" className="btn btn-line btn-sm" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-ink btn-sm" onClick={() => move.mutate(undefined)} disabled={!sectionId || move.isPending}>
            {move.isPending && <Spinner />} Move to {target?.label ?? '…'}
          </button>
        </>
      }
    >
      <FormError message={move.error ? errorMessage(move.error) : null} />
      {[
        { label: 'Same class', list: sameClass },
        { label: 'Another class', list: otherClasses },
      ]
        .filter((group) => group.list.length > 0)
        .map((group) => (
          <div key={group.label} className="mt-3 first:mt-0">
            <p className="mb-1.5 text-[0.75rem] font-semibold text-slate-500">{group.label}</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {group.list.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSectionId(s.id)}
                  aria-pressed={sectionId === s.id}
                  className={`rounded-xl border p-2.5 text-left ${sectionId === s.id ? 'border-ink-800 bg-ink-800 text-white' : 'border-slate-200 hover:border-slate-400'}`}
                >
                  <span className="block font-bold" style={{ fontStretch: '112%' }}>{s.label}</span>
                  <span className={`block text-[0.75rem] ${sectionId === s.id ? 'text-slate-300' : 'text-slate-500'}`}>{s.strength} students</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      {target && target.gradeId !== data.current?.gradeId && (
        <div className="mt-4">
          <Notice tone="warn">This is a different class level. Unpaid fees will switch to that class’s fee plan.</Notice>
        </div>
      )}
    </Dialog>
  );
}

function LeaveDialog({ open, onClose, data }: { open: boolean; onClose: () => void; data: StudentData }) {
  const [form, setForm] = useState({ date: todayISO(), reason: '' });
  const leave = useRecordMutation(data.student.id, () => api.post(`/school/students/${data.student.id}/withdraw`, form), `${data.student.firstName} marked as left`, onClose);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Mark ${data.student.firstName} as having left`}
      lead="The record, its attendance and its receipts are all kept. A leaving certificate can be printed afterwards."
      footer={
        <>
          <button type="button" className="btn btn-line btn-sm" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => leave.mutate(undefined)} disabled={!form.reason.trim() || leave.isPending}>
            {leave.isPending && <Spinner />} Mark as left
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={leave.error ? errorMessage(leave.error) : null} />
        <Field id="l-date" label="Last day" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <div>
          <Field id="l-reason" label="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Family moved to Lucknow" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {['Family relocated', 'Transferred to another school', 'Financial reasons', 'Completed schooling'].map((r) => (
              <button key={r} type="button" className="rounded-full bg-slate-100 px-2.5 py-1 text-[0.75rem] font-semibold text-slate-600 hover:bg-slate-200" onClick={() => setForm({ ...form, reason: r })}>
                {r}
              </button>
            ))}
          </div>
        </div>
        {data.fees && data.fees.balance > 0 && <Notice tone="warn">{money(data.fees.balance)} in fees is still unpaid on this record.</Notice>}
      </div>
    </Dialog>
  );
}

function ConsentDialog({ open, onClose, data }: { open: boolean; onClose: () => void; data: StudentData }) {
  const [method, setMethod] = useState<'paper' | 'digital' | 'verbal'>('paper');
  const save = useRecordMutation(data.student.id, () => api.post(`/school/students/${data.student.id}/consent`, { method }), 'Consent recorded', onClose);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Record guardian consent"
      lead="Required under the DPDP Act before the school keeps a child’s personal data."
      footer={
        <>
          <button type="button" className="btn btn-line btn-sm" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-ink btn-sm" onClick={() => save.mutate(undefined)} disabled={save.isPending}>
            {save.isPending && <Spinner />} Record consent
          </button>
        </>
      }
    >
      <p className="input-label">How the guardian gave consent</p>
      <Seg label="Method" value={method} onChange={setMethod} options={[{ value: 'paper', label: 'Signed form' }, { value: 'digital', label: 'Online form' }, { value: 'verbal', label: 'In person' }]} />
    </Dialog>
  );
}

function GuardianDialog({ open, onClose, studentId, guardian, canRemove }: { open: boolean; onClose: () => void; studentId: string; guardian: Guardian | null; canRemove: boolean }) {
  const editing = Boolean(guardian);
  const [form, setForm] = useState({ name: '', relation: 'mother' as Guardian['relation'], phone: '', altPhone: '', email: '', occupation: '', address: '' });
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = guardian?.id ?? 'new';
  if (open && loadedFor !== key) {
    setLoadedFor(key);
    setForm(
      guardian
        ? { name: guardian.name, relation: guardian.relation, phone: guardian.phone ?? '', altPhone: guardian.altPhone ?? '', email: guardian.email ?? '', occupation: guardian.occupation ?? '', address: guardian.address ?? '' }
        : { name: '', relation: 'mother', phone: '', altPhone: '', email: '', occupation: '', address: '' },
    );
  }
  const close = () => {
    setLoadedFor(null);
    onClose();
  };

  const save = useRecordMutation(
    studentId,
    () => {
      const { relation, ...fields } = form;
      return editing ? api.patch(`/school/guardians/${guardian!.id}`, fields) : api.post(`/school/students/${studentId}/guardians`, { ...form, relation, isPrimary: false });
    },
    editing ? 'Guardian updated' : 'Guardian added',
    close,
  );
  const makePrimary = useRecordMutation(studentId, () => api.post(`/school/students/${studentId}/guardians/${guardian!.id}/primary`), 'Main contact changed', close);
  const remove = useRecordMutation(studentId, () => api.del(`/school/students/${studentId}/guardians/${guardian!.id}`), 'Guardian removed', close);
  const error = save.error ?? makePrimary.error ?? remove.error;

  return (
    <Dialog
      open={open}
      onClose={close}
      title={editing ? `Edit ${guardian!.name}` : 'Add a guardian'}
      lead={editing ? 'Changes show on the record of every child in this family.' : undefined}
      footer={
        <>
          {editing && canRemove && (
            <button type="button" className="btn btn-quiet btn-sm mr-auto text-coral-700" onClick={() => remove.mutate(undefined)}>
              Remove from this student
            </button>
          )}
          <button type="button" className="btn btn-line btn-sm" onClick={close}>Cancel</button>
          <button type="button" className="btn btn-ink btn-sm" onClick={() => save.mutate(undefined)} disabled={!form.name.trim() || save.isPending}>
            {save.isPending && <Spinner />} Save
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error ? errorMessage(error) : null} />
        {!editing && (
          <Seg label="Relation" value={form.relation} onChange={(relation) => setForm({ ...form, relation })} options={[{ value: 'father', label: 'Father' }, { value: 'mother', label: 'Mother' }, { value: 'guardian', label: 'Guardian' }, { value: 'other', label: 'Other' }]} />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="gd-name" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Field id="gd-phone" label="Mobile number" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Field id="gd-alt" label="Another number" inputMode="tel" value={form.altPhone} onChange={(e) => setForm({ ...form, altPhone: e.target.value })} />
          <Field id="gd-email" label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Field id="gd-occ" label="Occupation" value={form.occupation} onChange={(e) => setForm({ ...form, occupation: e.target.value })} />
        </div>
        {editing && !guardian!.isPrimary && (
          <button type="button" className="btn btn-line btn-sm" onClick={() => makePrimary.mutate(undefined)}>
            Make main contact
          </button>
        )}
      </div>
    </Dialog>
  );
}
