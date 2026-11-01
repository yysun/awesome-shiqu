// A ZIP keeps the filename produced by Shiqu; its reader ID is separate.
export const validContributor = value => typeof value === 'string' && value.length <= 39 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

export function validArchiveName(value) {
  if (typeof value !== 'string' || !/\.zip$/i.test(value)) return false;
  const stem = value.slice(0, -4);
  return stem.length > 0 && stem.length <= 120 && stem.trim() === stem && !['.', '..'].includes(stem)
    && new TextEncoder().encode(value).length <= 240
    && !/[<>:"/\\|?*\p{C}]/u.test(value);
}

export function validArchivePath(value, directory = 'works') {
  if (typeof value !== 'string' || !value.startsWith(directory + '/')) return false;
  const parts = value.slice(directory.length + 1).split('/');
  return parts.length === 2 && validContributor(parts[0]) && validArchiveName(parts[1]);
}

export const encodeArchivePath = value => value.split('/').map(encodeURIComponent).join('/');
