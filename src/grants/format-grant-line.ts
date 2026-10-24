import type { GrantTally, VoidedGrantAction } from './types.ts';

// One grant on one line: its name, mark and count, then each target and who acted. A voided action
// follows, struck out, with when, by whom and why; it is not in the count.
export function formatGrantLine(tally: GrantTally): string {
  const actions = tally.actions.length === 0 ? 'none' : `${tally.actions.length}: ${tally.actions.map((action) => `${action.target} (${action.actor})`).join('; ')}`;
  const voided = tally.voided.map((action) => `; ${formatVoided(action)}`).join('');
  return `${tally.grant} (mark ${tally.mark}${tally.ref === null ? '' : `, ${tally.ref}`}): ${actions}${voided}`;
}

function formatVoided(action: VoidedGrantAction): string {
  return `~~${action.target} (${action.actor})~~ void act ${action.id}, ${action.voidedAt} by ${action.voidedBy}: ${action.voidReason}`;
}
