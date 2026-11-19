import { create } from 'zustand';
import { toKey, translate, type Dict, type Lang } from './engine';
import { FR } from './fr';
import { EN } from './en';

const KEY = 'saint-honore-demo:lang';
const DICTS: Record<Exclude<Lang, 'es'>, Dict> = { fr: FR, en: EN };
const ATTRS = ['placeholder', 'aria-label', 'title'];
/** Zonas que no se traducen: documentos del proveedor y mensajes reales a proveedores (en español en Panamá). */
const SKIP = '[data-no-i18n], script, style, textarea, code';

function initial(): Lang {
  try {
    const p = new URLSearchParams(window.location.search).get('lang');
    const v = (p ?? localStorage.getItem(KEY)) as Lang | null;
    if (v === 'es' || v === 'fr' || v === 'en') return v;
  } catch {
    /* ignorar */
  }
  return 'es';
}

export const useLang = create<{ lang: Lang }>(() => ({ lang: initial() }));

/** Original en español de cada nodo y última traducción escrita por nosotros. */
const orig = new WeakMap<Node, string>();
const mine = new WeakMap<Node, string>();
const origAttr = new WeakMap<Element, Record<string, string>>();
const mineAttr = new WeakMap<Element, Record<string, string>>();
const cache = new Map<string, string | null>();

function tr(text: string, lang: Lang): string | null {
  const ck = lang + '|' + text;
  if (cache.has(ck)) return cache.get(ck)!;
  const r = lang === 'es' ? null : translate(text, lang, DICTS[lang]);
  if (cache.size > 20000) cache.clear();
  cache.set(ck, r);
  return r;
}

function skipped(el: Element | null): boolean {
  return Boolean(el?.closest(SKIP));
}

function doText(node: Text, lang: Lang) {
  const cur = node.nodeValue ?? '';
  if (mine.get(node) !== cur) orig.set(node, cur); // React escribió un texto nuevo
  const source = orig.get(node) ?? cur;
  if (skipped(node.parentElement)) return;
  const out = tr(source, lang) ?? source;
  if (out !== cur) {
    mine.set(node, out);
    node.nodeValue = out;
  } else mine.set(node, cur);
}

function doAttrs(el: Element, lang: Lang) {
  if (skipped(el)) return;
  const o = origAttr.get(el) ?? {};
  const m = mineAttr.get(el) ?? {};
  for (const a of ATTRS) {
    const cur = el.getAttribute(a);
    if (cur === null) continue;
    if (m[a] !== cur) o[a] = cur;
    const out = tr(o[a], lang) ?? o[a];
    m[a] = out;
    if (out !== cur) el.setAttribute(a, out);
  }
  origAttr.set(el, o);
  mineAttr.set(el, m);
}

function walk(root: Node, lang: Lang) {
  if (root.nodeType === Node.TEXT_NODE) return doText(root as Text, lang);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  if (el.matches?.(SKIP)) return;
  doAttrs(el, lang);
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && (n as Element).matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text, lang);
    else doAttrs(n as Element, lang);
  }
}

let observer: MutationObserver | null = null;

export function startI18n() {
  const run = () => walk(document.body, useLang.getState().lang);
  observer = new MutationObserver((records) => {
    const lang = useLang.getState().lang;
    for (const r of records) {
      if (r.type === 'characterData') doText(r.target as Text, lang);
      else if (r.type === 'attributes') doAttrs(r.target as Element, lang);
      else r.addedNodes.forEach((n) => walk(n, lang));
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  run();
  useLang.subscribe(() => {
    document.documentElement.lang = useLang.getState().lang;
    run();
  });
  document.documentElement.lang = useLang.getState().lang;
  // Herramienta de desarrollo: plantillas sin traducción en la página actual.
  (window as unknown as Record<string, unknown>).__i18nMissing = () => {
    const lang = useLang.getState().lang;
    const out = new Set<string>();
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const src = orig.get(n) ?? n.nodeValue ?? '';
      if (skipped(n.parentElement) || !/\p{L}/u.test(src)) continue;
      if (tr(src, lang) === null) out.add(toKey(src.trim()).key);
    }
    document.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(',')).forEach((el) => {
      if (skipped(el)) return;
      const o = origAttr.get(el) ?? {};
      for (const a of ATTRS) {
        const v = o[a] ?? el.getAttribute(a);
        if (v && /\p{L}/u.test(v) && tr(v, lang) === null) out.add(toKey(v.trim()).key);
      }
    });
    return [...out];
  };
}

export function setLang(lang: Lang) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* ignorar */
  }
  useLang.setState({ lang });
}

/** Para textos que no pasan por el DOM (título de la pestaña, CSV…). */
export function t(text: string): string {
  return tr(text, useLang.getState().lang) ?? text;
}

window.addEventListener('storage', (e) => {
  if (e.key === KEY && (e.newValue === 'es' || e.newValue === 'fr' || e.newValue === 'en')) useLang.setState({ lang: e.newValue });
});
