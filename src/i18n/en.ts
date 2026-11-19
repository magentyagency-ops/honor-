import type { Dict } from './engine';
import { PHRASES } from './phrases';

export const EN: Dict = Object.fromEntries(PHRASES.map(([es, , en]) => [es, en]));
