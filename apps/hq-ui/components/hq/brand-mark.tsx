/**
 * The 8 Sync mark ("The Cut", brand kit 2026-09: outputs/brand-2026-09/logos/mark.svg), cropped to the
 * glyph so it fills its box. `currentColor`: lime on dark, leaf on light via `text-primary`.
 * Never recolour it with a gradient, outline it or rotate it (brand board do/don't).
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="24.2 12 51.6 76" aria-hidden focusable="false" className={className}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M 24.2 54.52 L 64.2 35.87 A 19 19 0 1 0 33.08 45.1 A 24.5 24.5 0 0 0 24.2 54.52 Z M 45.83 23.02 A 8 8 0 1 0 45.83 39.02 A 8 8 0 1 0 45.83 23.02 Z M 64.53 42.88 A 24.5 24.5 0 1 1 26.96 60.4 Z M 51.27 52.48 A 11 11 0 1 0 51.27 74.48 A 11 11 0 1 0 51.27 52.48 Z"
      />
    </svg>
  );
}
