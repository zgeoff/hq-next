import { z } from 'zod';
import { HqError } from '../errors.ts';
import { boundedRunner } from '../runner/bounded-runner.ts';
import { toRunFailure } from '../runner/to-run-failure.ts';
import type { Runner } from '../runner/types.ts';
import { CALL_MS } from '../watcher/call-ms.ts';
import { parseJSON } from './parse-json.ts';

const PATHS = ['.github/CODEOWNERS', 'CODEOWNERS'];
const MISSING_PATH = /\bNot Found \(HTTP 404\)/u;
const BASE64 = /^[A-Za-z0-9+/=\s]*$/u;
const FileSchema = z.object({ type: z.literal('file'), encoding: z.literal('base64'), content: z.string().regex(BASE64) });

// The CODEOWNERS text at the PR's base commit, or null when the repo has none there. The base, not
// the head, so a PR cannot loosen the rule it is judged by. Any other failure blocks the merge.
export async function readCodeowners(run: Runner, slug: string, base: string): Promise<string | null> {
  const bounded = boundedRunner(run, CALL_MS);
  for (const path of PATHS) {
    const result = await bounded(['gh', 'api', `repos/${slug}/contents/${path}?ref=${base}`]).catch(toRunFailure);
    if (result.code !== 0 && MISSING_PATH.test(result.stderr)) {
      continue;
    }
    const file = result.code === 0 ? FileSchema.safeParse(parseJSON(result.stdout)) : null;
    if (file?.success !== true) {
      throw new HqError('merge_blocked', `could not read ${path} at the PR's base ${base.slice(0, 7)}, so the gate cannot tell which files are owner-held: ${(result.stderr || result.stdout).trim().slice(0, 300)}`);
    }
    return Buffer.from(file.data.content, 'base64').toString('utf8');
  }

  // GitHub answers 404 as well when the token cannot see the repo or the ref, so a 404 means no file
  // only when the base commit itself is readable.
  const commit = await bounded(['gh', 'api', `repos/${slug}/commits/${base}`, '--silent']).catch(toRunFailure);
  if (commit.code !== 0) {
    throw new HqError('merge_blocked', `could not read the PR's base ${base.slice(0, 7)} to confirm the repo has no CODEOWNERS, so the gate cannot tell which files are owner-held: ${commit.stderr.trim().slice(0, 300)}`);
  }
  return null;
}
