import { z } from 'zod';
import type { GrantActionRow } from './types.ts';

export const GrantActionRowSchema: z.ZodType<GrantActionRow> = z.object({
  id: z.number(),
  grant_name: z.string(),
  target: z.string(),
  note: z.string().nullable(),
  actor: z.string(),
  at: z.string(),
  voided_at: z.string().nullable(),
  voided_by: z.string().nullable(),
  void_reason: z.string().nullable(),
});
