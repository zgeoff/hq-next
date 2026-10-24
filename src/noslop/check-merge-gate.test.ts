import { expect, onTestFinished, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStubFindings } from '../../test/build-stub-findings.ts';
import { buildStubGateFacts } from '../../test/build-stub-gate-facts.ts';
import { buildStubPRHead } from '../../test/build-stub-pr-head.ts';
import { createStubPRRepo } from '../../test/create-stub-pr-repo.ts';
import { createListedReview } from '../../test/create-listed-review.ts';
import { FAKE_BASE_SHA, FAKE_FULL_SHA, FAKE_TOKEN, buildFakeRunner } from '../../test/noslop-fake.ts';
import { overrideEnv } from '../config/override-env.ts';
import { openDb } from '../db/open-db.ts';
import { setMeta } from '../db/set-meta.ts';
import { logEvent } from '../log-event.ts';
import { recordPRExemption } from '../pr-status/record-pr-exemption.ts';
import { recordPRMechanical } from '../pr-status/record-pr-mechanical.ts';
import { recordPRAcceptedRisk } from '../pr-status/record-pr-accepted-risk.ts';
import { recordPRAnswer } from '../pr-status/record-pr-answer.ts';
import { recordPROverride } from '../pr-status/record-pr-override.ts';
import { checkMergeGate } from './check-merge-gate.ts';

function setupTest() {
  const base = mkdtempSync(join(tmpdir(), 'hq-review-noslop-')),
    db = openDb(join(base, 'hq.db'));

  onTestFinished(() => {
    db.close();
    rmSync(base, { recursive: true, force: true });
  });
  writeFileSync(join(base, 'settings.json'), JSON.stringify({ env: { OP_SERVICE_ACCOUNT_TOKEN: FAKE_TOKEN } }));
  onTestFinished(overrideEnv('HQ_NOSLOP_OP_SETTINGS', join(base, 'settings.json')));
  onTestFinished(overrideEnv('REVIEW_DIR', base));
  onTestFinished(overrideEnv('HQ_PROJECTS', join(base, 'projects')));
  onTestFinished(overrideEnv('HQ_REPOS', join(base, 'repos')));

  return { base, db };
}

test("it passes when noslop's last review read the head, no finding is open and CI is green", async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ noslopFindings: buildStubFindings('fixed'), markerComments: { code: 0, stdout: `${JSON.stringify({ login: 'noslop-review[bot]', body: `<!-- noslop:summary {"head":"${FAKE_FULL_SHA}"} -->`, updatedAt: '2026-10-14T01:00:00Z' })}\n`, stderr: '' } });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).resolves.toStrictEqual({ mayMerge: true, reason: 'noslop findings: none open; CI green at 0123456', reviewed: true });
});

test("it blocks a fixed answer noslop has not read, when hq recorded a review at the head but noslop's last review read an older one", async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ noslopFindings: buildStubFindings('fixed'), markerComments: { code: 0, stdout: `${JSON.stringify({ login: 'noslop-review[bot]', body: '<!-- noslop:summary {"head":"f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed"} -->', updatedAt: '2026-10-14T01:00:00Z' })}\n`, stderr: '' } });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: 'noslop has not reviewed head 0123456 (its last review read f00dfee); run hq review widgets 7' });
});

test('it blocks when a fix-checks-only run past the emergency cap checked no fix and left noslop on the older head', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ noslopFindings: buildStubFindings('fixed'), markerComments: { code: 0, stdout: `${JSON.stringify({ login: 'noslop-review[bot]', body: '<!-- noslop:summary {"head":"f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed"} -->', updatedAt: '2026-10-14T01:00:00Z' })}\n`, stderr: '' } });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: 'f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed' });
  setMeta(ctx.db, 'noslop', JSON.stringify({ repos: ['widgets'], sha: '0123456789abcdef0123456789abcdef01234567', caps: { widgets: 1 } }));
  ctx.db.query("INSERT INTO noslop_rounds (repo, pr, kind, started_at, ended_at, ms, ok, head, depth, special, findings, sha, confirm) VALUES ('widgets', 7, 'review', 'a', 'b', 1, 1, ?, 'standard', 'none', '[]', 'x', 1)").run(FAKE_FULL_SHA);

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: 'noslop has not reviewed head 0123456 (its last review read f00dfee); run hq review widgets 7' });
});

test('it blocks when a hand-run fix-checks-only run read the new head and noslop is on the older head', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ noslopFindings: buildStubFindings('fixed'), markerComments: { code: 0, stdout: `${JSON.stringify({ login: 'noslop-review[bot]', body: '<!-- noslop:summary {"head":"f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed"} -->', updatedAt: '2026-10-14T01:00:00Z' })}\n`, stderr: '' } });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: 'f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed' });
  ctx.db.query("INSERT INTO noslop_rounds (repo, pr, kind, started_at, ended_at, ms, ok, head, depth, special, findings, sha, confirm) VALUES ('widgets', 7, 'review', 'a', 'b', 1, 1, ?, 'standard', 'none', '[]', 'x', 1)").run(FAKE_FULL_SHA);

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: 'noslop has not reviewed head 0123456 (its last review read f00dfee); run hq review widgets 7' });
});

test.each([
  ['no summary comment', 'The kettle looks fine.', 'noslop has posted no review summary on the PR, so no pass: hq review widgets 7'],
  ['a null summary marker', '<!-- noslop:summary null -->', "hq cannot read the head in noslop's summary marker on the PR, so no pass: hq review widgets 7"],
  ['a summary marker that does not parse', '<!-- noslop:summary {"head": -->', "hq cannot read the head in noslop's summary marker on the PR, so no pass: hq review widgets 7"],
])('it blocks a PR with %s, though hq recorded a review at the head', async (_label, body, message) => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ markerComments: { code: 0, stdout: `${JSON.stringify({ login: 'noslop-review[bot]', body, updatedAt: '2026-10-14T01:00:00Z' })}\n`, stderr: '' } });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message });
});

test('it passes open findings under an override at the head when noslop never reviewed the PR', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ noslopFindings: buildStubFindings('open'), markerComments: { code: 0, stdout: '', stderr: '' } });
  setMeta(ctx.db, 'noslop', JSON.stringify({ repos: ['widgets'], sha: '0123456789abcdef0123456789abcdef01234567' }));
  recordPROverride(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA, source: 'call:KET-2', note: 'Ship the kettle.', actor: 'z-kettle' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).resolves.toStrictEqual({ mayMerge: true, reason: "The owner's override at 0123456 (call:KET-2) stands for 1 open finding: aaaa", reviewed: true });
});

test("it passes under an override at the head when noslop's findings list is empty but its reviews recorded findings", async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner();
  setMeta(ctx.db, 'noslop', JSON.stringify({ repos: ['widgets'], sha: '0123456789abcdef0123456789abcdef01234567' }));
  ctx.db.query("INSERT INTO noslop_rounds (repo, pr, kind, started_at, ended_at, ms, ok, head, depth, special, findings, sha, confirm) VALUES ('widgets', 7, 'review', 'a', 'b', 1, 1, ?, 'standard', 'none', ?, 'x', 0)").run(FAKE_FULL_SHA, '[{"id":"aaaa","lens":"correctness","severity":"high","title":"Kettle never boils"}]');
  recordPROverride(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA, source: 'call:KET-2', note: 'Ship the kettle.', actor: 'z-kettle' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).resolves.toStrictEqual({ mayMerge: true, reason: "The owner's override at 0123456 (call:KET-2) stands; CI green at 0123456", reviewed: true });
});

test('it blocks under an override at an older head when noslop never reviewed the PR', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ markerComments: { code: 0, stdout: '', stderr: '' } });
  setMeta(ctx.db, 'noslop', JSON.stringify({ repos: ['widgets'], sha: '0123456789abcdef0123456789abcdef01234567' }));
  recordPROverride(ctx.db, { repo: 'widgets', pr: 7, head: 'f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed', source: 'call:KET-2', note: 'Ship the kettle.', actor: 'z-kettle' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: 'noslop has posted no review summary on the PR, so no pass: hq review widgets 7' });
});

test("it blocks when noslop's findings list is empty but the full review at the head recorded findings", async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner();
  setMeta(ctx.db, 'noslop', JSON.stringify({ repos: ['widgets'], sha: '0123456789abcdef0123456789abcdef01234567' }));
  ctx.db.query("INSERT INTO noslop_rounds (repo, pr, kind, started_at, ended_at, ms, ok, head, depth, special, findings, sha, confirm) VALUES ('widgets', 7, 'review', 'a', 'b', 1, 1, ?, 'standard', 'none', ?, 'x', 0)").run(FAKE_FULL_SHA, '[{"id":"aaaa","lens":"correctness","severity":"high","title":"Kettle never boils"},{"id":"bbbb","lens":"tests","severity":"P2","title":"Lid untested"}]');

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: "noslop's findings list is empty, but its reviews of this PR recorded 2 findings, so no pass" });
});

test("it blocks when noslop's findings list is empty but an older round recorded findings and the round at the head recorded none", async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner();
  setMeta(ctx.db, 'noslop', JSON.stringify({ repos: ['widgets'], sha: '0123456789abcdef0123456789abcdef01234567' }));
  ctx.db.query("INSERT INTO noslop_rounds (repo, pr, kind, started_at, ended_at, ms, ok, head, depth, special, findings, sha, confirm) VALUES ('widgets', 7, 'review', 'a', 'b', 1, 1, 'f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed', 'standard', 'none', ?, 'x', 0)").run('[{"id":"aaaa","lens":"correctness","severity":"P1","title":"Kettle never boils"},{"id":"bbbb","lens":"tests","severity":"P2","title":"Lid untested"},{"id":"cccc","lens":"intent","severity":"P2","title":"Spout points inward"}]');
  ctx.db.query("INSERT INTO noslop_rounds (repo, pr, kind, started_at, ended_at, ms, ok, head, depth, special, findings, sha, confirm) VALUES ('widgets', 7, 'review', 'a', 'b', 1, 1, ?, 'standard', 'none', '[]', 'x', 0)").run(FAKE_FULL_SHA);

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: "noslop's findings list is empty, but its reviews of this PR recorded 3 findings, so no pass" });
});

test('it tells the head it read to the caller', async () => {
  const ctx = setupTest(),
    fake = buildFakeRunner(),
    heads: string[] = [];
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 }, (head) => heads.push(head));

  expect(heads).toStrictEqual([FAKE_FULL_SHA]);
});

test('it blocks a PR with an open finding, naming it', async () => {
  const ctx = setupTest(),
    fake = buildFakeRunner({ noslopFindings: buildStubFindings('open') });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: '1 noslop finding is open: aaaa' });
});

test.each(['fixed', 'not-a-defect', 'deferred'])('it passes a finding in state %s', async (state) => {
  const ctx = setupTest(),
    fake = buildFakeRunner({ noslopFindings: buildStubFindings(state) });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).resolves.toMatchObject({ mayMerge: true });
});

test('it keeps an accepted-risk finding open when the reply is by zgeoff but hq holds no owner record', async () => {
  const ctx = setupTest(),
    fake = buildFakeRunner({ noslopFindings: buildStubFindings('accepted-risk') });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: '1 noslop finding is open: aaaa' });
});

test('it passes an accepted-risk finding the owner accepted in hq', async () => {
  const ctx = setupTest(),
    fake = buildFakeRunner({ noslopFindings: buildStubFindings('accepted-risk') });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });
  recordPRAcceptedRisk(ctx.db, { repo: 'widgets', pr: 7, finding: 'aaaa', source: 'call:KET-1', note: 'The lid is cosmetic.', actor: 'z-kettle' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).resolves.toMatchObject({ mayMerge: true });
});

test('it ignores a record of accepted risk whose source is not an owner source', async () => {
  const ctx = setupTest(),
    fake = buildFakeRunner({ noslopFindings: buildStubFindings('accepted-risk') });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });
  logEvent(ctx.db, 'hq', 'pr:widgets#7', 'pr-accepted-risk', 'z-kettle', null, null, { finding: 'aaaa', source: 'session:z-teapot', note: 'Fine.' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked' });
});

test('it passes open findings under an override at the head it read', async () => {
  const ctx = setupTest(),
    fake = buildFakeRunner({ noslopFindings: buildStubFindings('open') });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });
  recordPROverride(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA, source: 'call:KET-2', note: 'Ship the kettle.', actor: 'z-kettle' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).resolves.toMatchObject({ mayMerge: true, reason: expect.stringContaining("The owner's override at 0123456 (call:KET-2) stands for 1 open finding: aaaa") });
});

test('it blocks open findings under an override logged before 0.80.0 at the head it read', async () => {
  const ctx = setupTest(),
    fake = buildFakeRunner({ noslopFindings: buildStubFindings('open') });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });
  logEvent(ctx.db, 'hq', 'pr:widgets#7', 'pr-override', 'z-kettle', null, null, { head: FAKE_FULL_SHA, source: 'call:KET-2', note: 'Ship the kettle.' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: '1 noslop finding is open: aaaa' });
});

test('it blocks open findings once the PR has a new head after the override', async () => {
  const ctx = setupTest(),
    fake = buildFakeRunner({ noslopFindings: buildStubFindings('open'), prFacts: buildStubGateFacts({ head: 'f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed', checks: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }] }), prHead: { code: 0, stdout: JSON.stringify({ headRefOid: 'f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed' }), stderr: '' }, markerComments: { code: 0, stdout: `${JSON.stringify({ login: 'noslop-review[bot]', body: '<!-- noslop:summary {"head":"f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed"} -->', updatedAt: '2026-10-14T01:00:00Z' })}\n`, stderr: '' } });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });
  recordPROverride(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA, source: 'call:KET-2', note: 'Ship the kettle.', actor: 'z-kettle' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: '1 noslop finding is open: aaaa' });
});

test('it refuses an override whose source is a session', async () => {
  const ctx = setupTest(),
    fake = buildFakeRunner({ noslopFindings: buildStubFindings('open') });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });
  recordPROverride(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA, source: 'session:z-teapot', note: 'Trust me.', actor: 'z-teapot' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: '1 noslop finding is open: aaaa' });
});

test("it leaves a failing noslop check in the CI rollup to the noslop route, which reads noslop's own run by app", async () => {
  const ctx = setupTest(),
    fake = buildFakeRunner({ prFacts: buildStubGateFacts({ head: FAKE_FULL_SHA, checks: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }, { __typename: 'CheckRun', name: 'noslop', status: 'COMPLETED', conclusion: 'FAILURE' }] }) });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).resolves.toMatchObject({ mayMerge: true });
});

test("it blocks a head whose summary noslop moved there though its review calls failed, when noslop's check failed", async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ noslopFindings: buildStubFindings('fixed'), noslopChecks: { code: 0, stdout: `${JSON.stringify({ id: 9001, name: 'noslop', app: 'noslop-review', status: 'completed', conclusion: 'failure', title: '3 review calls failed.', completedAt: '2026-10-14T01:00:05Z' })}\n`, stderr: '' } });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: "noslop's check at 0123456 is failure: 3 review calls failed." });
});

test("it blocks a passing noslop check that completed before noslop last edited its summary", async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ noslopFindings: buildStubFindings('fixed'), markerComments: { code: 0, stdout: `${JSON.stringify({ login: 'noslop-review[bot]', body: `<!-- noslop:summary {"head":"${FAKE_FULL_SHA}"} -->`, updatedAt: '2026-10-14T02:00:00Z' })}\n`, stderr: '' } });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: "noslop's check at 0123456 predates its latest summary, so it does not judge that review; rerun hq review widgets 7" });
});

test("it blocks a head whose summary holds a rejected merge resolution, when noslop's check failed", async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ noslopChecks: { code: 0, stdout: `${JSON.stringify({ id: 9001, name: 'noslop', app: 'noslop-review', status: 'completed', conclusion: 'failure', title: 'The merge resolution was rejected.', completedAt: '2026-10-14T01:00:05Z' })}\n`, stderr: '' } });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: "noslop's check at 0123456 is failure: The merge resolution was rejected." });
});

test("it blocks when a workflow job named noslop passed but the noslop App's own run failed", async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ noslopChecks: { code: 0, stdout: [JSON.stringify({ id: 9002, name: 'noslop', app: 'github-actions', status: 'completed', conclusion: 'success', title: null, completedAt: null }), JSON.stringify({ id: 9001, name: 'noslop', app: 'noslop-review', status: 'completed', conclusion: 'failure', title: '1 finding is open.', completedAt: '2026-10-14T01:00:05Z' })].join('\n'), stderr: '' } });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: "noslop's check at 0123456 is failure: 1 finding is open." });
});

test('it blocks when only a workflow job named noslop ran at the head and the noslop App has no run there', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ noslopChecks: { code: 0, stdout: `${JSON.stringify({ id: 9002, name: 'noslop', app: 'github-actions', status: 'completed', conclusion: 'success', title: null, completedAt: null })}\n`, stderr: '' } });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: 'noslop has no check at 0123456, so no pass: hq review widgets 7' });
});

test("it blocks while noslop's check at the head is still running", async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ noslopChecks: { code: 0, stdout: `${JSON.stringify({ id: 9001, name: 'noslop', app: 'noslop-review', status: 'in_progress', conclusion: null, title: null, completedAt: null })}\n`, stderr: '' } });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: "noslop's check at 0123456 is in_progress, so no pass: wait for it to finish" });
});

test("it blocks when hq cannot read noslop's check at the head", async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ noslopChecks: { code: 1, stdout: '', stderr: 'HTTP 502: kettle gateway' } });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: 'gh cannot read the check runs at 0123456 (HTTP 502: kettle gateway), so no pass: hq review widgets 7' });
});

test("it passes when noslop's newest check at the head succeeded after an older run failed, its summary is at the head and no finding is open", async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ noslopFindings: buildStubFindings('fixed'), noslopChecks: { code: 0, stdout: [JSON.stringify({ id: 9003, name: 'noslop', app: 'noslop-review', status: 'completed', conclusion: 'success', title: 'No findings need attention.', completedAt: '2026-10-14T01:00:05Z' }), JSON.stringify({ id: 9001, name: 'noslop', app: 'noslop-review', status: 'completed', conclusion: 'failure', title: '1 finding is open.', completedAt: '2026-10-14T01:00:05Z' })].join('\n'), stderr: '' } });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).resolves.toStrictEqual({ mayMerge: true, reason: 'noslop findings: none open; CI green at 0123456', reviewed: true });
});

test("it passes an override at the head though noslop's check there failed", async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ noslopFindings: buildStubFindings('open'), noslopChecks: { code: 0, stdout: `${JSON.stringify({ id: 9001, name: 'noslop', app: 'noslop-review', status: 'completed', conclusion: 'failure', title: '1 finding is open.', completedAt: '2026-10-14T01:00:05Z' })}\n`, stderr: '' } });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });
  recordPROverride(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA, source: 'call:KET-2', note: 'Ship the kettle.', actor: 'z-kettle' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).resolves.toStrictEqual({ mayMerge: true, reason: "The owner's override at 0123456 (call:KET-2) stands for 1 open finding: aaaa", reviewed: true });
});

test.each([
  ['failing', { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }, 'CI is not green: test (FAILURE)'],
  ['pending', { __typename: 'CheckRun', name: 'test', status: 'IN_PROGRESS', conclusion: null }, 'CI is not green: test (IN_PROGRESS)'],
  ['cancelled', { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'CANCELLED' }, 'CI is not green: test (CANCELLED)'],
  ['status context failing', { __typename: 'StatusContext', context: 'socket', state: 'FAILURE' }, 'CI is not green: socket (FAILURE)'],
])('it blocks a PR with %s CI', async (_label, check, message) => {
  const ctx = setupTest(),
    fake = buildFakeRunner({ prFacts: buildStubGateFacts({ head: FAKE_FULL_SHA, checks: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }, check] }) });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message });
});

test.each([
  ['a skipped check run', { __typename: 'CheckRun', name: 'kettle', status: 'COMPLETED', conclusion: 'SKIPPED' }],
  ['a neutral check run', { __typename: 'CheckRun', name: 'kettle', status: 'COMPLETED', conclusion: 'NEUTRAL' }],
  ['a passing status context', { __typename: 'StatusContext', context: 'teapot', state: 'SUCCESS' }],
])('it lets a PR merge beside %s', async (_label, check) => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFacts: buildStubGateFacts({ head: FAKE_FULL_SHA, checks: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }, check] }) });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).resolves.toStrictEqual({ mayMerge: true, reason: `noslop findings: none open; CI green at ${FAKE_FULL_SHA.slice(0, 7)}`, reviewed: true });
});

test('it blocks a PR whose rollup is empty', async () => {
  const ctx = setupTest(),
    fake = buildFakeRunner({ prFacts: buildStubGateFacts({ head: FAKE_FULL_SHA, checks: [] }) });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: 'the head has no CI checks, so CI has not passed' });
});

test('it lets a PR with no checks merge when GitHub says the head holds no workflows', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFacts: buildStubGateFacts({ head: FAKE_FULL_SHA, checks: [] }), workflows: { code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).resolves.toStrictEqual({ mayMerge: true, reason: `not a noslop repo: green CI is enough; the repo runs no CI at ${FAKE_FULL_SHA.slice(0, 7)}`, reviewed: false });
  expect(fake.lines()).toContain(`gh api repos/zgeoff/widgets/contents/.github/workflows?ref=${FAKE_FULL_SHA} --silent`);
  expect(fake.lines()).toContain('gh api repos/zgeoff/widgets/contents/.github/workflows?ref=main --silent');
});

test.each([
  ['the folder is there', { code: 0, stdout: '', stderr: '' }],
  ['GitHub cannot find the head', { code: 1, stdout: '', stderr: `gh: No commit found for the ref ${FAKE_FULL_SHA} (HTTP 404)` }],
  ['the read fails', { code: 1, stdout: '', stderr: 'gh: Server Error (HTTP 502)' }],
])('it blocks a PR with no checks when %s', async (_label, workflows) => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFacts: buildStubGateFacts({ head: FAKE_FULL_SHA, checks: [] }), workflows });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: 'the head has no CI checks, so CI has not passed' });
});

test('it blocks a PR with no checks that deletes the workflows its base branch holds', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFacts: buildStubGateFacts({ head: FAKE_FULL_SHA, checks: [] }), workflows: { code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' }, baseWorkflows: { code: 0, stdout: '', stderr: '' } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: 'the head has no CI checks, so CI has not passed' });
  expect(fake.lines()).toContain('gh api repos/zgeoff/widgets/contents/.github/workflows?ref=main --silent');
});

test('it never reads the workflows when the head has checks', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFacts: buildStubGateFacts({ head: FAKE_FULL_SHA, checks: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }] }), workflows: { code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: 'CI is not green: test (FAILURE)' });
  expect(fake.lines().filter((line) => line.includes('/contents/.github/workflows'))).toStrictEqual([]);
});

test('it never lets an override pass red CI', async () => {
  const ctx = setupTest(),
    fake = buildFakeRunner({ noslopFindings: buildStubFindings('open'), prFacts: buildStubGateFacts({ head: FAKE_FULL_SHA, checks: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }] }) });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });
  recordPROverride(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA, source: 'call:KET-2', note: 'Ship the kettle.', actor: 'z-kettle' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: 'CI is not green: test (FAILURE)' });
});

test('it blocks a PR when GitHub gives no facts', async () => {
  const ctx = setupTest(),
    fake = buildFakeRunner({ prFacts: { code: 1, stdout: '', stderr: 'gh: could not resolve to a PullRequest' } });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining('could not resolve to a PullRequest') });
});

test('it blocks a PR when the findings read fails', async () => {
  const ctx = setupTest(),
    fake = buildFakeRunner({ noslopFindings: { code: 1, stdout: '', stderr: 'noslop: boom' } });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining("could not read noslop's findings, so no pass") });
});

test('it tells a noslop with no findings command to pin a newer one', async () => {
  const ctx = setupTest(),
    fake = buildFakeRunner({ noslopFindings: { code: 1, stdout: '', stderr: 'error: unknown command findings' } });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ message: expect.stringContaining('pin noslop 0.4.15 or later') });
});

test('it reads the findings of a noslop that exits 0 with a warning that holds the word unrecognized', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ noslopFindings: { code: 0, stdout: JSON.stringify({ findings: [] }), stderr: 'warning: unrecognized kettle setting ignored' } });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).resolves.toMatchObject({ mayMerge: true, reviewed: true });
});

test('it blocks a PR whose findings output does not fit', async () => {
  const ctx = setupTest(),
    fake = buildFakeRunner({ noslopFindings: { code: 0, stdout: '{"findings":[{"id":"aaaa","state":"mystery"}]}', stderr: '' } });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining('no pass') });
});

test('it blocks a PR whose head moved while the gate ran', async () => {
  const ctx = setupTest(),
    fake = buildFakeRunner({ prHead: { code: 0, stdout: JSON.stringify({ headRefOid: 'f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed' }), stderr: '' } });
  createListedReview(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining('head moved') });
});

test('it lets a PR of a repo off the noslop list merge on green CI alone', async () => {
  const ctx = setupTest(),
    fake = buildFakeRunner();

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).resolves.toStrictEqual({ mayMerge: true, reason: 'not a noslop repo: green CI is enough', reviewed: false });

  expect(fake.of('bun')).toStrictEqual([]);
});

test('it blocks a PR of a repo off the noslop list when CI is red', async () => {
  const ctx = setupTest(),
    fake = buildFakeRunner({ prFacts: buildStubGateFacts({ head: FAKE_FULL_SHA, checks: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' }] }) });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: 'CI is not green: test (FAILURE)' });
});

test.each([
  ['an is_bot author', '{"author":{"login":"renovate","is_bot":true}}'],
  ['a [bot] login', '{"author":{"login":"dependabot[bot]","is_bot":false}}'],
  ['an app/ login', '{"author":{"login":"app/renovate"}}'],
])('it lets a bot PR merge on %s without reading findings', async (_label, author) => {
  const ctx = setupTest(),
    fake = buildFakeRunner({ author });
  setMeta(ctx.db, 'noslop', JSON.stringify({ repos: ['widgets'], sha: '0123456789abcdef0123456789abcdef01234567' }));

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).resolves.toStrictEqual({ mayMerge: true, reason: 'bot PR: green CI is enough', reviewed: false });

  expect(fake.of('bun')).toStrictEqual([]);
});

test('it gates a listed repo\'s PR on noslop though a Codex review file of the PR exists', async () => {
  const ctx = setupTest(),
    fake = buildFakeRunner({ noslopFindings: buildStubFindings('open') });
  setMeta(ctx.db, 'noslop', JSON.stringify({ repos: ['widgets'], sha: '0123456789abcdef0123456789abcdef01234567' }));
  writeFileSync(join(ctx.base, 'widgets7-review.md'), 'No findings.\n');

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked' });
});

test('it refuses a PR in hq that changes a skill with no lgtm at its head, naming the file', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'src/kettle.ts\nskills/kettle/SKILL.md\n', stderr: '' } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: "the PR changes owner-held files (skills/kettle/SKILL.md) and needs the owner's lgtm at 0123456: hq pr answer hq 7 lgtm --source <where the owner said it>" });
});

test("it passes a PR that changes owner-held files once the owner's chat lgtm is recorded at its head", async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'skills/kettle/SKILL.md\n', stderr: '' } });
  recordPRAnswer(ctx.db, { repo: 'hq', pr: 7, answer: 'lgtm', head: FAKE_FULL_SHA, source: 'chat:kettle-1', note: null, actor: 'z-kettle' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).resolves.toMatchObject({ mayMerge: true });
});

test('it refuses an lgtm at an older head', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'skills/kettle/SKILL.md\n', stderr: '' } });
  recordPRAnswer(ctx.db, { repo: 'hq', pr: 7, answer: 'lgtm', head: 'f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed', source: 'console:kettle-2', note: null, actor: 'z-kettle' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining("needs the owner's lgtm at 0123456") });
});

test('it refuses an lgtm at the head that a later changes at the head took back', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'fleet.json\n', stderr: '' } });
  recordPRAnswer(ctx.db, { repo: 'hq', pr: 7, answer: 'lgtm', head: FAKE_FULL_SHA, source: 'console:kettle-2', note: null, actor: 'z-kettle' });
  recordPRAnswer(ctx.db, { repo: 'hq', pr: 7, answer: 'changes', head: FAKE_FULL_SHA, source: 'call:kettle-3', note: 'Descale it first.', actor: 'z-kettle' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining('owner-held files (fleet.json)') });
});

test("it passes a PR in hq that changes a skill once the owner's console lgtm is at its head", async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'skills/kettle/SKILL.md\n', stderr: '' } });
  recordPRAnswer(ctx.db, { repo: 'hq', pr: 7, answer: 'lgtm', head: FAKE_FULL_SHA, source: 'console:kettle-2', note: null, actor: 'z-kettle' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).resolves.toStrictEqual({ mayMerge: true, reason: 'not a noslop repo: green CI is enough', reviewed: false });
});

test('it holds a noslop-reviewed PR in hq to the same lgtm', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'skills/kettle/SKILL.md\n', stderr: '' } });
  createListedReview(ctx.db, { repo: 'hq', pr: 7, head: FAKE_FULL_SHA });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining("needs the owner's lgtm at 0123456") });

  expect(fake.of('bun')).toStrictEqual([]);
});

test("it holds a bot's PR in hq to the same lgtm", async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ author: '{"author":{"login":"renovate","is_bot":true}}', prFiles: { code: 0, stdout: 'skills/kettle/SKILL.md\n', stderr: '' } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining("needs the owner's lgtm at 0123456") });
});

test('it lets a PR in hq that changes only source files merge with no lgtm', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'src/kettle.ts\nsrc/kettle.test.ts\n', stderr: '' } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).resolves.toStrictEqual({ mayMerge: true, reason: 'not a noslop repo: green CI is enough', reviewed: false });
});

test('it refuses a PR in hq that moves a skill out of skills/', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'attic/SKILL.md\tskills/kettle/SKILL.md\n', stderr: '' } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining('owner-held files (skills/kettle/SKILL.md)') });

  expect(fake.lines().filter((line) => line.includes('/files?'))).toStrictEqual(['gh api --paginate repos/zgeoff/hq/pulls/7/files?per_page=100 --jq .[] | [.filename, .previous_filename // empty] | @tsv']);
});

test('it refuses a PR in hq-private that changes a start prompt with no lgtm at its head', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'skills/kettle/references/session-prompt.md\n', stderr: '' } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq-private', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: "the PR changes owner-held files (skills/kettle/references/session-prompt.md) and needs the owner's lgtm at 0123456: hq pr answer hq-private 7 lgtm --source <where the owner said it>" });
});

test("it passes a PR in hq-private once the owner's chat lgtm is recorded at its head", async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'skills/kettle/references/session-prompt.md\n', stderr: '' } });
  recordPRAnswer(ctx.db, { repo: 'hq-private', pr: 7, answer: 'lgtm', head: FAKE_FULL_SHA, source: 'chat:kettle-1', note: null, actor: 'z-kettle' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq-private', pr: 7 })).resolves.toMatchObject({ mayMerge: true });
});

test('it refuses an lgtm at an older head on a PR in hq-private', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'skills/kettle/references/session-prompt.md\n', stderr: '' } });
  recordPRAnswer(ctx.db, { repo: 'hq-private', pr: 7, answer: 'lgtm', head: 'f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed', source: 'call:kettle-3', note: null, actor: 'z-kettle' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq-private', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked' });
});

test("it passes a PR in hq-private that changes a start prompt once the owner's call lgtm is at its head", async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'skills/kettle/references/session-prompt.md\n', stderr: '' } });
  recordPRAnswer(ctx.db, { repo: 'hq-private', pr: 7, answer: 'lgtm', head: FAKE_FULL_SHA, source: 'call:kettle-3', note: null, actor: 'z-kettle' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq-private', pr: 7 })).resolves.toMatchObject({ mayMerge: true });
});

test('it lets a PR in hq-private that changes only source files merge with no lgtm', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'src/kettle.ts\n', stderr: '' } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq-private', pr: 7 })).resolves.toMatchObject({ mayMerge: true });
});

test.each(['grants/kettle.json', 'docs/sessions.md', 'docs/sessions/kettle.md', 'session-prompt.md'])('it holds %s in hq-private', async (path) => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: `${path}\n`, stderr: '' } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq-private', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining(`owner-held files (${path})`) });
});

test('it names the first three owner-held files and counts the rest', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'skills/a/SKILL.md\nskills/b/SKILL.md\nskills/c/SKILL.md\nskills/d/SKILL.md\nfleet.json\n', stderr: '' } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).rejects.toMatchObject({ message: expect.stringContaining('owner-held files (skills/a/SKILL.md, skills/b/SKILL.md, skills/c/SKILL.md and 2 more)') });
});

test('it refuses a PR in hq whose changed files cannot be read', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 1, stdout: '', stderr: 'gh: HTTP 502' } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining("could not read the PR's changed files from GitHub") });
});

test('it refuses a PR in hq that lists as many files as GitHub gives', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: Array.from({ length: 3000 }, (_, index) => `src/kettle-${index}.ts\n`).join(''), stderr: '' } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining("GitHub's limit") });
});

test('it refuses a PR in hq whose head moved after the lgtm check', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'skills/kettle/SKILL.md\n', stderr: '' }, prHead: { code: 0, stdout: JSON.stringify({ headRefOid: 'f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed' }), stderr: '' } });
  recordPRAnswer(ctx.db, { repo: 'hq', pr: 7, answer: 'lgtm', head: FAKE_FULL_SHA, source: 'console:kettle-2', note: null, actor: 'z-kettle' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining('head moved') });
});

test('it refuses a PR in hq that changes only source files when its head moved after the file read', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'src/kettle.ts\n', stderr: '' }, prHead: { code: 0, stdout: JSON.stringify({ headRefOid: 'f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed' }), stderr: '' } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: "the PR's head moved from 0123456 while the gate ran, so no pass: run the gate again" });
});

test('it reads no changed files for a repo of another owner', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner();

  await checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'teapot/widgets', pr: 7 });

  expect(fake.lines().filter((line) => line.includes('/files?'))).toStrictEqual([]);
});

test('it holds a PR in zgeoff/hq given with its owner, and none in another owner\'s hq', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'skills/kettle/SKILL.md\n', stderr: '' } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'zgeoff/hq', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked' });
  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'teapot/hq', pr: 7 })).resolves.toMatchObject({ mayMerge: true });
});

test('it passes a PR in a zgeoff repo whose only held change is a moved link, on z-review\'s record and hq\'s own proof', async () => {
  const ctx = setupTest();
  const stub = await createStubPRRepo({
    root: ctx.base,
    repo: 'widgets',
    pr: 7,
    history: [{ 'skills/kettle/SKILL.md': 'See [care](../../docs/old.md).\n', 'docs/old.md': 'Descale monthly.\n' }],
    change: { 'skills/kettle/SKILL.md': 'See [care](../../docs/new.md).\n', 'docs/old.md': null, 'docs/new.md': 'Descale monthly.\n' },
  });
  const fake = buildFakeRunner({ realGit: true, prFiles: { code: 0, stdout: `skills/kettle/SKILL.md\ndocs/old.md\ndocs/new.md\n`, stderr: '' }, ...buildStubPRHead(stub.head) });
  recordPRMechanical(ctx.db, { repo: 'widgets', pr: 7, head: stub.head, files: ['skills/kettle/SKILL.md'], lines: 1, actor: 'z-review' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).resolves.toMatchObject({ mayMerge: true });
});

test('it blocks a PR whose moved link points at a file with other content, record or not', async () => {
  const ctx = setupTest();
  const stub = await createStubPRRepo({
    root: ctx.base,
    repo: 'widgets',
    pr: 7,
    history: [{ 'skills/kettle/SKILL.md': 'See [care](../../docs/old.md).\n', 'docs/old.md': 'Descale monthly.\n', 'docs/new.md': 'Brew tea.\n' }],
    change: { 'skills/kettle/SKILL.md': 'See [care](../../docs/new.md).\n', 'docs/old.md': null },
  });
  const fake = buildFakeRunner({ realGit: true, prFiles: { code: 0, stdout: `skills/kettle/SKILL.md\ndocs/old.md\n`, stderr: '' }, ...buildStubPRHead(stub.head) });
  recordPRMechanical(ctx.db, { repo: 'widgets', pr: 7, head: stub.head, files: ['skills/kettle/SKILL.md'], lines: 1, actor: 'z-review' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining('is not proved to be the same file moved') });
});

test.each([
  ['a reworded sentence', 'Boil the water.\n', 'Heat the water.\n'],
  ['a changed table cell', '| kettle | boils |\n', '| teapot | boils |\n'],
  ['an added line', 'Boil the water.\n', 'Boil the water.\nThen pour.\n'],
])('it holds a PR with %s for the owner, even with z-review\'s record', async (_label, before, after) => {
  const ctx = setupTest();
  const stub = await createStubPRRepo({ root: ctx.base, repo: 'widgets', pr: 7, history: [{ 'skills/kettle/SKILL.md': before }], change: { 'skills/kettle/SKILL.md': after } });
  const fake = buildFakeRunner({ realGit: true, prFiles: { code: 0, stdout: 'skills/kettle/SKILL.md\n', stderr: '' }, ...buildStubPRHead(stub.head) });
  recordPRMechanical(ctx.db, { repo: 'widgets', pr: 7, head: stub.head, files: ['skills/kettle/SKILL.md'], lines: 1, actor: 'z-review' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining('hq does not prove the edits mechanical') });
});

test('it passes a version change between version-shaped tokens on z-review\'s record', async () => {
  const ctx = setupTest();
  const stub = await createStubPRRepo({ root: ctx.base, repo: 'widgets', pr: 7, history: [{ 'AGENTS.md': 'Needs bun 1.3.4.\n' }], change: { 'AGENTS.md': 'Needs bun 1.4.0.\n' } });
  const fake = buildFakeRunner({ realGit: true, prFiles: { code: 0, stdout: 'AGENTS.md\n', stderr: '' }, ...buildStubPRHead(stub.head) });
  recordPRMechanical(ctx.db, { repo: 'widgets', pr: 7, head: stub.head, files: ['AGENTS.md'], lines: 1, actor: 'z-review' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).resolves.toMatchObject({ mayMerge: true });
});

test('it holds a version change to a token that is not version-shaped', async () => {
  const ctx = setupTest();
  const stub = await createStubPRRepo({ root: ctx.base, repo: 'widgets', pr: 7, history: [{ 'AGENTS.md': 'Needs bun 1.3.4.\n' }], change: { 'AGENTS.md': 'Needs bun latest.\n' } });
  const fake = buildFakeRunner({ realGit: true, prFiles: { code: 0, stdout: 'AGENTS.md\n', stderr: '' }, ...buildStubPRHead(stub.head) });
  recordPRMechanical(ctx.db, { repo: 'widgets', pr: 7, head: stub.head, files: ['AGENTS.md'], lines: 1, actor: 'z-review' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked' });
});

test('it blocks a mechanical edit that z-review has not recorded, naming the command', async () => {
  const ctx = setupTest();
  const stub = await createStubPRRepo({ root: ctx.base, repo: 'widgets', pr: 7, history: [{ 'AGENTS.md': 'Needs bun 1.3.4.\n' }], change: { 'AGENTS.md': 'Needs bun 1.4.0.\n' } });
  const fake = buildFakeRunner({ realGit: true, prFiles: { code: 0, stdout: 'AGENTS.md\n', stderr: '' }, ...buildStubPRHead(stub.head) });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining('hq pr mechanical widgets 7') });
});

test('it blocks an instruction file change when hq cannot read the diff at the gate head', async () => {
  const ctx = setupTest();
  await createStubPRRepo({ root: ctx.base, repo: 'widgets', pr: 7, history: [{ 'AGENTS.md': 'Needs bun 1.3.4.\n' }], change: { 'AGENTS.md': 'Needs bun 1.4.0.\n' } });
  const fake = buildFakeRunner({ realGit: true, prFiles: { code: 0, stdout: 'AGENTS.md\n', stderr: '' }, ...buildStubPRHead('f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed') });
  recordPRMechanical(ctx.db, { repo: 'widgets', pr: 7, head: 'f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed', files: ['AGENTS.md'], lines: 1, actor: 'z-review' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining('hq could not read the diff to prove it') });
});

test('it ignores a mechanical record at an older head', async () => {
  const ctx = setupTest();
  const stub = await createStubPRRepo({ root: ctx.base, repo: 'widgets', pr: 7, history: [{ 'AGENTS.md': 'Needs bun 1.3.4.\n' }], change: { 'AGENTS.md': 'Needs bun 1.4.0.\n' } });
  const fake = buildFakeRunner({ realGit: true, prFiles: { code: 0, stdout: 'AGENTS.md\n', stderr: '' }, ...buildStubPRHead(stub.head) });
  recordPRMechanical(ctx.db, { repo: 'widgets', pr: 7, head: 'f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed', files: ['AGENTS.md'], lines: 1, actor: 'z-review' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked' });
});

test('it ignores a mechanical record that someone other than z-review wrote', async () => {
  const ctx = setupTest();
  const stub = await createStubPRRepo({ root: ctx.base, repo: 'widgets', pr: 7, history: [{ 'AGENTS.md': 'Needs bun 1.3.4.\n' }], change: { 'AGENTS.md': 'Needs bun 1.4.0.\n' } });
  const fake = buildFakeRunner({ realGit: true, prFiles: { code: 0, stdout: 'AGENTS.md\n', stderr: '' }, ...buildStubPRHead(stub.head) });
  recordPRMechanical(ctx.db, { repo: 'widgets', pr: 7, head: stub.head, files: ['AGENTS.md'], lines: 1, actor: 'z-kettle' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked' });
});

test.each([
  { name: 'blank lines and a trailing space', before: 'Boil the water.\n', after: 'Boil the water. \n\n' },
  { name: 'a trailing space after a shell continuation backslash', before: '```sh\nkettle boil \\\n  --fast\n```\n', after: '```sh\nkettle boil \\ \n  --fast\n```\n' },
])('it holds an instruction file whose only change is $name, with no record', async (row) => {
  const ctx = setupTest();
  const stub = await createStubPRRepo({ root: ctx.base, repo: 'widgets', pr: 7, history: [{ 'skills/kettle/SKILL.md': row.before }], change: { 'skills/kettle/SKILL.md': row.after } });
  const fake = buildFakeRunner({ realGit: true, prFiles: { code: 0, stdout: 'skills/kettle/SKILL.md\n', stderr: '' }, ...buildStubPRHead(stub.head) });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked' });
});

test('it holds a space added inside a command in an instruction file for the owner, with no record', async () => {
  const ctx = setupTest();
  const stub = await createStubPRRepo({ root: ctx.base, repo: 'widgets', pr: 7, history: [{ 'skills/kettle/SKILL.md': 'Run `rm -rf /tmp/cache` after a brew.\n' }], change: { 'skills/kettle/SKILL.md': 'Run `rm -rf /tmp/ cache` after a brew.\n' } });
  const fake = buildFakeRunner({ realGit: true, prFiles: { code: 0, stdout: 'skills/kettle/SKILL.md\n', stderr: '' }, ...buildStubPRHead(stub.head) });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked' });
});

test('it passes an instruction file change by a bot with no record and reads no diff', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'skills/kettle/SKILL.md\n', stderr: '' }, ...buildStubPRHead(FAKE_FULL_SHA, { login: 'renovate', is_bot: true }) });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).resolves.toMatchObject({ mayMerge: true });

  expect(fake.of('git')).toStrictEqual([]);
});

test('it passes an instruction file change on the owner\'s lgtm at the head and reads no diff', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'skills/kettle/SKILL.md\n', stderr: '' } });
  recordPRAnswer(ctx.db, { repo: 'widgets', pr: 7, answer: 'lgtm', head: FAKE_FULL_SHA, source: 'console:kettle-2', note: null, actor: 'z-kettle' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).resolves.toMatchObject({ mayMerge: true });

  expect(fake.of('git')).toStrictEqual([]);
});

test.each(['boundary', 'ci-design-sync', 'rename', 'repo-sync', 'formatting'] as const)('it passes an instruction file change on z-review\'s %s exemption at the head, reading no diff', async (rule) => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'skills/kettle/SKILL.md\n', stderr: '' } });
  recordPRExemption(ctx.db, { repo: 'widgets', pr: 7, head: FAKE_FULL_SHA, rule, note: 'Covered by the kettle grant.', files: ['skills/kettle/SKILL.md'], actor: 'z-review' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).resolves.toMatchObject({ mayMerge: true });

  expect(fake.of('git')).toStrictEqual([]);
});

test('it ignores an exemption at an older head', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'skills/kettle/SKILL.md\n', stderr: '' } });
  recordPRExemption(ctx.db, { repo: 'widgets', pr: 7, head: 'f00dfeedf00dfeedf00dfeedf00dfeedf00dfeed', rule: 'rename', note: 'Covered by the kettle grant.', files: ['skills/kettle/SKILL.md'], actor: 'z-review' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining('repo instruction files (skills/kettle/SKILL.md)') });
});

test('it holds skills in hq to the owner\'s lgtm whatever z-review records', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'skills/kettle/SKILL.md\n', stderr: '' } });
  recordPRMechanical(ctx.db, { repo: 'hq', pr: 7, head: FAKE_FULL_SHA, files: ['skills/kettle/SKILL.md'], lines: 1, actor: 'z-review' });
  recordPRExemption(ctx.db, { repo: 'hq', pr: 7, head: FAKE_FULL_SHA, rule: 'rename', note: 'Covered by the kettle grant.', files: ['skills/kettle/SKILL.md'], actor: 'z-review' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining("owner-held files (skills/kettle/SKILL.md) and needs the owner's lgtm") });
});

test('it holds skills in hq-private to the owner\'s lgtm whatever z-review records', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'skills/kettle/SKILL.md\n', stderr: '' } });
  recordPRMechanical(ctx.db, { repo: 'hq-private', pr: 7, head: FAKE_FULL_SHA, files: ['skills/kettle/SKILL.md'], lines: 1, actor: 'z-review' });
  recordPRExemption(ctx.db, { repo: 'hq-private', pr: 7, head: FAKE_FULL_SHA, rule: 'rename', note: 'Covered by the kettle grant.', files: ['skills/kettle/SKILL.md'], actor: 'z-review' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq-private', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining("owner-held files (skills/kettle/SKILL.md) and needs the owner's lgtm") });
});

test('it holds an owner-held path even when the instruction files of the PR are cleared', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: `skills/kettle/SKILL.md\nfleet.json\n`, stderr: '' } });
  recordPRExemption(ctx.db, { repo: 'hq', pr: 7, head: FAKE_FULL_SHA, rule: 'rename', note: 'Covered by the kettle grant.', files: ['skills/kettle/SKILL.md'], actor: 'z-review' });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining('owner-held files (skills/kettle/SKILL.md, fleet.json)') });
});

test('it lets a PR in a zgeoff repo that changes no instruction file merge as before', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'src/kettle.ts\n', stderr: '' } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'widgets', pr: 7 })).resolves.toMatchObject({ mayMerge: true });

  expect(fake.of('git')).toStrictEqual([]);
});

test('it holds no instruction file of nixie-definitions', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'skills/kettle/SKILL.md\n', stderr: '' } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'nixie-definitions', pr: 7 })).resolves.toMatchObject({ mayMerge: true });
});

test('it holds docs/sessions.md in hq, as its CODEOWNERS lists /docs/', async () => {
  const ctx = setupTest();
  const codeowners = Buffer.from('# z-q\n/src/ @zgeoff\n\n# the owner: docs change only with his lgtm\n/skills/ @zgeoff\n/docs/ @zgeoff\n/.claude/ @zgeoff\n').toString('base64');
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'docs/sessions.md\n', stderr: '' }, contents: { [`.github/CODEOWNERS?ref=${FAKE_BASE_SHA}`]: { code: 0, stdout: JSON.stringify({ type: 'file', encoding: 'base64', content: codeowners }), stderr: '' } } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining('owner-held files (docs/sessions.md)') });
});

test('it holds .claude/settings.json in hq, as its CODEOWNERS lists /.claude/', async () => {
  const ctx = setupTest();
  const codeowners = Buffer.from('# the owner\n/.claude/ @zgeoff\n').toString('base64');
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: '.claude/settings.json\n', stderr: '' }, contents: { [`.github/CODEOWNERS?ref=${FAKE_BASE_SHA}`]: { code: 0, stdout: JSON.stringify({ type: 'file', encoding: 'base64', content: codeowners }), stderr: '' } } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining('owner-held files (.claude/settings.json)') });
});

test('it lets a PR in hq that changes only src/x.ts merge with no lgtm, as CODEOWNERS leaves it to z-q', async () => {
  const ctx = setupTest();
  const codeowners = Buffer.from('# z-q\n/src/ @zgeoff\n\n# the owner\n/docs/ @zgeoff\n').toString('base64');
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'src/x.ts\n', stderr: '' }, contents: { [`.github/CODEOWNERS?ref=${FAKE_BASE_SHA}`]: { code: 0, stdout: JSON.stringify({ type: 'file', encoding: 'base64', content: codeowners }), stderr: '' } } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).resolves.toMatchObject({ mayMerge: true });
});

test('it holds fleet.json in hq though CODEOWNERS does not list it', async () => {
  const ctx = setupTest();
  const codeowners = Buffer.from('# the owner\n/docs/ @zgeoff\n').toString('base64');
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'fleet.json\n', stderr: '' }, contents: { [`.github/CODEOWNERS?ref=${FAKE_BASE_SHA}`]: { code: 0, stdout: JSON.stringify({ type: 'file', encoding: 'base64', content: codeowners }), stderr: '' } } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining('owner-held files (fleet.json)') });
});

test("it reads CODEOWNERS at the PR's base commit, so a PR that drops /docs/ from it is still held", async () => {
  const ctx = setupTest();
  const baseText = Buffer.from('# the owner\n/docs/ @zgeoff\n').toString('base64');
  const headText = Buffer.from('# the owner\n/skills/ @zgeoff\n').toString('base64');
  const fake = buildFakeRunner({
    prFiles: { code: 0, stdout: '.github/CODEOWNERS\ndocs/sessions.md\n', stderr: '' },
    contents: {
      [`.github/CODEOWNERS?ref=${FAKE_BASE_SHA}`]: { code: 0, stdout: JSON.stringify({ type: 'file', encoding: 'base64', content: baseText }), stderr: '' },
      [`.github/CODEOWNERS?ref=${FAKE_FULL_SHA}`]: { code: 0, stdout: JSON.stringify({ type: 'file', encoding: 'base64', content: headText }), stderr: '' },
    },
  });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining('owner-held files (docs/sessions.md)') });
  expect(fake.lines()).toContain(`gh api repos/zgeoff/hq/contents/.github/CODEOWNERS?ref=${FAKE_BASE_SHA}`);
  expect(fake.lines()).not.toContain(`gh api repos/zgeoff/hq/contents/.github/CODEOWNERS?ref=${FAKE_FULL_SHA}`);
});

test('it reads a root CODEOWNERS when the repo has none under .github', async () => {
  const ctx = setupTest();
  const codeowners = Buffer.from('# the owner\n/docs/ @zgeoff\n').toString('base64');
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'docs/a.md\n', stderr: '' }, contents: { [`CODEOWNERS?ref=${FAKE_BASE_SHA}`]: { code: 0, stdout: JSON.stringify({ type: 'file', encoding: 'base64', content: codeowners }), stderr: '' } } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining('owner-held files (docs/a.md)') });
});

test("it falls back to hq-private's code rule when the repo has no CODEOWNERS", async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'grants/kettle.json\n', stderr: '' } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq-private', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining('owner-held files (grants/kettle.json)') });
});

test('it blocks the merge when CODEOWNERS cannot be read', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'src/x.ts\n', stderr: '' }, contents: { [`.github/CODEOWNERS?ref=${FAKE_BASE_SHA}`]: { code: 1, stdout: '', stderr: 'gh: Bad credentials (HTTP 401)' } } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining('could not read .github/CODEOWNERS at the PR') });
});

test('it blocks the merge when CODEOWNERS is not valid base64', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'src/x.ts\n', stderr: '' }, contents: { [`.github/CODEOWNERS?ref=${FAKE_BASE_SHA}`]: { code: 0, stdout: JSON.stringify({ type: 'file', encoding: 'base64', content: '!!not base64!!' }), stderr: '' } } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining('could not read .github/CODEOWNERS at the PR') });
});

test('it blocks the merge when CODEOWNERS has no owner section', async () => {
  const ctx = setupTest();
  const codeowners = Buffer.from('# z-q\n/src/ @zgeoff\n').toString('base64');
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'src/x.ts\n', stderr: '' }, contents: { [`.github/CODEOWNERS?ref=${FAKE_BASE_SHA}`]: { code: 0, stdout: JSON.stringify({ type: 'file', encoding: 'base64', content: codeowners }), stderr: '' } } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining('has no "# the owner" section') });
});

test('it confirms the base commit is readable before it takes two CODEOWNERS 404s as no file', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'src/x.ts\n', stderr: '' } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq-private', pr: 7 })).resolves.toMatchObject({ mayMerge: true });
  expect(fake.lines()).toContain(`gh api repos/zgeoff/hq-private/commits/${FAKE_BASE_SHA} --silent`);
});

test('it blocks the merge when both CODEOWNERS paths answer 404 and the base commit cannot be read', async () => {
  const ctx = setupTest();
  const fake = buildFakeRunner({ prFiles: { code: 0, stdout: 'src/x.ts\n', stderr: '' }, baseCommit: { code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' } });

  await expect(checkMergeGate({ run: fake.run, db: ctx.db, rawRepo: 'hq', pr: 7 })).rejects.toMatchObject({ code: 'merge_blocked', message: expect.stringContaining("could not read the PR's base ba5eba5 to confirm the repo has no CODEOWNERS") });
});
