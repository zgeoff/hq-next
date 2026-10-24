import type { GrantActMove, GrantActState } from './types.ts';

export const GRANT_ACT_TRANSITIONS: Record<GrantActMove, { from: readonly GrantActState[]; to: GrantActState }> = {
  'grant-void': { from: ['live'], to: 'void' },
};
