import { HqError } from '../errors.ts';
import { OWNER } from '../releases/owner.ts';
import type { Runner } from '../runner/types.ts';
import { buildSlug } from './build-slug.ts';
import { findOwnerHeldTest } from './find-owner-held-test.ts';
import { isCodeownersMatch } from './is-codeowners-match.ts';
import type { ParsedRepo } from './parse-lower-repo.ts';
import { parseOwnerPatterns } from './parse-owner-patterns.ts';
import { readCodeowners } from './read-codeowners.ts';

// Which paths need the owner's lgtm: the owner section of the repo's CODEOWNERS at the PR's base,
// else the code rule when the repo has no CODEOWNERS. Null for a repo with none held.
export async function readOwnerHeldTest(run: Runner, parsed: ParsedRepo, base: string): Promise<((path: string) => boolean) | null> {
  if (parsed.owner !== OWNER) {
    return null;
  }
  const text = await readCodeowners(run, buildSlug(parsed), base);
  if (text === null) {
    return findOwnerHeldTest(parsed);
  }
  const patterns = parseOwnerPatterns(text);
  if (patterns === null) {
    throw new HqError('merge_blocked', `CODEOWNERS at the PR's base ${base.slice(0, 7)} has no "# the owner" section, so the gate cannot tell which files are owner-held`, { repo: parsed.repo });
  }
  const extra = parsed.repo === 'hq' ? ['fleet.json'] : [];
  return (path) => extra.includes(path) || patterns.some((pattern) => isCodeownersMatch(pattern, path));
}
