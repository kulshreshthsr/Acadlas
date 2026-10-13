// The register: the screen a teacher opens on a phone at 8:40 every morning.
//
// Everyone starts present, so a teacher only touches the children who are not there:
// one tap marks absent, a second marks late, a third puts them back. The tally and the
// submit button stay under the thumb. Marks are kept on the phone while they are being
// made, so a dropped connection or a closed tab loses nothing.
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, withQuery, errorMessage } from '../../lib/api';
import { dateLong, initials, plural, timeAgo, whatsappLink } from '../../lib/format';
import { useSchool } from '../../lib/school';
import { Icon } from '../../components/Icon';
import { BackLink, ErrorState, Loading, Notice, Page, Spinner } from '../../components/ui';

type Mark = 'P' | 'A' | 'L';
type RegisterData = {
  section: { id: string; label: string };
  date: string;
  holiday: { name: string } | null;
  workingDay: boolean;
  roster: { id: string; name: string; rollNo: number | null; gender: string | null; birthday: boolean }[];
  register: { marks: Record<string, Mark>; takenByName: string | null; createdAt: string; updatedAt: string } | null;
  canEdit: boolean;
  lockedReason: string | null;
};
type SubmitResult = { present: number; absent: number; late: number; corrected: number; absentees: { id: string; name: string; guardianName: string | null; guardianPhone: string | null }[] };

const next: Record<Mark, Mark> = { P: 'A', A: 'L', L: 'P' };
const label: Record<Mark, string> = { P: 'Present', A: 'Absent', L: 'Late' };

function draftKey(sectionId: string, date: string) {
  return `acadlas:register:${sectionId}:${date}`;
}
function readDraft(key: string): Record<string, Mark> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function Register() {
  const { sectionId = '' } = useParams();
  const [params] = useSearchParams();
  const school = useSchool();
  const date = params.get('date') ?? school.today;
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['register', sectionId, date], queryFn: () => api.get<RegisterData>(withQuery('/school/attendance/register', { sectionId, date })) });

  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [done, setDone] = useState<SubmitResult | null>(null);
  const [editing, setEditing] = useState(false);
  const key = draftKey(sectionId, date);

  // Start from: an unsent draft on this phone, else the saved register, else everyone present.
  // Done while rendering (not in an effect) so the first paint already shows the right marks.
  if (q.data && loadedFor !== `${sectionId}:${date}`) {
    const base = Object.fromEntries(q.data.roster.map((s) => [s.id, (q.data.register?.marks[s.id] ?? 'P') as Mark]));
    const draft = readDraft(key);
    if (draft) for (const id of Object.keys(base)) if (draft[id]) base[id] = draft[id];
    setMarks(base);
    setLoadedFor(`${sectionId}:${date}`);
    setEditing(!q.data.register || Boolean(draft));
    setDone(null);
  }

  // Keep unsent marks on the phone. A register that matches what is saved needs no draft.
  useEffect(() => {
    if (!editing || !loadedFor || !q.data) return;
    const saved = q.data.register?.marks;
    const differs = !saved || Object.entries(marks).some(([id, m]) => saved[id] !== m);
    try {
      if (differs) localStorage.setItem(key, JSON.stringify(marks));
      else localStorage.removeItem(key);
    } catch {
      /* storage unavailable — the marks are still in memory */
    }
  }, [marks, editing, loadedFor, key, q.data]);

  const tally = useMemo(() => {
    const t = { P: 0, A: 0, L: 0 };
    for (const m of Object.values(marks)) t[m] += 1;
    return t;
  }, [marks]);

  const submit = useMutation({
    mutationFn: () => api.put<SubmitResult>('/school/attendance/register', { sectionId, date, marks }),
    onSuccess: (r) => {
      try {
        localStorage.removeItem(key);
      } catch {
        /* nothing to clear */
      }
      setDone(r);
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['register', sectionId, date] });
      queryClient.invalidateQueries({ queryKey: ['attendance-sections'] });
      queryClient.invalidateQueries({ queryKey: ['today'] });
      queryClient.invalidateQueries({ queryKey: ['absentees'] });
    },
  });

  const data = q.data;
  const total = data?.roster.length ?? 0;
  const changed = data?.register ? Object.entries(marks).filter(([id, m]) => data.register!.marks[id] && data.register!.marks[id] !== m).length : 0;

  return (
    <Page
      title={data ? `${data.section.label} register` : 'Register'}
      lead={data ? `${dateLong(date)}, ${plural(total, 'student')}` : ' '}
      back={<BackLink to="/app/attendance">Attendance</BackLink>}
      actions={data && <Link to={`/app/attendance/${sectionId}/month`} className="btn btn-ghost btn-sm"><Icon name="calendar" size={15} /> Month</Link>}
    >
      {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Loading rows={6} />}

      {data && done && <Submitted result={done} data={data} schoolName={school.school.name} onEdit={() => { setDone(null); setEditing(true); }} />}

      {data && !done && (
        <>
          {data.holiday && <div className="mb-4"><Notice tone="warn">{data.holiday.name} is marked as a holiday.</Notice></div>}
          {data.register && !editing && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-lagoon-50 px-4 py-3 ring-1 ring-lagoon-100">
              <p className="text-[0.875rem] text-lagoon-700">
                <Icon name="check" size={15} className="mr-1.5 inline" />
                Taken by {data.register.takenByName}, {timeAgo(data.register.createdAt)}
                {data.register.updatedAt !== data.register.createdAt && `, changed ${timeAgo(data.register.updatedAt)}`}.
              </p>
              {data.canEdit && (
                <button type="button" className="btn btn-line btn-sm" onClick={() => setEditing(true)}>
                  <Icon name="edit" size={14} /> Change marks
                </button>
              )}
            </div>
          )}
          {!data.canEdit && data.lockedReason && <div className="mb-4"><Notice>{data.lockedReason}</Notice></div>}

          {total === 0 ? (
            <Notice>There are no students in {data.section.label} yet.</Notice>
          ) : (
            <>
              {editing && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[0.875rem] text-slate-600">Tap a student who is not here. Tap again for late.</p>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => setMarks(Object.fromEntries(Object.keys(marks).map((id) => [id, 'P'])))}>
                    <Icon name="undo" size={14} /> Everyone present
                  </button>
                </div>
              )}
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {data.roster.map((s) => {
                  const m = marks[s.id] ?? 'P';
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        disabled={!editing}
                        onClick={() => setMarks({ ...marks, [s.id]: next[m] })}
                        aria-label={`${s.name}, roll ${s.rollNo ?? ''}: ${label[m]}`}
                        className={`flex w-full items-center gap-2.5 rounded-2xl border p-2 text-left transition-[background-color,border-color,transform] duration-150 active:scale-[0.97] disabled:cursor-default ${
                          m === 'A' ? 'border-coral-500 bg-coral-50' : m === 'L' ? 'border-marigold-400 bg-marigold-50' : 'border-slate-200 bg-white'
                        }`}
                      >
                        <span
                          className={`avatar size-10 text-[0.8125rem] transition-colors ${m === 'A' ? 'bg-coral-500 text-white' : m === 'L' ? 'bg-marigold-400 text-night' : 'bg-lagoon-100 text-lagoon-700'}`}
                        >
                          {m === 'P' ? initials(s.name) : m}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[0.875rem] font-semibold text-ink-800">
                            {s.name} {s.birthday && <Icon name="cake" size={13} className="inline text-marigold-600" />}
                          </span>
                          <span className={`block text-[0.75rem] font-semibold ${m === 'A' ? 'text-coral-700' : m === 'L' ? 'text-marigold-700' : 'text-slate-500'}`}>
                            {s.rollNo ? `${s.rollNo}. ` : ''}{label[m]}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {editing && (
                <div className="sticky bottom-20 z-20 mt-5 rounded-2xl bg-ink-800 p-3.5 shadow-card lg:bottom-4" data-surface="dark">
                  <div className="flex items-center gap-4">
                    <dl className="flex flex-1 items-center gap-4 text-white">
                      <div><dt className="text-[0.6875rem] text-slate-400">Present</dt><dd className="m-0 text-[1.25rem] font-bold leading-tight" style={{ fontStretch: '115%' }}>{tally.P}</dd></div>
                      <div><dt className="text-[0.6875rem] text-slate-400">Absent</dt><dd className="m-0 text-[1.25rem] font-bold leading-tight text-coral-100" style={{ fontStretch: '115%' }}>{tally.A}</dd></div>
                      <div><dt className="text-[0.6875rem] text-slate-400">Late</dt><dd className="m-0 text-[1.25rem] font-bold leading-tight text-marigold-300" style={{ fontStretch: '115%' }}>{tally.L}</dd></div>
                    </dl>
                    <button type="button" className="btn btn-sun" disabled={submit.isPending} onClick={() => submit.mutate()}>
                      {submit.isPending && <Spinner />}
                      {data.register ? (changed ? `Save ${plural(changed, 'change')}` : 'Save') : 'Submit register'}
                    </button>
                  </div>
                  <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                    <span className="bg-lagoon-400 transition-[width] duration-300" style={{ width: `${(tally.P / total) * 100}%` }} />
                    <span className="bg-marigold-400 transition-[width] duration-300" style={{ width: `${(tally.L / total) * 100}%` }} />
                    <span className="bg-coral-500 transition-[width] duration-300" style={{ width: `${(tally.A / total) * 100}%` }} />
                  </div>
                  {submit.error && (
                    <p className="mt-2.5 text-[0.8125rem] text-coral-100">
                      {errorMessage(submit.error)} Your marks are saved on this phone — try again when you are back online.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </Page>
  );
}

function Submitted({ result, data, schoolName, onEdit }: { result: SubmitResult; data: RegisterData; schoolName: string; onEdit: () => void }) {
  return (
    <div className="mx-auto max-w-xl">
      <div className="rounded-[var(--radius-xl)] bg-ink-800 p-6 text-center" data-surface="dark">
        <span className="pop mx-auto grid size-14 place-items-center rounded-full bg-lagoon-500 text-white">
          <Icon name="check" size={26} />
        </span>
        <h2 className="mt-4 text-[1.375rem]">{result.corrected ? 'Register corrected' : 'Register submitted'}</h2>
        <p className="mt-1 text-slate-300">
          {data.section.label}: {result.present + result.late} present{result.late ? ` (${result.late} late)` : ''}, {result.absent} absent.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link to="/app" className="btn btn-sun btn-sm">Back to Today</Link>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>Change marks</button>
        </div>
      </div>

      {result.absentees.length > 0 && (
        <section className="card mt-4 overflow-hidden">
          <h3 className="border-b border-slate-100 px-4 py-3">Let families know</h3>
          <ul className="divide-y divide-slate-100">
            {result.absentees.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink-800">{a.name}</span>
                  <span className="block text-[0.8125rem] text-slate-500">{a.guardianName ?? 'No guardian on file'}</span>
                </span>
                {a.guardianPhone && (
                  <a
                    className="btn btn-line btn-xs"
                    target="_blank"
                    rel="noreferrer"
                    href={whatsappLink(a.guardianPhone, `Dear ${a.guardianName ?? 'Parent'}, ${a.name} of class ${data.section.label} is marked absent today (${dateLong(data.date)}). Please let the class teacher know the reason. — ${schoolName}`)}
                  >
                    <Icon name="message" size={14} /> WhatsApp
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
