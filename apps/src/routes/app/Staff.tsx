// Staff: everyone who works at the school, and who among them can sign in to Acadlas.
//
// Giving someone a login creates an invitation link. It is emailed when email is set up,
// but the link is also right here to copy or send on WhatsApp — which is how most school
// staff would rather get it anyway.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';
import { date, phone, plural, whatsappLink } from '../../lib/format';
import { useSchool } from '../../lib/school';
import { Field } from '../../components/Field';
import { FormError } from '../../components/FormError';
import { Icon } from '../../components/Icon';
import { Avatar, CheckRow, ConfirmDialog, Dialog, ErrorState, Loading, Page, Seg, Spinner } from '../../components/ui';
import { useToast } from '../../lib/toast';

type StaffMember = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  designation: string | null;
  employeeCode: string | null;
  joinedOn: string | null;
  status: 'active' | 'left';
  roles: string[];
  roleLabel: string | null;
  login: 'active' | 'invited' | 'none';
  isOwner: boolean;
  isYou: boolean;
  invite: { id: string; expiresAt: string; url: string } | null;
  classTeacherOf: number;
};
type StaffData = { canManage: boolean; roles: { id: string; label: string }[]; staff: StaffMember[] };

const roleNotes: Record<string, string> = {
  admin: 'Everything, including settings, fees and staff.',
  accountant: 'Fees: plans, collection, concessions and reports.',
  teacher: 'Registers and records for their own sections.',
  office: 'Admissions, student records, registers and collecting fees.',
};

export function Staff() {
  const school = useSchool();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ['staff'], queryFn: () => api.get<StaffData>('/school/staff') });
  const [dialog, setDialogState] = useState<null | 'add' | { edit: StaffMember } | { invite: StaffMember } | { link: { name: string; url: string; phone: string | null } } | { leave: StaffMember }>(() => (params.get('add') ? 'add' : null));
  const setDialog = (next: typeof dialog) => {
    if (params.get('add')) setParams({}, { replace: true });
    setDialogState(next);
  };
  const [show, setShow] = useState<'active' | 'left'>('active');

  useEffect(() => {
    if (q.data && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'center' });
  }, [q.data]);

  const d = q.data;
  const list = (d?.staff ?? []).filter((s) => s.status === show);
  const leftCount = (d?.staff ?? []).filter((s) => s.status === 'left').length;

  return (
    <Page
      title="Staff"
      lead={d ? `${plural(d.staff.filter((s) => s.status === 'active').length, 'person', 'people')} at ${school.school.name}, ${d.staff.filter((s) => s.login === 'active').length} signing in to Acadlas.` : ' '}
      actions={d?.canManage && <button type="button" className="btn btn-sun btn-sm" onClick={() => setDialog('add')}><Icon name="plus" size={16} /> Add staff</button>}
      under={leftCount > 0 && <Seg label="Show" value={show} onChange={setShow} options={[{ value: 'active', label: 'Working here' }, { value: 'left', label: `Left (${leftCount})` }]} />}
    >
      {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
      {q.isPending && <Loading rows={6} />}
      {d && (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((s) => (
            <li key={s.id} id={s.id} className="card flex flex-col p-4">
              <div className="flex items-start gap-3">
                <Avatar name={s.name} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 font-semibold text-ink-800">
                    {s.name}
                    {s.isYou && <span className="tag tag-slate">You</span>}
                  </p>
                  <p className="truncate text-[0.8125rem] text-slate-500">{[s.designation, s.employeeCode].filter(Boolean).join(', ') || 'No designation'}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {s.roleLabel && <span className={`tag ${s.isOwner ? 'tag-ink' : 'tag-lagoon'}`}>{s.roleLabel}</span>}
                    {s.classTeacherOf > 0 && <span className="tag tag-sun">Class teacher{s.classTeacherOf > 1 ? ` ×${s.classTeacherOf}` : ''}</span>}
                  </div>
                </div>
                {d.canManage && !s.isOwner && s.status === 'active' && (
                  <button type="button" className="btn btn-quiet btn-icon" aria-label={`Edit ${s.name}`} onClick={() => setDialog({ edit: s })}><Icon name="edit" size={15} /></button>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-slate-600">
                {s.phone && <a href={`tel:+91${s.phone}`} className="num text-slate-600 no-underline hover:underline">{phone(s.phone)}</a>}
                {s.email && <span className="truncate">{s.email}</span>}
                {s.joinedOn && <span>Joined {date(s.joinedOn)}</span>}
              </div>

              {s.status === 'active' && (
                <div className="mt-auto pt-3">
                  {s.login === 'active' && <p className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-lagoon-700"><Icon name="check" size={14} /> Signs in to Acadlas</p>}
                  {s.login === 'invited' && s.invite && (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-marigold-50 p-2.5 ring-1 ring-marigold-100">
                      <span className="flex-1 text-[0.8125rem] text-marigold-700">Invitation sent, until {date(s.invite.expiresAt.slice(0, 10))}</span>
                      <button type="button" className="btn btn-line btn-xs" onClick={() => setDialog({ link: { name: s.name, url: s.invite!.url, phone: s.phone } })}>Share link</button>
                    </div>
                  )}
                  {s.login === 'invited' && !s.invite && <p className="text-[0.8125rem] text-slate-500">Invitation sent</p>}
                  {s.login === 'none' && d.canManage && (
                    <button type="button" className="btn btn-line btn-xs" onClick={() => setDialog({ invite: s })}><Icon name="link" size={13} /> Give a login</button>
                  )}
                </div>
              )}
              {s.status === 'left' && d.canManage && <RejoinButton id={s.id} />}
            </li>
          ))}
        </ul>
      )}

      {dialog === 'add' && d?.canManage && <AddStaffDialog roles={d.roles} onClose={() => setDialog(null)} onInvited={(link) => setDialog({ link })} />}
      {dialog && typeof dialog === 'object' && 'edit' in dialog && d && <EditStaffDialog member={dialog.edit} roles={d.roles} onClose={() => setDialog(null)} onLeave={() => setDialog({ leave: dialog.edit })} />}
      {dialog && typeof dialog === 'object' && 'invite' in dialog && d && <InviteDialog member={dialog.invite} roles={d.roles} onClose={() => setDialog(null)} onInvited={(link) => setDialog({ link })} />}
      {dialog && typeof dialog === 'object' && 'link' in dialog && <LinkDialog {...dialog.link} schoolName={school.school.name} onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === 'object' && 'leave' in dialog && <LeaveDialog member={dialog.leave} onClose={() => setDialog(null)} />}
    </Page>
  );
}

function RoleChooser({ roles, value, onChange }: { roles: { id: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {roles.map((r) => (
        <label key={r.id} className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 ${value === r.id ? 'border-ink-800 bg-slate-50' : 'border-slate-200 hover:border-slate-300'}`}>
          <input type="radio" name="role" className="check mt-0.5" checked={value === r.id} onChange={() => onChange(r.id)} />
          <span>
            <span className="block text-[0.9375rem] font-semibold text-ink-800">{r.label}</span>
            <span className="block text-[0.75rem] leading-snug text-slate-500">{roleNotes[r.id]}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function useStaffMutation<T>(fn: () => Promise<T>, onDone: (r: T) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      queryClient.invalidateQueries({ queryKey: ['structure'] });
      onDone(r);
    },
  });
}

function AddStaffDialog({ roles, onClose, onInvited }: { roles: { id: string; label: string }[]; onClose: () => void; onInvited: (l: { name: string; url: string; phone: string | null }) => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', phone: '', email: '', designation: '', employeeCode: '', joinedOn: '' });
  const [invite, setInvite] = useState(true);
  const [role, setRole] = useState('teacher');
  const save = useStaffMutation(
    () => api.post<{ staff: { name: string; phone: string | null }; invite: { url: string } | null }>('/school/staff', { ...form, joinedOn: form.joinedOn || null, invite, role: invite ? role : null }),
    (r) => {
      if (r.invite) onInvited({ name: r.staff.name, url: r.invite.url, phone: r.staff.phone });
      else {
        toast(`Added ${r.staff.name}`);
        onClose();
      }
    },
  );
  const fields = save.error && 'fields' in save.error ? (save.error as { fields: Record<string, string> }).fields : {};
  return (
    <Dialog open onClose={onClose} title="Add a staff member" wide footer={<><button type="button" className="btn btn-line btn-sm" onClick={onClose}>Cancel</button><button type="button" className="btn btn-ink btn-sm" disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending && <Spinner />} {invite ? 'Add and create invitation' : 'Add to staff list'}</button></>}>
      <div className="space-y-5">
        <FormError message={save.error ? errorMessage(save.error) : null} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="s-name" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          <Field id="s-desig" label="Designation" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} placeholder="TGT English, Accountant, Driver" />
          <Field id="s-phone" label="Mobile number" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={fields.phone} />
          <Field id="s-email" label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={fields.email} hint={invite ? 'They will sign in with this.' : undefined} />
          <Field id="s-code" label="Employee code" value={form.employeeCode} onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} placeholder="Optional" />
          <Field id="s-joined" label="Joined on" type="date" value={form.joinedOn} onChange={(e) => setForm({ ...form, joinedOn: e.target.value })} />
        </div>
        <CheckRow checked={invite} onChange={setInvite} label="Give them an Acadlas login" hint="Leave this off for staff who do not need to sign in." />
        {invite && <RoleChooser roles={roles} value={role} onChange={setRole} />}
      </div>
    </Dialog>
  );
}

function EditStaffDialog({ member, roles, onClose, onLeave }: { member: StaffMember; roles: { id: string; label: string }[]; onClose: () => void; onLeave: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: member.name, phone: member.phone ?? '', email: member.email ?? '', designation: member.designation ?? '', employeeCode: member.employeeCode ?? '', joinedOn: member.joinedOn ?? '' });
  const [role, setRole] = useState(member.roles[0] ?? '');
  const save = useStaffMutation(
    async () => {
      await api.patch(`/school/staff/${member.id}`, { ...form, joinedOn: form.joinedOn || null, ...(member.login === 'active' ? { email: undefined } : {}) });
      if (member.login !== 'none' && role && role !== member.roles[0]) await api.post(`/school/staff/${member.id}/role`, { role });
    },
    () => {
      toast(`Saved ${form.name}`);
      onClose();
    },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Edit ${member.name}`}
      wide
      footer={
        <>
          {!member.isYou && <button type="button" className="btn btn-quiet btn-sm mr-auto text-coral-700" onClick={onLeave}>Mark as left</button>}
          <button type="button" className="btn btn-line btn-sm" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-ink btn-sm" disabled={save.isPending || !form.name.trim()} onClick={() => save.mutate()}>{save.isPending && <Spinner />} Save</button>
        </>
      }
    >
      <div className="space-y-5">
        <FormError message={save.error ? errorMessage(save.error) : null} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="e-name" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Field id="e-desig" label="Designation" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
          <Field id="e-phone" label="Mobile number" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Field id="e-email" label="Email" type="email" value={form.email} disabled={member.login === 'active'} onChange={(e) => setForm({ ...form, email: e.target.value })} hint={member.login === 'active' ? 'Used to sign in, so it cannot be changed here.' : undefined} />
          <Field id="e-code" label="Employee code" value={form.employeeCode} onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} />
          <Field id="e-joined" label="Joined on" type="date" value={form.joinedOn} onChange={(e) => setForm({ ...form, joinedOn: e.target.value })} />
        </div>
        {member.login !== 'none' && !member.isYou && (
          <div>
            <p className="input-label">What they can do in Acadlas</p>
            <RoleChooser roles={roles} value={role} onChange={setRole} />
          </div>
        )}
      </div>
    </Dialog>
  );
}

function InviteDialog({ member, roles, onClose, onInvited }: { member: StaffMember; roles: { id: string; label: string }[]; onClose: () => void; onInvited: (l: { name: string; url: string; phone: string | null }) => void }) {
  const [email, setEmail] = useState(member.email ?? '');
  const [role, setRole] = useState('teacher');
  const save = useStaffMutation(() => api.post<{ invite: { url: string } }>(`/school/staff/${member.id}/invite`, { role, email }), (r) => onInvited({ name: member.name, url: r.invite.url, phone: member.phone }));
  return (
    <Dialog open onClose={onClose} title={`Give ${member.name} a login`} wide footer={<><button type="button" className="btn btn-line btn-sm" onClick={onClose}>Cancel</button><button type="button" className="btn btn-ink btn-sm" disabled={!email.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending && <Spinner />} Create invitation</button></>}>
      <div className="space-y-5">
        <FormError message={save.error ? errorMessage(save.error) : null} />
        <Field id="i-email" label="Their email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} hint="They will sign in with this." />
        <RoleChooser roles={roles} value={role} onChange={setRole} />
      </div>
    </Dialog>
  );
}

function LinkDialog({ name, url, phone: tel, schoolName, onClose }: { name: string; url: string; phone: string | null; schoolName: string; onClose: () => void }) {
  const toast = useToast();
  const message = `Hello ${name}, you have been invited to ${schoolName} on Acadlas. Open this link to create your login: ${url}`;
  return (
    <Dialog open onClose={onClose} title={`Send ${name} their invitation`} lead="It was emailed if email is set up. You can also send the link yourself — it works once, for seven days.">
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">
          <code className="min-w-0 flex-1 truncate px-2 text-[0.8125rem] text-ink-800">{url}</code>
          <button
            type="button"
            className="btn btn-ink btn-xs"
            onClick={() => navigator.clipboard.writeText(url).then(() => toast('Link copied'), () => toast('Could not copy — select the link instead', 'bad'))}
          >
            <Icon name="copy" size={13} /> Copy
          </button>
        </div>
        {tel ? (
          <a href={whatsappLink(tel, message)} target="_blank" rel="noreferrer" className="btn btn-lagoon w-full">
            <Icon name="message" size={16} /> Send on WhatsApp to {phone(tel)}
          </a>
        ) : (
          <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className="btn btn-lagoon w-full">
            <Icon name="message" size={16} /> Share on WhatsApp
          </a>
        )}
        <button type="button" className="btn btn-line w-full" onClick={onClose}>Done</button>
      </div>
    </Dialog>
  );
}

function LeaveDialog({ member, onClose }: { member: StaffMember; onClose: () => void }) {
  const toast = useToast();
  const save = useStaffMutation(() => api.post(`/school/staff/${member.id}/leave`), () => {
    toast(`${member.name} marked as left`);
    onClose();
  });
  return (
    <ConfirmDialog open onClose={onClose} title={`Mark ${member.name} as having left?`} confirmLabel="Mark as left" danger pending={save.isPending} onConfirm={() => save.mutate()}>
      {member.login !== 'none' ? 'Their Acadlas login stops working for this school straight away. ' : ''}
      {member.classTeacherOf > 0 ? `They are class teacher of ${plural(member.classTeacherOf, 'section')}, which will need someone new. ` : ''}
      Everything they recorded stays on file.
      {save.error && <span className="mt-2 block text-coral-700">{errorMessage(save.error)}</span>}
    </ConfirmDialog>
  );
}

function RejoinButton({ id }: { id: string }) {
  const toast = useToast();
  const save = useStaffMutation(() => api.post(`/school/staff/${id}/rejoin`), () => toast('Back on the staff list'));
  return <button type="button" className="btn btn-line btn-xs mt-3 self-start" onClick={() => save.mutate()}>Rejoined</button>;
}

