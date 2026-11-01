import {loadCatalog} from './library.mjs';
export const ROOT = new URL('../', import.meta.url);
export const validId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,119}$/.test(value);
const storageKey = 'awesome-shiqu:v1';
export function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
export function internalURL(path, base = ROOT) {
  const url = new URL(path, base);
  if (url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname) || !/^https?:$/.test(url.protocol)) throw Error('作品文件路径无效。');
  return url;
}
export function externalURL(path) {
  try { const url = new URL(path); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null; } catch { return null; }
}
export function storyLink(id) {
  if (!validId(id)) throw Error('作品编号无效。');
  const url = new URL('reader.html', ROOT); url.searchParams.set('story', id); return url;
}
function state() {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) || '{}');
    return { saved: Array.isArray(data.saved) ? data.saved.filter(validId) : [], progress: data.progress && typeof data.progress === 'object' && !Array.isArray(data.progress) ? data.progress : {} };
  } catch { return { saved: [], progress: {} }; }
}
function writeState(data) { try { localStorage.setItem(storageKey, JSON.stringify(data)); return true; } catch { return false; } }
export const savedStories = () => new Set(state().saved);
export function toggleSaved(id) {
  const data = state(), saved = new Set(data.saved);
  if (saved.has(id)) saved.delete(id); else saved.add(id);
  data.saved = [...saved];
  return { saved: saved.has(id), stored: writeState(data) };
}
export function progressFor(id) {
  const value = state().progress[id];
  return value && Number.isSafeInteger(value.page) && value.page >= 0 ? value : null;
}
export function saveProgress(id, page) {
  if (!validId(id) || !Number.isSafeInteger(page) || page < 0) return;
  const data = state(); data.progress[id] = { page, at: Date.now() };
  data.progress = Object.fromEntries(Object.entries(data.progress).sort((a,b) => (b[1]?.at || 0) - (a[1]?.at || 0)).slice(0, 200));
  writeState(data);
}
let toastTimer;
export function toast(message) {
  const target = document.querySelector('#toast'); if (!target) return;
  clearTimeout(toastTimer); target.textContent = message; target.hidden = false;
  toastTimer = setTimeout(() => { target.hidden = true; }, 2800);
}
export function bookmarkIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', 'M6 3h12v18l-6-4-6 4Z'); svg.append(path); return svg;
}
let libraryPromise;
export function libraryInfo() { return libraryPromise ??= loadCatalog(); }
export async function catalog() { return (await libraryInfo()).stories; }
