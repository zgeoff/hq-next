// A fake Runner for the noslop tests: answers 1Password, git, gh and the noslop CLI the way the real
// ones do, records every call, and never starts a process. All data here is invented.
import { realRunner } from '../src/runner/real-runner.ts';
import type { RunOpts, RunResult, Runner } from '../src/runner/types.ts';

interface FakeCall {
  cmd: string[];
  opts: RunOpts | undefined;
}

// secrets are the fields `op item get` prints as JSON; opAnswer, when set, is that call's whole result. author is the JSON that `gh pr view --json author` prints.
export interface FakeScript {
  secrets?: Record<string, string>;
  opAnswer?: RunResult;
  noslopReview?: RunResult;
  noslopHelp?: RunResult;

  // What `noslop store query` answers, called on each run; an empty success when absent.
  storeQuery?: () => RunResult;

  // What `pgrep -af` answers for noslop CLI processes; exit 1, none, when absent.
  pgrep?: RunResult;
  author?: string;
  prBody?: string;

  // What `gh pr view --json headRefOid` answers; the fixed full sha when absent.
  prHead?: RunResult;

  // What `gh pr view --json headRefOid,author,statusCheckRollup,baseRefName` answers: one passing CI check
  // on the fixed head, with the author above, when absent.
  prFacts?: RunResult;

  // What `gh api …/contents/.github/workflows?ref=<ref>` answers at the head, and at the base branch
  // `main` (the head's answer when baseWorkflows is absent): the folder is there when both are absent.
  workflows?: RunResult;
  baseWorkflows?: RunResult;

  // What `gh api …/contents/<path>?ref=<ref>` answers for a CODEOWNERS path, keyed `<path>?ref=<ref>`;
  // a 404 for any key it lacks.
  contents?: Record<string, RunResult>;

  // What `gh api repos/<slug>/commits/<sha> --silent` answers: the commit is readable when absent.
  baseCommit?: RunResult;

  // What `gh api --paginate …/pulls/<pr>/files` prints: a path a line, with a renamed file's old
  // path after a tab. One source file when absent.
  prFiles?: RunResult;

  // What `noslop findings --json` answers; no findings when absent.
  noslopFindings?: RunResult;

  // What the read of the PR's issue comments for noslop's summary marker prints, one compact JSON
  // object a line: one summary comment by the noslop App at the fixed full sha when absent.
  markerComments?: RunResult;

  // What the read of the check runs named `noslop` at a commit prints, one compact JSON object a
  // line: one completed, successful run by the noslop App, newer than the default summary, when absent.
  noslopChecks?: RunResult;

  // Run git for real, in the checkout the caller names, except `git remote get-url origin` and the
  // lines `git` answers: for a test on a real repo, with gh, op and noslop still faked.
  realGit?: boolean;
}

export interface FakeRunner {
  run: Runner;
  calls: FakeCall[];

  // Every call as one line, in order.
  lines: () => string[];

  // The calls of one program (op, bun, git, gh).
  of: (program: string) => FakeCall[];
}

export const FAKE_FULL_SHA = '0123456789abcdef0123456789abcdef01234567';
export const FAKE_BASE_SHA = 'ba5eba5eba5eba5eba5eba5eba5eba5eba5eba5e';
const NOT_FOUND: RunResult = { code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };

export const FAKE_REVIEW_JSON = JSON.stringify({
    version: 4,
    reviewID: 'r1',
    repo: 'zgeoff/widgets',
    pullRequest: 7,
    base: 'main',
    head: 'feat',
    depth: 'standard',
    findings: [{ id: '00112233445566aa', lens: 'correctness', severity: 'high', title: 'Kettle never boils' }],
    failedCalls: [],
});

export const FAKE_SECRETS: Record<string, string> = {
  'app-id': 'app-4711',
  'installation-id': 'inst-8842',
  'private-key': '-----BEGIN KEY-----\nbadger-secret-key\n-----END KEY-----',
};

export const FAKE_TOKEN = 'ops_kettle-token-0042';

function buildResult(stdout: string, code = 0, stderr = ''): RunResult {
  return { code, stdout, stderr };
}

function pickOpAnswer(script: FakeScript): RunResult {
  const secrets = script.secrets ?? FAKE_SECRETS;
  return script.opAnswer ?? buildResult(JSON.stringify(Object.entries(secrets).map(([label, value]) => ({ id: label, type: 'CONCEALED', label, value }))));
}

function pickBunAnswer(script: FakeScript, cmd: string[]): RunResult {
  if (cmd[3] === 'findings') {
    return script.noslopFindings ?? buildResult(JSON.stringify({ findings: [] }));
  }
  if (cmd[3] === 'store') {
    return script.storeQuery?.() ?? buildResult('[]');
  }
  if (cmd[4] === '--help') {
    return script.noslopHelp ?? buildResult('  --pr <pr>   Review a pull request\n');
  }
  return script.noslopReview ?? buildResult(FAKE_REVIEW_JSON);
}

// oxlint-disable-next-line zgeoff/module-order -- grandfathered: helpers sit above the factory
function pickGhAnswer(script: FakeScript, line: string): RunResult | null {
  if (line.includes('--json headRefName,baseRefName')) {
    return buildResult(JSON.stringify({ headRefName: 'feat', baseRefName: 'main', body: script.prBody ?? '' }));
  }
  if (line.endsWith('--json baseRefName')) {
    return buildResult(JSON.stringify({ baseRefName: 'main' }));
  }
  if (line.includes('--json headRefName,headRefOid,baseRefName')) {
    return buildResult(JSON.stringify({ headRefName: 'feat', headRefOid: FAKE_FULL_SHA, baseRefName: 'main' }));
  }
  if (line.includes('--json headRefOid,author,statusCheckRollup')) {
    return script.prFacts ?? buildResult(JSON.stringify({ headRefOid: FAKE_FULL_SHA, baseRefName: 'main', baseRefOid: FAKE_BASE_SHA, author: JSON.parse(script.author ?? '{"author":{"login":"zgeoff","is_bot":false}}').author, statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }] }));
  }
  if (line.includes('--json headRefOid')) {
    return script.prHead ?? buildResult(JSON.stringify({ headRefOid: FAKE_FULL_SHA }));
  }
  if (line.includes('--json author')) {
    return buildResult(script.author ?? '{"author":{"login":"zgeoff","is_bot":false}}');
  }
  if (line.includes('--json name,state,bucket')) {
    return buildResult('[{"name":"test","state":"SUCCESS","bucket":"pass"}]');
  }
  if (line.startsWith('gh api repos/') && line.includes('/contents/.github/workflows?ref=')) {
    return (line.includes('?ref=main ') ? script.baseWorkflows : undefined) ?? script.workflows ?? buildResult('');
  }
  if (line.startsWith('gh api repos/') && line.includes('/contents/') && !line.includes('/contents/.github/workflows')) {
    return script.contents?.[line.replace(/^gh api repos\/[^/]+\/[^/]+\/contents\//u, '')] ?? NOT_FOUND;
  }
  if (line.startsWith('gh api --paginate repos/') && line.includes('/files?')) {
    return script.prFiles ?? buildResult('src/kettle.ts\n');
  }
  if (line.startsWith('gh api repos/') && line.includes('/issues/') && line.includes('/comments --paginate') && line.includes('user.login')) {
    return script.markerComments ?? buildResult(`${JSON.stringify({ login: 'noslop-review[bot]', body: `<!-- noslop:summary {"head":"${FAKE_FULL_SHA}","reviews":1} -->`, updatedAt: '2026-10-14T01:00:00Z' })}\n`);
  }
  if (line.startsWith('gh api repos/') && line.includes('/check-runs?check_name=noslop')) {
    return script.noslopChecks ?? buildResult(`${JSON.stringify({ id: 9001, name: 'noslop', app: 'noslop-review', status: 'completed', conclusion: 'success', title: 'No findings need attention.', completedAt: '2026-10-14T01:00:05Z' })}\n`);
  }
  if (/^gh api repos\/[^/]+\/[^/]+\/commits\/[0-9a-f]+ --silent$/u.test(line)) {
    return script.baseCommit ?? buildResult('');
  }
  if (line.startsWith('gh api graphql')) {
    return buildResult('1\n');
  }
  return null;
}

// oxlint-disable-next-line zgeoff/module-order -- grandfathered: helpers sit above the factory
function pickAnswer(script: FakeScript, cmd: string[]): RunResult {
  const line = cmd.join(' ');
  if (cmd[0] === 'op') {
    return pickOpAnswer(script);
  }
  if (cmd[0] === 'pgrep') {
    return script.pgrep ?? buildResult('', 1);
  }
  if (cmd[0] === 'bun') {
    return pickBunAnswer(script, cmd);
  }
  if (line === 'git remote get-url origin') {
    return buildResult('git@github.com:zgeoff/widgets.git\n');
  }
  if (line === 'git rev-parse HEAD' || line === 'git rev-parse FETCH_HEAD') {
    return buildResult(`${FAKE_FULL_SHA}\n`);
  }
  if (cmd[1] === 'rev-list' && cmd[2] === '--parents') {
    // A commit the fake knows no parents of, so a non-merge.
    return buildResult(`${cmd[5] ?? ''}\n`);
  }
  if (cmd[1] === 'rev-parse' && cmd[2] === '--verify') {
    return buildResult(`${expandSha((cmd[3] ?? '').replace('^{commit}', ''))}\n`);
  }
  return pickGhAnswer(script, line) ?? buildResult('');
}

// The full sha a short one names: the fixed full sha when it is a prefix of it, else the short one padded.
function expandSha(short: string): string {
  return FAKE_FULL_SHA.startsWith(short) ? FAKE_FULL_SHA : short.padEnd(40, '0');
}

function isRealGit(script: FakeScript, cmd: string[]): boolean {
  const line = cmd.join(' ');
  return script.realGit === true && cmd[0] === 'git' && line !== 'git remote get-url origin';
}

export function buildFakeRunner(script: FakeScript = {}): FakeRunner {
  const calls: FakeCall[] = [],
    run: Runner = (cmd, opts) => {
      calls.push({ cmd, opts });
      return isRealGit(script, cmd) ? realRunner(cmd, opts) : Promise.resolve(pickAnswer(script, cmd));
    };
  return { run, calls, lines: () => calls.map((c) => c.cmd.join(' ')), of: (program) => calls.filter((c) => c.cmd[0] === program) };
}
