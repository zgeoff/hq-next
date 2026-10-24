import { z } from 'zod';
import { HqError } from '../errors.ts';
import type { GrantVoidArgs } from './types.ts';

const GRANT_VOID_USAGE = 'hq grant void ACT-ID --reason T';

const ARGS = z.object({
  id: z
    .string({ error: 'the act id is missing' })
    .regex(/^[1-9]\d*$/u, 'the act id must be a positive whole number')
    .transform(Number)
    .pipe(z.number().int().safe('the act id is too large')),
  reason: z
    .string({ error: '--reason is required' })
    .trim()
    .min(1, '--reason must say why')
    .max(200, '--reason is over 200 characters: keep it short')
    .regex(/^[^\r\n]+$/u, '--reason must be one line'),
});

export function parseGrantVoidArgs(rest: readonly string[], reason: string | undefined): GrantVoidArgs {
  if (rest.length > 1) {
    throw new HqError('bad_args', `hq grant void takes one act id; ${GRANT_VOID_USAGE}`);
  }
  const parsed = ARGS.safeParse({ id: rest[0], reason });
  if (!parsed.success) {
    throw new HqError('bad_args', `${parsed.error.issues.map((issue) => issue.message).join('; ')}; ${GRANT_VOID_USAGE}`);
  }
  return parsed.data;
}
