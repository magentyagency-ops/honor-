import type { Dict } from './engine';
import { PHRASES } from './phrases';

export const FR: Dict = Object.fromEntries(PHRASES.map(([es, fr]) => [es, fr]));
