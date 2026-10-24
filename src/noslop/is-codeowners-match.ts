// Whether a CODEOWNERS pattern covers a repo path. A leading or inner slash anchors the pattern at
// the root, a pattern with none matches that name at any depth, and a match covers everything below,
// except that a single `*` in the last segment matches at that depth only, as GitHub's `docs/*` does.
export function isCodeownersMatch(pattern: string, path: string): boolean {
  const dirOnly = pattern.endsWith('/');
  const body = pattern.replace(/^\//u, '').replace(/\/$/u, '');
  const anchored = pattern.replace(/\/$/u, '').includes('/');
  const prefix = anchored ? '' : '(?:.*/)?';
  return new RegExp(`^${prefix}${toRegexBody(body)}${pickBelow(dirOnly, body)}$`, 'u').test(path);
}

function toRegexBody(glob: string): string {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob.charAt(index);
    if (glob.startsWith('**/', index)) {
      source += '(?:.*/)?';
      index += 2;
    } else if (glob.startsWith('**', index)) {
      source += '.*';
      index += 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replaceAll(/[.+^${}()|[\]\\]/gu, String.raw`\$&`);
    }
  }
  return source;
}

function pickBelow(dirOnly: boolean, body: string): string {
  if (dirOnly) {
    return '/.+';
  }
  const lastSegment = body.slice(body.lastIndexOf('/') + 1);
  return /(?<!\*)\*(?!\*)/u.test(lastSegment) ? '' : '(?:/.*)?';
}
