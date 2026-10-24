import type { Database } from 'bun:sqlite';
import { fleetIds } from '../atc/fleet-ids.ts';
import { iso } from '../clock/iso.ts';
import { HqError } from '../errors.ts';
import { logEvent } from '../log-event.ts';
import { addNews } from '../news/add-news.ts';
import type { OwnerProbeDeps } from '../pr-status/read-owner-session.ts';
import { roleName } from '../roles/role-name.ts';
import { decideGrantVoid } from './decide-grant-void.ts';
import { GrantActionRowSchema } from './grant-action-row-schema.ts';
import { readGrantVoidCaller } from './read-grant-void-caller.ts';
import type { GrantActionRow, GrantVoidArgs, GrantVoidCaller } from './types.ts';

interface GrantVoidDeps {
  db: Database;
  args: GrantVoidArgs;
  probe: OwnerProbeDeps;
  clock: () => Date;
}

// Takes back an action logged in error. The row stays, marked with when, by whom and why, and drops
// out of the grant's tally.
export async function voidGrantAction(deps: GrantVoidDeps): Promise<GrantActionRow> {
  const caller = await readGrantVoidCaller(deps.probe);
  return deps.db.transaction(() => writeVoid(deps, caller)).immediate();
}

function writeVoid(deps: GrantVoidDeps, caller: GrantVoidCaller): GrantActionRow {
  const db = deps.db;
  const args = deps.args;
  const found = db.query('SELECT * FROM grant_actions WHERE id = ?').get(args.id);
  const loaded = found === null ? null : GrantActionRowSchema.parse(found);
  const decision = decideGrantVoid({ action: loaded, caller, fleetIDs: fleetIds(db), owner: roleName('owner'), request: args });
  if (!decision.ok) {
    const detail = decision.state === null ? undefined : { state: decision.state };
    throw new HqError(decision.code, decision.message, detail);
  }
  const action = decision.action;
  const voider = decision.voidedBy;
  const voidedAt = iso(deps.clock());
  db.query('UPDATE grant_actions SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?').run(voidedAt, voider, args.reason, action.id);
  logEvent(db, 'hq', `grant:${action.grant_name}`, 'grant-void', voider, decision.from, decision.to, { id: action.id, target: action.target, reason: args.reason });
  addNews(db, { from: voider, topic: 'other', text: formatNews(voider, action, args.reason), issue: null, link: null, needsGeoff: false });
  return { ...action, voided_at: voidedAt, voided_by: voider, void_reason: args.reason };
}

const NEWS_MAX = 400;

// News refuses a line over 400 characters, so a long target gives way and the reason stays whole.
function formatNews(voider: string, action: GrantActionRow, reason: string): string {
  const head = `${voider} voided grant action ${action.id} under ${action.grant_name} (`;
  const tail = `): ${reason}`;
  const room = NEWS_MAX - head.length - tail.length;
  const target = action.target.length <= room ? action.target : `${action.target.slice(0, Math.max(0, room - 1))}…`;
  return `${head}${target}${tail}`;
}
