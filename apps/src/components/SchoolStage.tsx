// The navy panel beside the onboarding forms.
//
// It is not decoration: it is a preview of the thing being created. While someone
// types their school's name it appears on the record card, and the four kinds of
// record a school keeps hang off it. Before a name exists the card sits as an
// outline, which is what makes the second step feel like finishing something
// rather than filling in another form.
//
// Geometry lives in one fixed 400x320 coordinate space shared by the SVG lines and
// the HTML nodes layered over them, so the connections meet their nodes at every
// screen size. Each line ends underneath the node it serves, where the node covers it.
import { Wordmark } from './Wordmark';

type SchoolStageProps = {
  /** What the person has typed so far. Empty shows the outline state. */
  schoolName?: string;
  /** The school's short name, shown on the card once it exists. */
  shortName?: string;
  caption: string;
};

const nodes = [
  { label: 'Students', x: '30%', y: '66%', delay: 520 },
  { label: 'Staff', x: '70%', y: '66%', delay: 600 },
  { label: 'Attendance', x: '30%', y: '85%', delay: 680 },
  { label: 'Fees', x: '70%', y: '85%', delay: 760 },
];

const links = [
  { to: [120, 211], length: 115, delay: 120 },
  { to: [280, 211], length: 115, delay: 200 },
  { to: [120, 272], length: 165, delay: 280 },
  { to: [280, 272], length: 165, delay: 360 },
];

export function SchoolStage({ schoolName, shortName, caption }: SchoolStageProps) {
  const named = Boolean(schoolName?.trim());
  const displayName = schoolName?.trim() || 'Your school';

  return (
    <div
      data-surface="dark"
      className="relative flex h-full flex-col overflow-hidden bg-night px-10 py-12 xl:px-14"
    >
      {/* A single light source, top right, so the panel has depth without a gradient wash. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-32 size-[26rem] rounded-full opacity-60 blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(20,152,155,0.5), transparent 68%)' }}
      />

      <div className="relative">
        <Wordmark tone="light" className="h-7" />
      </div>

      {/* The graphic and the line explaining it read as one block, centred in what
          is left of the panel, rather than as three things pushed to the edges. */}
      <div className="relative flex flex-1 flex-col justify-center py-10">
        <div className="relative mx-auto aspect-[400/320] w-full max-w-[30rem]">
        <svg
          aria-hidden="true"
          viewBox="0 0 400 320"
          fill="none"
          className="absolute inset-0 size-full"
        >
          {links.map((link) => (
            <line
              key={link.to.join()}
              className="stage-link"
              x1="200"
              y1="128"
              x2={link.to[0]}
              y2={link.to[1]}
              stroke={named ? '#6fcfcc' : '#45648f'}
              strokeWidth="1.5"
              strokeLinecap="round"
              style={
                {
                  '--len': link.length,
                  '--d': `${link.delay}ms`,
                  transition: 'stroke 0.5s ease',
                } as React.CSSProperties
              }
            />
          ))}
        </svg>

        {/* The record card. Sits above the lines, hiding where they begin. */}
        <div
          className="stage-node absolute left-1/2 top-[34%] w-[74%] -translate-x-1/2 -translate-y-1/2"
          style={{ '--d': '420ms' } as React.CSSProperties}
        >
          <div
            className={`rounded-lg px-5 py-4 transition-all duration-500 ${
              named
                ? 'bg-white shadow-[0_18px_44px_-18px_rgba(20,152,155,0.75)]'
                : 'border border-dashed border-ink-500/70 bg-ink-950/50'
            }`}
          >
            <p
              className={`text-[1.0625rem] font-bold leading-snug tracking-[-0.015em] transition-colors duration-500 ${
                named ? 'text-ink-900' : 'text-slate-400'
              }`}
              style={{ fontStretch: '112%' }}
            >
              {displayName}
            </p>

            <div className="mt-2 flex items-center gap-2">
              {named && shortName ? (
                <span className="chip bg-marigold-100 text-marigold-700">{shortName}</span>
              ) : (
                <span className={`chip ${named ? 'bg-slate-100 text-slate-500' : 'bg-ink-800 text-slate-400'}`}>
                  {named ? 'School' : 'Not created yet'}
                </span>
              )}
            </div>
          </div>
        </div>

        {nodes.map((node) => (
          <div
            key={node.label}
            className="stage-node absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: node.x, top: node.y, '--d': `${node.delay}ms` } as React.CSSProperties}
          >
            <span
              className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors duration-500 ${
                named
                  ? 'border-lagoon-500/50 bg-lagoon-700/35 text-lagoon-100'
                  : 'border-ink-600 bg-ink-950/70 text-slate-400'
              }`}
            >
              <span
                className={`size-1.5 rounded-full transition-colors duration-500 ${
                  named ? 'bg-lagoon-300' : 'bg-ink-500'
                }`}
              />
              {node.label}
            </span>
          </div>
          ))}
        </div>

        <p className="mx-auto mt-10 max-w-[30rem] text-[0.9375rem] leading-relaxed text-slate-400">
          {caption}
        </p>
      </div>
    </div>
  );
}
