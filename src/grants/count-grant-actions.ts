import type { Database } from 'bun:sqlite';
import { z } from 'zod';

const TOTAL = z.object({ total: z.number() });

// How many actions are recorded under a grant name, in all time, voided ones included, so a grant
// with any history keeps its mark and its name.
export function countGrantActions(db: Database, name: string): number {
  return TOTAL.parse(db.query('SELECT COUNT(*) AS total FROM grant_actions WHERE grant_name = ?').get(name)).total;
}
