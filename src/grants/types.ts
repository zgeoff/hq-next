export interface GrantAction {
  id: number;
  grant_name: string;
  target: string;
  note: string | null;
  actor: string;
  at: string;
}

// A stored action as the void columns carry it: all three NULL while the action stands.
export interface GrantActionRow extends GrantAction {
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
}

// An action taken back, with when, by whom and why.
export interface VoidedGrantAction {
  id: number;
  target: string;
  note: string | null;
  actor: string;
  at: string;
  voidedAt: string;
  voidedBy: string;
  voidReason: string;
}

export interface GrantActionInput {
  grant: string;
  target: string;
  note: string | null;
  actor: string;
}

// One named grant and the actions taken under it in a window, none included. Voided actions are
// listed apart and never counted.
export interface GrantTally {
  grant: string;
  mark: number;
  text: string;
  ref: string | null;
  actions: GrantAction[];
  voided: VoidedGrantAction[];
}

export interface GrantMarkInput {
  text: string;
  ref: string | null;
  at: string | null;
  name: string;
  actor: string;
}

export interface GrantNaming {
  id: number;
  name: string;
  actor: string;
}

export interface GrantWindow {
  from: string;
  to: string;
}

export interface GrantVoidArgs {
  id: number;
  reason: string;
}

export type GrantVoidCaller = { kind: 'session'; id: string } | { kind: 'unknown'; cause: string };

// A logged grant act is live until it is voided, and a void act stays void.
export type GrantActState = 'live' | 'void';

export type GrantActMove = 'grant-void';
