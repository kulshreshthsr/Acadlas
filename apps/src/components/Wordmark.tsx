// The Acadlas wordmark, in the two finishes the brand ships: navy for light
// surfaces, white for the navy stage.
import wordmarkDark from '../assets/brand/acadlas-wordmark.png';
import wordmarkLight from '../assets/brand/acadlas-wordmark-light.png';

type WordmarkProps = {
  /** 'dark' is the navy mark for light surfaces; 'light' is the white mark for navy. */
  tone?: 'dark' | 'light';
  className?: string;
};

export function Wordmark({ tone = 'dark', className = 'h-7' }: WordmarkProps) {
  const light = tone === 'light';

  return (
    <img
      src={light ? wordmarkLight : wordmarkDark}
      alt="Acadlas"
      width={960}
      height={200}
      // The navy artwork ships on an opaque white background, which would show as a
      // white box on our paper surfaces. Multiplying drops the white and leaves the
      // mark's own colours — including the lighter swoosh — untouched. The white
      // artwork is already transparent and needs no help.
      className={`w-auto ${light ? '' : 'mix-blend-multiply'} ${className}`}
    />
  );
}
