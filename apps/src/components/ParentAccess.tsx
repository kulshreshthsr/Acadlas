// The parent app, from the school's side of one student: each guardian's way in, and the
// buttons to invite, re-send, reset or remove it. Lives inside the student's Family card.
//
// The link itself is shown once, right after it is made, to copy or send on WhatsApp — the
// school never sees it again (only a hash is kept), so "send again" always makes a new one.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { date, phone, timeAgo, whatsappLink } from '../lib/format';
import type { Issued, ParentAccessData } from '../lib/parent-access';
import { useSchool } from '../lib/school';
import { useToast } from '../lib/toast';
import { Icon } from './Icon';
import { ConfirmDialog, Dialog, Spinner } from './ui';

/** One line on top of the Family card when the app is off, so staff know where to turn it on. */
export function ParentAppOffNotice({ data }: { data: ParentAccessData | undefined }) {
  const school = useSchool();
  if (!data || data.portalEnabled) return null;
  return (
    <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-[0.8125rem] text-slate-600 sm:px-5">
      <Icon name="phone" size={14} className="shrink-0 text-slate-400" />
      <span className="flex-1">The parent app is off for this school.</span>
      {school.can('school.manage') && (
        <Link to="/app/settings?tab=parents" className="font-semibold">
          Turn it on
        </Link>
      )}
    </div>
  );
}

export function ParentAccessRow({
  studentId,
  childName,
  guardianId,
  data,
}: {
  studentId: string;
  childName: string;
  guardianId: string;
  data: ParentAccessData | undefined;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [issued, setIssued] = useState<Issued | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const g = data?.guardians.find((x) => x.id === guardianId);

  const invite = useMutation({
    mutationFn: () => api.post<Issued>(`/school/guardians/${guardianId}/parent-invite`, {}),
    onSuccess: (r) => {
      setIssued(r);
      queryClient.invalidateQueries({ queryKey: ['parent-access', studentId] });
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const remove = useMutation({
    mutationFn: () => api.post(`/school/guardians/${guardianId}/parent-revoke`, {}),
    onSuccess: () => {
      setConfirmRemove(false);
      queryClient.invalidateQueries({ queryKey: ['parent-access', studentId] });
      toast('Parent app access removed');
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });

  if (!data || !g || !data.portalEnabled) return null;
  const a = g.access;

  // Why the invite button cannot work yet, said before anyone presses it.
  const blocker = !g.phone ? 'Add a mobile number to invite them.' : !data.hasDateOfBirth ? `Add ${childName}'s date of birth to invite them.` : null;

  let line: ReactNode;
  let tone = 'text-slate-500';
  if (!a) {
    line = 'Not using the parent app';
  } else if (a.status === 'active') {
    tone = 'text-lagoon-700';
    line = a.lastSeenAt ? `Using the parent app · seen ${timeAgo(a.lastSeenAt)}` : 'Using the parent app';
  } else if (a.status === 'invited') {
    tone = a.linkExpiresAt ? 'text-marigold-700' : 'text-slate-500';
    line = a.linkExpiresAt ? `Invited · link works until ${date(a.linkExpiresAt.slice(0, 10))}` : 'Invitation expired';
  } else {
    line = `Access removed${a.revokedAt ? ` ${date(a.revokedAt.slice(0, 10))}` : ''}`;
  }
  const resetLink = a?.status === 'active' && Boolean(a.linkExpiresAt);

  return (
    <div className="mt-2.5 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100 sm:ml-12">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className={`flex min-w-0 flex-1 items-center gap-1.5 text-[0.8125rem] font-semibold ${tone}`}>
          <Icon name={a?.status === 'active' ? 'check' : 'phone'} size={14} className="shrink-0" />
          <span className="min-w-0">{line}</span>
          {resetLink && <span className="tag tag-sun">Password link sent</span>}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {(!a || a.status !== 'active') && (
            <button type="button" className="btn btn-line btn-xs" disabled={Boolean(blocker) || invite.isPending} onClick={() => invite.mutate()} title={blocker ?? undefined}>
              {invite.isPending ? <Spinner /> : <Icon name="link" size={13} />}
              {!a ? 'Invite' : a.status === 'revoked' ? 'Invite again' : 'New link'}
            </button>
          )}
          {a?.status === 'active' && (
            <button type="button" className="btn btn-line btn-xs" disabled={invite.isPending} onClick={() => invite.mutate()}>
              {invite.isPending ? <Spinner /> : <Icon name="lock" size={13} />}
              New password link
            </button>
          )}
          {a && a.status !== 'revoked' && (
            <button type="button" className="btn btn-quiet btn-xs text-coral-700" onClick={() => setConfirmRemove(true)}>
              Remove
            </button>
          )}
        </div>
      </div>
      {blocker && !a && <p className="mt-1 text-[0.75rem] text-slate-500">{blocker}</p>}

      {issued && <ParentLinkDialog issued={issued} childName={childName} onClose={() => setIssued(null)} />}
      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title={`Remove ${g.name}'s parent app access?`}
        confirmLabel="Remove access"
        danger
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      >
        They are signed out at once and their link stops working. You can invite them again later.
      </ConfirmDialog>
    </div>
  );
}

function ParentLinkDialog({ issued, childName, onClose }: { issued: Issued; childName: string; onClose: () => void }) {
  const toast = useToast();
  const school = useSchool();
  const message = issued.reset
    ? `Hello ${issued.guardianName}, here is your link to set a new password for the ${school.school.name} parent app. Open it and confirm ${childName}'s date of birth: ${issued.url}\n\nIt works once, for seven days. Do not share it.`
    : `Hello ${issued.guardianName}, ${school.school.name} has invited you to its parent app on Acadlas, to see ${childName}'s attendance and fees. Open this link and confirm ${childName}'s date of birth to set your password: ${issued.url}\n\nIt works once, for seven days. Do not share it.`;
  return (
    <Dialog
      open
      onClose={onClose}
      title={issued.reset ? `New password link for ${issued.guardianName}` : `Invite ${issued.guardianName}`}
      lead="Send it only to this parent. It works once, for seven days, and asks for the child's date of birth."
    >
      <div className="space-y-4">
        <a href={whatsappLink(issued.phone, message)} target="_blank" rel="noreferrer" className="btn btn-lagoon w-full">
          <Icon name="message" size={16} /> Send on WhatsApp to {phone(issued.phone)}
        </a>
        <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">
          <code className="min-w-0 flex-1 truncate px-2 text-[0.8125rem] text-ink-800">{issued.url}</code>
          <button
            type="button"
            className="btn btn-ink btn-xs"
            onClick={() => navigator.clipboard.writeText(issued.url).then(() => toast('Link copied'), () => toast('Could not copy — select the link instead', 'bad'))}
          >
            <Icon name="copy" size={13} /> Copy
          </button>
        </div>
        <p className="text-[0.8125rem] leading-snug text-slate-500">
          This is the only time the link is shown. If it is lost, make a new one — the old one stops working.
        </p>
        <button type="button" className="btn btn-line w-full" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
