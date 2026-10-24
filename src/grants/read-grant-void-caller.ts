import type { OwnerProbeDeps } from '../pr-status/read-owner-session.ts';
import type { GrantVoidCaller } from './types.ts';

// Only the caller's session as atc's daemon found it from the kernel counts: never --by, HQ_AS or
// ATC_SESSION_ID, which are the caller's own words.
export async function readGrantVoidCaller(deps: OwnerProbeDeps): Promise<GrantVoidCaller> {
  try {
    const client = await deps.openClient();
    try {
      return toCaller(client.peerSession);
    } finally {
      client.close();
    }
  } catch (error) {
    return { kind: 'unknown', cause: error instanceof Error ? error.message : String(error) };
  }
}

function toCaller(peerSession: string | null | undefined): GrantVoidCaller {
  if (peerSession === undefined) {
    return { kind: 'unknown', cause: "atc's hello names no caller session, so this daemon predates protocol 11 and cannot say who is asking" };
  }
  if (peerSession === null || peerSession === '') {
    return { kind: 'unknown', cause: 'atc found no session for the caller' };
  }
  return { kind: 'session', id: peerSession };
}
