/**
 * Shared framer-motion presets for the venue pages (Landing / About).
 *
 * Rules baked in here:
 *  - Animate opacity/transform ONLY — never layout properties, so cards can't
 *    shift each other and content stays clickable the moment it mounts.
 *  - useReducedMotion switches every variant to an instant, invisible state
 *    (final values, zero duration) — nothing fades, slides, or scales.
 *  - whileInView containers use viewport={{ once: true }} so reveals never
 *    replay when scrolling back up.
 */
import type { Variants } from "framer-motion";
import { useReducedMotion } from "framer-motion";

/** Stagger between siblings in an orchestrated group (hero, card grids). */
export const STAGGER_CHILDREN = 0.09;

/** Props for a motion.button CTA — tactile press feedback, none under reduced motion. */
export type TapProps = { whileTap?: { scale: number } };

/** Props for a card — hover lift, none under reduced motion. */
export type HoverProps = { whileHover?: { y: number } };

/** Props for an orchestration container (stagger-only; renders no styles itself). */
type GroupProps = {
  variants: Variants;
  initial: string;
  animate?: string;
  whileInView?: string;
  viewport?: { once: boolean; amount: number; margin: string };
};

export function useVenueMotion(): {
  variants: Variants;
  variantsScale: Variants;
  stagger: number;
  tapProps: TapProps;
  hoverProps: HoverProps;
  mountGroup: GroupProps;
  inViewGroup: GroupProps;
  inViewGroupScale: GroupProps;
} {
  const reduced = useReducedMotion();

  const variants: Variants = {
    // Entrance (mount or first scroll into view): fade + slide-up.
    hidden: reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 22 },
    visible: reduced
      ? { opacity: 1, y: 0, transition: { duration: 0 } }
      : {
          opacity: 1,
          y: 0,
          transformOrigin: "50% 50%",
          transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
        },
    // Closing CTA banner — fade+scale instead of slide.
    hiddenScale: reduced ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.97 },
    visibleScale: reduced
      ? { opacity: 1, scale: 1, transition: { duration: 0 } }
      : {
          opacity: 1,
          scale: 1,
          transformOrigin: "50% 50%",
          transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
        },
    // Tactile press feedback on CTAs (reduced motion → no-op).
    tap: reduced ? {} : { scale: 0.97 },
  };

  const variantsScale: Variants = {
    hiddenScale: reduced ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.97 },
    visibleScale: reduced
      ? { opacity: 1, scale: 1, transition: { duration: 0 } }
      : {
          opacity: 1,
          scale: 1,
          transformOrigin: "50% 50%",
          transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
        },
  };

  return {
    variants,
    variantsScale,
    stagger: reduced ? 0 : STAGGER_CHILDREN,
    tapProps: reduced ? {} : { whileTap: { scale: 0.97 } },
    hoverProps: reduced ? {} : { whileHover: { y: -4 } },
    mountGroup: {
      variants: { hidden: {}, visible: { transition: { staggerChildren: reduced ? 0 : STAGGER_CHILDREN } } },
      initial: "hidden",
      animate: "visible",
    },
    inViewGroup: {
      variants: { hidden: {}, visible: { transition: { staggerChildren: reduced ? 0 : STAGGER_CHILDREN } } },
      initial: "hidden",
      whileInView: "visible",
      viewport: { once: true, amount: 0.25, margin: "0px 0px -60px 0px" },
    },
    // Same container, driving the fade+scale child variants (About CTA banner):
    // propagates the *Scale labels so only children using variantsScale respond.
    inViewGroupScale: {
      variants: { hiddenScale: {}, visibleScale: { transition: { staggerChildren: reduced ? 0 : STAGGER_CHILDREN } } },
      initial: "hiddenScale",
      whileInView: "visibleScale",
      viewport: { once: true, amount: 0.25, margin: "0px 0px -60px 0px" },
    },
  };
}
