// Draws one icon from the shared set. Same 24px grid and stroke treatment the
// marketing site uses, so an icon looks identical in both places.
import { icons } from '../lib/icons';
import type { IconName } from '../lib/icons';

type IconProps = {
  name: IconName;
  size?: number;
  className?: string;
};

export function Icon({ name, size = 20, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      dangerouslySetInnerHTML={{ __html: icons[name] }}
    />
  );
}
