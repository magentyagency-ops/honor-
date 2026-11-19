import { LOGO_PATH, LOGO_S_PATH, LOGO_S_VIEWBOX, LOGO_VIEWBOX } from './logoPath';

/** Logotipo de Saint-Honoré (trazado vectorial del original). Hereda el color del texto. */
export function BrandLogo({ className, title = 'Pâtisserie Saint-Honoré' }: { className?: string; title?: string }) {
  return (
    <svg viewBox={LOGO_VIEWBOX} className={className} role="img" aria-label={title} fill="currentColor">
      <path fillRule="evenodd" d={LOGO_PATH} />
    </svg>
  );
}

/** Inicial del logotipo, para espacios reducidos. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox={LOGO_S_VIEWBOX} className={className} aria-hidden fill="currentColor">
      <path fillRule="evenodd" d={LOGO_S_PATH} />
    </svg>
  );
}
