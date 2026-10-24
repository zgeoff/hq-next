import { match } from 'ts-pattern';
import { GRANT_ACT_TRANSITIONS } from './grant-act-transitions.ts';
import type { GrantActState, GrantActionRow, GrantVoidArgs, GrantVoidCaller } from './types.ts';

interface GrantVoidInput {
  action: GrantActionRow | null;
  caller: GrantVoidCaller;
  fleetIDs: Record<string, string>;
  owner: string;
  request: GrantVoidArgs;
}

type GrantVoidDecision =
  | { ok: true; action: GrantActionRow; voidedBy: string; from: GrantActState; to: GrantActState }
  | { ok: false; code: 'not_found' | 'not_allowed'; message: string; state: null }
  | { ok: false; code: 'bad_state'; message: string; state: GrantActState };

// Only the caller's session as atc found it counts. The act's own actor may void it when the caller
// is the session hq fleet recorded for that actor, and so may the owner's recorded session.
export function decideGrantVoid(input: GrantVoidInput): GrantVoidDecision {
  const action = input.action;
  if (action === null) {
    return { ok: false, code: 'not_found', message: `no grant action ${input.request.id}`, state: null };
  }
  const verdict = match(input.caller)
    .with({ kind: 'session' }, (session) => ({ voidedBy: [action.actor, input.owner].find((name) => input.fleetIDs[name] === session.id), cause: '' }))
    .with({ kind: 'unknown' }, (unknown) => ({ voidedBy: undefined, cause: `; atc cannot say who is calling (${unknown.cause})` }))
    .exhaustive();
  const voidedBy = verdict.voidedBy;
  if (voidedBy === undefined) {
    return { ok: false, code: 'not_allowed', message: `only ${action.actor}, who logged grant action ${action.id}, or ${input.owner} may void it${verdict.cause}`, state: null };
  }
  const from: GrantActState = action.voided_at === null ? 'live' : 'void';
  const move = GRANT_ACT_TRANSITIONS['grant-void'];
  if (!move.from.includes(from)) {
    return { ok: false, code: 'bad_state', message: `grant action ${action.id} was already voided at ${action.voided_at} by ${action.voided_by}: ${action.void_reason}`, state: from };
  }
  return { ok: true, action, voidedBy, from, to: move.to };
}
