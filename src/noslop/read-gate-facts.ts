import { z } from 'zod';
import { HqError } from '../errors.ts';
import { boundedRunner } from '../runner/bounded-runner.ts';
import { toRunFailure } from '../runner/to-run-failure.ts';
import type { Runner } from '../runner/types.ts';
import { CALL_MS } from '../watcher/call-ms.ts';
import { parseJSON } from './parse-json.ts';

const TimeSchema = z.string().nullable().optional();
const CheckRunSchema = z.object({ __typename: z.literal('CheckRun'), name: z.string(), workflowName: z.string().optional(), status: z.string(), conclusion: z.string().nullable(), startedAt: TimeSchema, completedAt: TimeSchema });
const StatusContextSchema = z.object({ __typename: z.literal('StatusContext'), context: z.string(), state: z.string(), startedAt: TimeSchema });
const FactsSchema = z.object({
    headRefOid: z.string().min(1),
    baseRefName: z.string().min(1),
    baseRefOid: z.string().min(1),
    author: z.object({ login: z.string().optional(), is_bot: z.boolean().optional() }),
    statusCheckRollup: z.array(z.discriminatedUnion('__typename', [CheckRunSchema, StatusContextSchema])),
  });

export type GateFacts = z.output<typeof FactsSchema>;
export type GateCheck = GateFacts['statusCheckRollup'][number];

// One GitHub read, so the head, base, author and checks describe the same moment.
export async function readGateFacts(run: Runner, slug: string, pr: number): Promise<GateFacts> {
  const result = await boundedRunner(run, CALL_MS)(['gh', 'pr', 'view', String(pr), '-R', slug, '--json', 'headRefOid,author,statusCheckRollup,baseRefName,baseRefOid']).catch(toRunFailure);
  const parsed = result.code === 0 ? FactsSchema.safeParse(parseJSON(result.stdout)) : null;
  if (parsed?.success !== true) {
    throw new HqError('merge_blocked', `could not read the PR's head, author and checks from GitHub, so the gate cannot pass: ${(result.stderr || result.stdout).trim().slice(0, 300)}`);
  }
  return parsed.data;
}
