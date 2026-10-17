// Small pieces the parent screens share.
import { markLabel } from '../../lib/parent';
import type { ChildSummary } from '../../lib/parent';
import { Icon } from '../../components/Icon';

/** Today, in one pill: the first thing a parent looks for. */
export function TodayPill({ today, large }: { today: NonNullable<ChildSummary['attendance']>['today']; large?: boolean }) {
  const size = large ? 'px-3 py-1.5 text-[0.875rem]' : '';
  if (today.holiday) return <span className={`tag tag-slate ${size}`}>Holiday · {today.holiday}</span>;
  if (!today.workingDay) return <span className={`tag tag-slate ${size}`}>No school today</span>;
  if (!today.mark) {
    return (
      <span className={`tag tag-slate ${size}`}>
        <Icon name="clock" size={large ? 14 : 12} /> Today not marked yet
      </span>
    );
  }
  const tone = today.mark === 'P' ? 'tag-lagoon' : today.mark === 'L' ? 'tag-sun' : 'tag-coral';
  return (
    <span className={`tag ${tone} ${size}`}>
      <Icon name={today.mark === 'A' ? 'alert' : 'check'} size={large ? 14 : 12} /> {markLabel[today.mark]} today
    </span>
  );
}
