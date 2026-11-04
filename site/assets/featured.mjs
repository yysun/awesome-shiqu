// Maintainer-selected featured stories: site/featured.json references catalogued ZIPs by works/ path.
// Missing file means "no featured stories"; the build rejects malformed files or unknown paths, while
// the browser skips entries the (possibly newer or older) remote catalogue does not contain.
import { validArchivePath } from './archive-path.mjs';
import { responseJSON } from './library.mjs';

export const FEATURED_LIMITS = { stories: 50, noteLength: 200, bytes: 64 * 1024 };
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
function check(condition, message) { if (!condition) throw Error(message); }

export function validateFeatured(data) {
  check(isObject(data) && Array.isArray(data.stories) && data.stories.length <= FEATURED_LIMITS.stories, `精选清单需要 stories 数组，且不超过 ${FEATURED_LIMITS.stories} 篇。`);
  const seen = new Set();
  const stories = data.stories.map((entry, index) => {
    check(isObject(entry) && Object.keys(entry).every(key => key === 'path' || key === 'note'), `精选第 ${index + 1} 项只能包含 path 与 note。`);
    check(validArchivePath(entry.path), `精选第 ${index + 1} 项的 path 必须是 works/<用户名>/<作品名>.zip。`);
    check(!seen.has(entry.path), `精选清单重复引用：${entry.path}`);
    seen.add(entry.path);
    const note = entry.note === undefined ? '' : entry.note;
    check(typeof note === 'string' && note.length <= FEATURED_LIMITS.noteLength && !/[\p{Cc}]/u.test(note), `精选第 ${index + 1} 项的 note 需为不超过 ${FEATURED_LIMITS.noteLength} 字的文本。`);
    return { path: entry.path, note: note.trim() };
  });
  return { stories };
}

export async function loadFeatured({ root, fetcher = fetch } = {}) {
  let response;
  try { response = await fetcher(new URL('featured.json', root), { cache: 'no-cache', credentials: 'same-origin', signal: AbortSignal.timeout(5000) }); }
  catch { return { stories: [] }; }
  if (!response.ok) return { stories: [] };
  try {
    return validateFeatured(await responseJSON(response, FEATURED_LIMITS.bytes));
  } catch (error) {
    console.warn('精选清单无效，已忽略：' + (error.message || error));
    return { stories: [] };
  }
}

// Keeps featured order; stories without sourcePath (legacy manifests) can never be featured.
export function matchFeatured(featured, stories) {
  const byPath = new Map();
  for (const story of stories) if (typeof story.sourcePath === 'string') byPath.set(story.sourcePath, story);
  return featured.stories.flatMap(({ path, note }) => { const story = byPath.get(path); return story ? [{ story, note }] : []; });
}
