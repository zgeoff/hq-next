import { expect, test } from 'bun:test';
import { isCodeownersMatch } from './is-codeowners-match.ts';

test.each([
  ['/docs/', 'docs/sessions.md', true],
  ['/docs/', 'docs/a/b/c.md', true],
  ['/docs/', 'src/docs/sessions.md', false],
  ['/docs/', 'docs', false],
  ['/docs/', 'docsite/a.md', false],
  ['/.claude/', '.claude/settings.json', true],
  ['/fleet.json', 'fleet.json', true],
  ['/fleet.json', 'src/fleet.json', false],
  ['docs/', 'src/docs/a.md', true],
  ['docs/api', 'x/docs/api', false],
  ['docs/api', 'docs/api/a.md', true],
  ['Makefile', 'Makefile', true],
  ['Makefile', 'tools/build/Makefile', true],
  ['*.md', 'README.md', true],
  ['*.md', 'docs/deep/README.md', true],
  ['*.md', 'README.mdx', false],
  ['/docs/*.md', 'docs/a.md', true],
  ['/docs/*.md', 'docs/sub/a.md', false],
  ['/docs/*', 'docs/a.md', true],
  ['/docs/*', 'docs/sub/a.md', false],
  ['/docs/sessions*', 'docs/sessions.private.md', true],
  ['/docs/sessions*', 'docs/sessions', true],
  ['/docs/sessions*', 'docs/sessions/x.md', false],
  ['/docs/**/*.md', 'docs/sub/deep/a.md', true],
  ['/docs/**/*.md', 'docs/a.md', true],
  ['/docs/**', 'docs/a/b.md', true],
  ['**/logs', 'a/b/logs/x.txt', true],
  ['**/logs', 'logs/x.txt', true],
  ['/a.b', 'axb', false],
])('it matches the pattern %s against %s as %p', (pattern, path, expected) => {
  expect(isCodeownersMatch(pattern, path)).toBe(expected);
});
