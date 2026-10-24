import type { RunResult } from '../src/runner/types.ts';
import { FAKE_BASE_SHA } from './noslop-fake.ts';

interface StubGateFacts {
  head: string;
  checks: unknown[];
}

export function buildStubGateFacts(facts: StubGateFacts): RunResult {
  return { code: 0, stdout: JSON.stringify({ headRefOid: facts.head, baseRefName: 'main', baseRefOid: FAKE_BASE_SHA, author: { login: 'zgeoff', is_bot: false }, statusCheckRollup: facts.checks }), stderr: '' };
}
