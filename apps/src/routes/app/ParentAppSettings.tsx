// Settings → Parent app: whether parents can sign in at all, and which parts of their
// child's record they see. Beside the switches, a phone showing exactly what a parent
// would see with them set this way, so nobody has to guess what a switch does.
//
// The server enforces every switch — a section that is off is refused by the parent API,
// not just hidden by the parent app — so this screen is the whole story.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { useSchool } from '../../lib/school';
import { useToast } from '../../lib/toast';
import { FormError } from '../../components/FormError';
import { Icon } from '../../components/Icon';
import { Card, CheckRow, ConfirmDialog, ErrorState, Loading, Notice, Seg, Spinner } from '../../components/ui';

type Settings = {
  enabled: boolean;
  attendance: 'off' | 'summary' | 'daily';
  fees: boolean;
  receipts: 'off' | 'list' | 'full';
  studentDetails: boolean;
  classTeacher: boolean;
};
type PortalData = {
  settings: Settings & { updatedByName: string | null; updatedAt: string | null };
  counts: { invited: number; active: number; revoked: number };
};

const pick = (s: PortalData['settings']): Settings => ({
  enabled: s.enabled,
  attendance: s.attendance,
  fees: s.fees,
  receipts: s.receipts,
  studentDetails: s.studentDetails,
  classTeacher: s.classTeacher,
});

export function ParentAppSettings() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['parent-portal'], queryFn: () => api.get<PortalData>('/school/parent-portal') });
  const [form, setForm] = useState<Settings | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  if (q.data && !form) setForm(pick(q.data.settings));

  const save = useMutation({
    mutationFn: (next: Settings) => api.put<PortalData>('/school/parent-portal', next),
    onSuccess: (r) => {
      queryClient.setQueryData(['parent-portal'], (old: PortalData | undefined) => (old ? { ...old, settings: r.settings } : old));
      queryClient.invalidateQueries({ queryKey: ['parent-access'] });
      setForm(pick(r.settings));
      setConfirmOff(false);
      toast('Parent app settings saved');
    },
  });

  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!form || !q.data) return <Loading rows={5} />;

  const saved = pick(q.data.settings);
  const dirty = JSON.stringify(saved) !== JSON.stringify(form);
  const { counts } = q.data;
  const turningOff = saved.enabled && !form.enabled;
  const submit = () => (turningOff && counts.active > 0 ? setConfirmOff(true) : save.mutate(form));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <FormError message={save.error ? errorMessage(save.error) : null} />

        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 max-w-md">
              <h2 className="text-[1.0625rem]">Parent app</h2>
              <p className="mt-1 text-[0.875rem] leading-snug text-slate-500">
                Parents sign in with their phone number to see their own children only. You invite each one from the student’s record, and they confirm the child’s
                date of birth to get in.
              </p>
            </div>
            <Switch checked={form.enabled} onChange={(enabled) => setForm({ ...form, enabled })} label="Parent app" />
          </div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-100 pt-4 text-[0.875rem]">
            <Count n={counts.active} label="using it" tone="text-lagoon-700" />
            <Count n={counts.invited} label="invited, not yet in" tone="text-marigold-700" />
            {counts.revoked > 0 && <Count n={counts.revoked} label="removed" tone="text-slate-500" />}
          </div>
        </Card>

        <fieldset disabled={!form.enabled} className={`space-y-5 ${form.enabled ? '' : 'opacity-60'}`}>
          <legend className="sr-only">What parents can see</legend>
          <Card title="What parents can see">
            <div className="space-y-5">
              <Choice
                icon="attendance"
                title="Attendance"
                hint={
                  form.attendance === 'daily'
                    ? 'A calendar with each day marked present, late or absent.'
                    : form.attendance === 'summary'
                      ? 'Only today’s mark and the month’s percentage.'
                      : 'Parents see nothing about attendance.'
                }
              >
                <Seg
                  label="Attendance"
                  value={form.attendance}
                  onChange={(attendance) => setForm({ ...form, attendance })}
                  options={[
                    { value: 'off', label: 'Off' },
                    { value: 'summary', label: 'Summary' },
                    { value: 'daily', label: 'Day by day' },
                  ]}
                />
              </Choice>

              <Choice
                icon="receipt"
                title="Receipts"
                hint={
                  form.receipts === 'full'
                    ? 'A list of receipts, each one opening to view or print.'
                    : form.receipts === 'list'
                      ? 'A list of receipts with amounts and dates, without opening them.'
                      : 'Parents see no receipts.'
                }
              >
                <Seg
                  label="Receipts"
                  value={form.receipts}
                  onChange={(receipts) => setForm({ ...form, receipts })}
                  options={[
                    { value: 'off', label: 'Off' },
                    { value: 'list', label: 'List only' },
                    { value: 'full', label: 'View and print' },
                  ]}
                />
              </Choice>

              <div className="grid gap-2.5 sm:grid-cols-2">
                <CheckRow checked={form.fees} onChange={(fees) => setForm({ ...form, fees })} label="Fees due" hint="What is due and when, what is paid, and what is left — including late fees." />
                <CheckRow checked={form.classTeacher} onChange={(classTeacher) => setForm({ ...form, classTeacher })} label="Class teacher’s name" hint="The name only. Never a phone number or email." />
                <CheckRow
                  checked={form.studentDetails}
                  onChange={(studentDetails) => setForm({ ...form, studentDetails })}
                  label="Student details"
                  hint="Date of birth, blood group and address, as the school has them."
                />
              </div>
            </div>
          </Card>

          <Notice tone="info" icon="shield">
            Parents never see notes, social category, consent records, who took a payment, other students, or anyone’s contact details. Switching a section off
            takes effect for every parent on their next tap.
          </Notice>
        </fieldset>

        <div className="flex flex-wrap items-center justify-end gap-3">
          {q.data.settings.updatedByName && q.data.settings.updatedAt && !dirty && (
            <p className="mr-auto text-[0.8125rem] text-slate-500">
              Last changed by {q.data.settings.updatedByName}, {timeAgo(q.data.settings.updatedAt)}
            </p>
          )}
          {dirty && (
            <button type="button" className="btn btn-line btn-sm" onClick={() => setForm(saved)}>
              Undo changes
            </button>
          )}
          <button type="submit" className="btn btn-ink" disabled={!dirty || save.isPending}>
            {save.isPending && <Spinner />}
            Save
          </button>
        </div>
      </form>

      <aside className="lg:sticky lg:top-6" aria-label="Preview of the parent app">
        <p className="mb-2 text-[0.8125rem] font-semibold text-slate-500">What a parent sees</p>
        <PhonePreview s={form} />
      </aside>

      <ConfirmDialog
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        title="Turn the parent app off?"
        confirmLabel="Turn it off"
        danger
        pending={save.isPending}
        onConfirm={() => save.mutate(form)}
      >
        {counts.active} {counts.active === 1 ? 'parent is' : 'parents are'} using it. They will be shut out at once. Nobody’s access is removed: turn it back
        on and they can sign in again.
      </ConfirmDialog>
    </div>
  );
}

function Count({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <p>
      <span className={`num font-bold ${tone}`}>{n}</span> <span className="text-slate-600">{label}</span>
    </p>
  );
}

function Choice({ icon, title, hint, children }: { icon: 'attendance' | 'receipt'; title: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-lagoon-50 text-lagoon-600">
          <Icon name={icon} size={17} />
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-ink-800">{title}</p>
          <p className="text-[0.8125rem] leading-snug text-slate-500">{hint}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-11 shrink-0 items-center gap-2.5 rounded-full py-1 pl-1 pr-4 text-[0.875rem] font-bold ring-1 transition-colors ${
        checked ? 'bg-lagoon-600 text-white ring-lagoon-600' : 'bg-white text-slate-600 ring-slate-300'
      }`}
    >
      <span className={`grid size-9 place-items-center rounded-full transition-colors ${checked ? 'bg-white text-lagoon-600' : 'bg-slate-100 text-slate-400'}`}>
        <Icon name={checked ? 'check' : 'x'} size={16} />
      </span>
      {checked ? 'On' : 'Off'}
    </button>
  );
}

/** A phone drawn with the sections as set — sample data, nobody's real record. */
function PhonePreview({ s }: { s: Settings }) {
  const school = useSchool();
  return (
    <div className="mx-auto w-full max-w-[18rem] rounded-[2.2rem] bg-ink-800 p-2.5 shadow-lift">
      <div className="overflow-hidden rounded-[1.7rem] bg-[#f6f4ef]">
        <div className="bg-ink-800 px-4 pb-4 pt-5 text-white">
          <p className="truncate text-[0.6875rem] font-semibold text-slate-300">{school.school.name}</p>
          <p className="mt-0.5 text-[1.0625rem] font-bold" style={{ fontStretch: '112%' }}>
            Aarav Sharma
          </p>
          <p className="text-[0.75rem] text-slate-300">Class 6-B{s.classTeacher ? ' · Ms. Kavita Iyer' : ''}</p>
        </div>
        {!s.enabled ? (
          <div className="px-5 py-12 text-center">
            <span className="mx-auto grid size-10 place-items-center rounded-2xl bg-slate-200 text-slate-500">
              <Icon name="lock" size={18} />
            </span>
            <p className="mt-3 text-[0.8125rem] font-semibold text-ink-800">The parent app is off</p>
            <p className="mt-1 text-[0.75rem] text-slate-500">Parents cannot sign in.</p>
          </div>
        ) : (
          <div className="space-y-2.5 p-3">
            {s.attendance !== 'off' && (
              <PreviewTile icon="attendance" title="Attendance">
                <p className="text-[0.75rem] text-slate-600">
                  Today: <b className="text-lagoon-700">Present</b> · this month <b className="text-ink-800">96%</b>
                </p>
                {s.attendance === 'daily' && (
                  <div className="mt-2 grid grid-cols-7 gap-1" aria-hidden="true">
                    {'PPPLPPAPPPPPPP'.split('').map((m, i) => (
                      <span key={i} className={`h-3.5 rounded-[4px] ${m === 'P' ? 'bg-lagoon-500' : m === 'L' ? 'bg-marigold-400' : 'bg-coral-500'}`} />
                    ))}
                  </div>
                )}
              </PreviewTile>
            )}
            {s.fees && (
              <PreviewTile icon="fees" title="Fees">
                <p className="text-[0.75rem] text-slate-600">
                  <b className="text-coral-700">₹6,500</b> due by 10 Oct
                </p>
              </PreviewTile>
            )}
            {s.receipts !== 'off' && (
              <PreviewTile icon="receipt" title="Receipts">
                <p className="flex items-center justify-between text-[0.75rem] text-slate-600">
                  <span>RCT/2026-27/00042 · ₹6,500</span>
                  {s.receipts === 'full' && <span className="font-semibold text-lagoon-700">Open</span>}
                </p>
              </PreviewTile>
            )}
            {s.studentDetails && (
              <PreviewTile icon="user" title="Details">
                <p className="text-[0.75rem] text-slate-600">Born 14 Jan 2015 · B+</p>
              </PreviewTile>
            )}
            {s.attendance === 'off' && !s.fees && s.receipts === 'off' && !s.studentDetails && (
              <p className="px-2 py-8 text-center text-[0.75rem] text-slate-500">Everything is switched off. Parents see only the child’s name and class.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewTile({ icon, title, children }: { icon: 'attendance' | 'fees' | 'receipt' | 'user'; title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-3 shadow-soft ring-1 ring-slate-200/70">
      <p className="mb-1 flex items-center gap-1.5 text-[0.75rem] font-bold text-ink-800">
        <Icon name={icon} size={13} className="text-lagoon-600" /> {title}
      </p>
      {children}
    </div>
  );
}
