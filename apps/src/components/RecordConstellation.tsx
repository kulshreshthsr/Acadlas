// The record constellation, carried over from the website's hero.
//
// On the website it shows one student with their records hanging off them. Here it
// shows the school being created, with the four kinds of record a school keeps —
// and the centre card takes the name as it is typed, so the second step of signup
// ends with the thing you just named appearing in front of you.
//
// Geometry lives in one 400x360 coordinate space shared by the SVG links and the
// HTML cards layered over them, so a link always meets the card it serves. Each
// link ends underneath its card, which covers the join.
import { Icon } from './Icon';
import type { IconName } from '../lib/icons';

type RecordConstellationProps = {
  /** The school's name as typed so far. Empty shows the unnamed state. */
  schoolName?: string;
  /** The school's short name, shown under the name once there is one. */
  shortName?: string;
};

type Satellite = {
  key: string;
  icon: IconName;
  label: string;
  value: string;
  x: number;
  y: number;
  drift: string;
  dur: string;
  delay: number;
};

const satellites: Satellite[] = [
  { key: 'students', icon: 'students', label: 'Students', value: 'Roll, class, guardian', x: 16, y: 20, drift: '-8px', dur: '7.5s', delay: 620 },
  { key: 'staff', icon: 'staff', label: 'Staff', value: 'Teachers and office', x: 74, y: 11, drift: '7px', dur: '8.5s', delay: 700 },
  { key: 'attendance', icon: 'attendance', label: 'Attendance', value: 'Marked every morning', x: 78, y: 74, drift: '-6px', dur: '9s', delay: 780 },
  { key: 'fees', icon: 'fees', label: 'Fees', value: 'Paid, due, receipted', x: 13, y: 80, drift: '8px', dur: '7s', delay: 860 },
];

const HUB = { x: 200, y: 180 };
// Links start this far out from the hub, which clears the centre card. Running them
// all the way in would draw an X across the card where opposite links crossed.
const HUB_CLEARANCE = 86;

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '—';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function RecordConstellation({ schoolName, shortName }: RecordConstellationProps) {
  const named = Boolean(schoolName?.trim());
  const display = schoolName?.trim() || 'Your school';

  return (
    <div className="relative mx-auto aspect-[400/360] w-full max-w-[32rem]">
      <svg viewBox="0 0 400 360" fill="none" aria-hidden="true" className="absolute inset-0 size-full overflow-visible">
        {satellites.map((s, index) => {
          const x = (s.x / 100) * 400;
          const y = (s.y / 100) * 360;
          const dx = x - HUB.x;
          const dy = y - HUB.y;
          const distance = Math.hypot(dx, dy);
          const startX = HUB.x + (dx / distance) * HUB_CLEARANCE;
          const startY = HUB.y + (dy / distance) * HUB_CLEARANCE;
          const length = Math.round(distance - HUB_CLEARANCE);
          return (
            <line
              key={s.key}
              className="link-draw"
              x1={startX}
              y1={startY}
              x2={x}
              y2={y}
              stroke={named ? 'rgba(248,187,76,.75)' : 'rgba(111,207,204,.45)'}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray="2.5 5"
              style={{ '--len': length, '--d': `${220 + index * 90}ms`, transition: 'stroke .5s ease' } as React.CSSProperties}
            />
          );
        })}
      </svg>

      {/* Centre: the school itself. */}
      <div
        className="pop absolute left-1/2 top-1/2 z-[5] w-[70%] max-w-[19.5rem] -translate-x-1/2 -translate-y-1/2"
        style={{ '--d': '120ms' } as React.CSSProperties}
      >
        <span
          aria-hidden="true"
          className={`halo pointer-events-none absolute inset-0 rounded-[1.25rem] ${named ? 'bg-marigold-400/40' : 'bg-lagoon-400/25'}`}
        />
        <div className="sheet relative flex items-center gap-3 p-3 pr-4">
          <span
            className={`grid size-11 shrink-0 place-items-center rounded-2xl text-[0.9375rem] font-extrabold transition-colors duration-500 ${
              named ? 'bg-marigold-500 text-night' : 'bg-slate-100 text-slate-400'
            }`}
            style={{ fontStretch: '115%' }}
          >
            {named ? initials(display) : '—'}
          </span>
          <span className="flex min-w-0 flex-col">
            <span
              className={`line-clamp-2 text-[1.0625rem] font-bold leading-tight transition-colors duration-500 ${
                named ? 'text-ink-800' : 'text-slate-400'
              }`}
              style={{ fontStretch: '115%' }}
            >
              {display}
            </span>
            <span className="truncate text-[0.8125rem] text-slate-600">
              {named && shortName ? shortName : 'Not created yet'}
            </span>
          </span>
        </div>
      </div>

      {/* Satellites: what the school will hold. */}
      {satellites.map((s) => (
        <div
          key={s.key}
          className="pop absolute z-[4] -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${s.x}%`, top: `${s.y}%`, '--d': `${s.delay}ms` } as React.CSSProperties}
        >
          <div
            className="drift"
            style={{ '--drift': s.drift, '--dur': s.dur, '--d': `${s.delay}ms` } as React.CSSProperties}
          >
            <div className="orbit-card flex items-center gap-2.5 p-2 pr-3.5">
              <span className="orbit-icon shrink-0">
                <Icon name={s.icon} size={16} />
              </span>
              <span className="flex flex-col">
                <span className="orbit-label">{s.label}</span>
                <span className="orbit-value">{s.value}</span>
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
