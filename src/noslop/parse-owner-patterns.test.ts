import { expect, test } from 'bun:test';
import { parseOwnerPatterns } from './parse-owner-patterns.ts';

test("it reads the owner's patterns from hq's CODEOWNERS", () => {
  const text = `# Both owners act through one GitHub login, so GitHub can't enforce this file.

# z-q
/src/ @zgeoff
/test/ @zgeoff
/scripts/ @zgeoff

# the owner: skills, docs and hooks change only with his lgtm
/skills/ @zgeoff
/docs/ @zgeoff
/.claude/ @zgeoff
`;

  expect(parseOwnerPatterns(text)).toStrictEqual(['/skills/', '/docs/', '/.claude/']);
});

test('it stops the owner section at the next heading', () => {
  const text = '# The Owner\n/docs/ @zgeoff\n\n# z-q\n/src/ @zgeoff\n';

  expect(parseOwnerPatterns(text)).toStrictEqual(['/docs/']);
});

test('it keeps a heading that wraps onto a second comment line in the section', () => {
  const text = '# the owner: docs\n# and skills\n\n/docs/ @zgeoff\n*.md @zgeoff @teapot\n';

  expect(parseOwnerPatterns(text)).toStrictEqual(['/docs/', '*.md']);
});

test('it finds no section in a file without the owner heading', () => {
  expect(parseOwnerPatterns('# z-q\n/src/ @zgeoff\n')).toBeNull();
});

test('it finds an empty owner section when no pattern follows the heading', () => {
  expect(parseOwnerPatterns('# the owner\n\n# z-q\n/src/ @zgeoff\n')).toStrictEqual([]);
});

test('it keeps the section going past a note between two owner patterns', () => {
  const text = '# the owner\n/docs/ @zgeoff\n# hooks too\n/.claude/ @zgeoff\n';

  expect(parseOwnerPatterns(text)).toStrictEqual(['/docs/', '/.claude/']);
});
