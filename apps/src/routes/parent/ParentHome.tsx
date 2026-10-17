// The parent app's first screen. With one child there is nothing to choose, so it goes
// straight to them; with more, one card each with what a parent checks first — was my
// child in school today, and is anything due.
import { Link, Navigate } from 'react-router-dom';
import { date, money } from '../../lib/format';
import { useChild, useParentMe } from '../../lib/parent';
import type { ParentMe } from '../../lib/parent';
import { Icon } from '../../components/Icon';
import { Avatar, EmptyState } from '../../components/ui';
import { TodayPill } from './parts';

export function ParentHome() {
  const me = useParentMe();
  const kids = me.data?.children ?? [];
  if (kids.length === 1) return <Navigate to={`/parent/child/${kids[0].id}`} replace />;

  return (
    <div className="flex flex-1 flex-col">
      <div data-surface="dark" className="wrap max-w-3xl pb-6 pt-7">
        <h1 className="text-[1.6rem]">Hello{me.data?.parent.name ? `, ${me.data.parent.name.split(' ')[0]}` : ''}</h1>
        <p className="mt-1 text-[0.9375rem] text-slate-300">Your children at a glance.</p>
      </div>
      <div className="sheet-paper flex-1 pb-16">
        <div className="wrap max-w-3xl space-y-3 pt-5">
          {kids.length === 0 ? (
            <div className="card">
              <EmptyState icon="students" title="No children to show">
                None of your children are studying at a school that has the parent app on. If that seems wrong, ask the school.
              </EmptyState>
            </div>
          ) : (
            kids.map((k) => <ChildCard key={k.id} kid={k} />)
          )}
        </div>
      </div>
    </div>
  );
}

function ChildCard({ kid }: { kid: ParentMe['children'][number] }) {
  const q = useChild(kid.id);
  const d = q.data;
  return (
    <Link to={`/parent/child/${kid.id}`} className="card block p-4 no-underline transition-shadow hover:shadow-lift sm:p-5">
      <div className="flex items-center gap-3">
        <Avatar name={kid.name} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[1.0625rem] font-bold text-ink-800" style={{ fontStretch: '108%' }}>
            {kid.name}
          </p>
          <p className="truncate text-[0.8125rem] text-slate-500">
            {kid.classLabel ? `Class ${kid.classLabel} · ` : ''}
            {kid.schoolName}
          </p>
        </div>
        <Icon name="chevron-right" size={18} className="shrink-0 text-slate-400" />
      </div>
      {d && (d.attendance || d.fees) && (
        <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          {d.attendance && <TodayPill today={d.attendance.today} />}
          {d.fees && d.fees.due > 0 && (
            <span className={`tag ${d.fees.overdue > 0 ? 'tag-coral' : 'tag-slate'}`}>
              {d.fees.overdue > 0 ? `${money(d.fees.overdue)} overdue` : `${money(d.fees.due)} due${d.fees.nextDue ? ` by ${date(d.fees.nextDue.dueOn)}` : ''}`}
            </span>
          )}
          {d.fees && d.fees.due === 0 && <span className="tag tag-lagoon">Fees paid up</span>}
        </div>
      )}
    </Link>
  );
}
