import type { Database } from 'bun:sqlite';
import { z } from 'zod';
import { GrantActionRowSchema } from './grant-action-row-schema.ts';
import type { GrantAction, GrantActionRow, GrantTally, GrantWindow, VoidedGrantAction } from './types.ts';

const MARK = z.object({ id: z.number(), grant_name: z.string(), text: z.string(), ref: z.string().nullable() });

// Every named grant, by name, with the actions taken under it in the window. A grant with none is
// listed too: an unused grant is the plainest one for the owner to pull back.
export function loadGrantTallies(db: Database, window: GrantWindow): GrantTally[] {
  const actionsOf = db.query('SELECT * FROM grant_actions WHERE grant_name = ? AND at >= ? AND at < ? ORDER BY id');
  const marks = z.array(MARK).parse(db.query('SELECT id, grant_name, text, ref FROM marks WHERE grant_name IS NOT NULL ORDER BY grant_name').all());
  return marks.map((mark) => {
    const rows = z.array(GrantActionRowSchema).parse(actionsOf.all(mark.grant_name, window.from, window.to));
    return { grant: mark.grant_name, mark: mark.id, text: mark.text, ref: mark.ref, actions: rows.filter((row) => row.voided_at === null).map((row) => toGrantAction(row)), voided: rows.flatMap((row) => toVoidedGrantAction(row)) };
  });
}

function toGrantAction(row: GrantActionRow): GrantAction {
  return { id: row.id, grant_name: row.grant_name, target: row.target, note: row.note, actor: row.actor, at: row.at };
}

function toVoidedGrantAction(row: GrantActionRow): VoidedGrantAction[] {
  if (row.voided_at === null || row.voided_by === null || row.void_reason === null) {
    return [];
  }
  return [{ id: row.id, target: row.target, note: row.note, actor: row.actor, at: row.at, voidedAt: row.voided_at, voidedBy: row.voided_by, voidReason: row.void_reason }];
}
