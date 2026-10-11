// "Seven places → one record": the section pins while scrolling, and the scraps a
// student's information lives in today fly together into a single Acadlas record.
// Scroll position drives the whole scene, so the visitor controls its pace and can reverse it.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export function mountGather(root: HTMLElement) {
  const stage = root.querySelector<HTMLElement>('[data-gather-stage]');
  const record = root.querySelector<HTMLElement>('[data-record]');
  const before = root.querySelector<HTMLElement>('[data-gather-before]');
  const after = root.querySelector<HTMLElement>('[data-gather-after]');
  const scraps = [...root.querySelectorAll<HTMLElement>('[data-scrap]')];
  if (!stage || !record || !before || !after) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Reduced motion: show the finished state, no pinning or flying.
  if (reduceMotion) {
    scraps.forEach((el) => (el.style.display = 'none'));
    before.style.visibility = 'hidden';
    after.style.opacity = '1';
    record.style.opacity = '1';
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  const num = (el: HTMLElement, prop: string) => parseFloat(el.style.getPropertyValue(prop)) || 0;

  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: root,
      start: 'top top',
      end: '+=150%',
      pin: true,
      scrub: 0.9,
      anticipatePin: 1,
      invalidateOnRefresh: true,
    },
  });

  tl.fromTo(
    scraps,
    {
      xPercent: -50,
      yPercent: -50,
      x: (_i: number, el: HTMLElement) => num(el, '--x') * stage.offsetWidth,
      y: (_i: number, el: HTMLElement) => num(el, '--y') * stage.offsetHeight,
      rotation: (_i: number, el: HTMLElement) => num(el, '--r'),
      scale: 1,
      opacity: 1,
    },
    {
      x: 0,
      y: 0,
      rotation: 0,
      scale: 0.3,
      opacity: 0,
      ease: 'power2.in',
      duration: 1,
      stagger: 0.07,
    },
    0.2,
  )
    .to(before, { opacity: 0, y: -24, duration: 0.35 }, 0.75)
    .fromTo(record, { scale: 0.7, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.55, ease: 'back.out(1.7)' }, 1.05)
    .fromTo(after, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.4 }, 1.05)
    .to({}, { duration: 0.35 });
}
