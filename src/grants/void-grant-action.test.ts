import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import { NOON_SYDNEY, at, freshDb } from '../../test/helpers.ts';
import { AtcClient } from '../atc/atc-client.ts';
import { setMeta } from '../db/set-meta.ts';
import type { OwnerProbeDeps } from '../pr-status/read-owner-session.ts';
import { createGrantMark } from './create-grant-mark.ts';
import { recordGrantAction } from './record-grant-action.ts';
import { voidGrantAction } from './void-grant-action.ts';

function setupTest() {
  const fresh = freshDb();
  onTestFinished(fresh.cleanup);
  return {
    db: fresh.db,
    directory: fresh.dir,
    probeAs: (peerSession: string | null | undefined): OwnerProbeDeps => ({ openClient: () => Promise.resolve({ peerSession, close: () => {} }) }),
  };
}

test('the session recorded for the act actor voids it, and the row, an event and a news item say so', async () => {
  const ctx = setupTest();
  at(NOON_SYDNEY);
  setMeta(ctx.db, 'fleet_ids', JSON.stringify({ 'z-stu': 'kettle-1', 'teapot-bot': 'kettle-2', 'kettle-bot': 'kettle-3' }));
  createGrantMark(ctx.db, { text: 'kettle PRs merge on green CI', ref: 'kettle#3', at: null, name: 'kettle-merges', actor: 'kettle-bot' });
  recordGrantAction(ctx.db, { grant: 'kettle-merges', target: 'kettle#9', note: null, actor: 'teapot-bot' });

  const voided = await voidGrantAction({ db: ctx.db, args: { id: 1, reason: 'logged before the merge failed' }, probe: ctx.probeAs('kettle-2'), clock: () => new Date('2026-10-14T03:00:00Z') });

  expect(voided).toMatchObject({ id: 1, voided_at: '2026-10-14T03:00:00Z', voided_by: 'teapot-bot', void_reason: 'logged before the merge failed' });
  expect(ctx.db.query('SELECT target, voided_at, voided_by, void_reason FROM grant_actions').all()).toStrictEqual([{ target: 'kettle#9', voided_at: '2026-10-14T03:00:00Z', voided_by: 'teapot-bot', void_reason: 'logged before the merge failed' }]);
  expect(ctx.db.query("SELECT subject, subject_id, actor, from_state, to_state, data FROM events WHERE action = 'grant-void'").all()).toStrictEqual([
    { subject: 'hq', subject_id: 'grant:kettle-merges', actor: 'teapot-bot', from_state: 'live', to_state: 'void', data: JSON.stringify({ id: 1, target: 'kettle#9', reason: 'logged before the merge failed' }) },
  ]);
  expect(ctx.db.query('SELECT from_name, text FROM news').all()).toStrictEqual([{ from_name: 'teapot-bot', text: 'teapot-bot voided grant action 1 under kettle-merges (kettle#9): logged before the merge failed' }]);
});

test('a void of an act with a 400-character target keeps the whole reason in the news and shortens the target', async () => {
  const ctx = setupTest();
  at(NOON_SYDNEY);
  setMeta(ctx.db, 'fleet_ids', JSON.stringify({ 'z-stu': 'kettle-1', 'teapot-bot': 'kettle-2', 'kettle-bot': 'kettle-3' }));
  createGrantMark(ctx.db, { text: 'kettle PRs merge on green CI', ref: 'kettle#3', at: null, name: 'kettle-merges', actor: 'kettle-bot' });
  recordGrantAction(ctx.db, { grant: 'kettle-merges', target: `bun run descale --kettle ${'k'.repeat(375)}`, note: null, actor: 'teapot-bot' });

  await voidGrantAction({ db: ctx.db, args: { id: 1, reason: 'the descale ran against the wrong kettle' }, probe: ctx.probeAs('kettle-2'), clock: () => new Date('2026-10-14T03:00:00Z') });

  expect(ctx.db.query('SELECT text FROM news').all()).toStrictEqual([{ text: `teapot-bot voided grant action 1 under kettle-merges (bun run descale --kettle ${'k'.repeat(277)}…): the descale ran against the wrong kettle` }]);
});

test('the owner session voids an act another session logged, and the owner name is recorded', async () => {
  const ctx = setupTest();
  at(NOON_SYDNEY);
  setMeta(ctx.db, 'fleet_ids', JSON.stringify({ 'z-stu': 'kettle-1', 'teapot-bot': 'kettle-2', 'kettle-bot': 'kettle-3' }));
  createGrantMark(ctx.db, { text: 'kettle PRs merge on green CI', ref: 'kettle#3', at: null, name: 'kettle-merges', actor: 'kettle-bot' });
  recordGrantAction(ctx.db, { grant: 'kettle-merges', target: 'kettle#9', note: null, actor: 'teapot-bot' });

  const voided = await voidGrantAction({ db: ctx.db, args: { id: 1, reason: 'wrong PR' }, probe: ctx.probeAs('kettle-1'), clock: () => new Date('2026-10-14T03:00:00Z') });

  expect(voided.voided_by).toBe('z-stu');
  expect(ctx.db.query("SELECT actor FROM events WHERE action = 'grant-void'").all()).toStrictEqual([{ actor: 'z-stu' }]);
});

test('another recorded session is refused, naming who may void the act, and nothing changes', async () => {
  const ctx = setupTest();
  at(NOON_SYDNEY);
  setMeta(ctx.db, 'fleet_ids', JSON.stringify({ 'z-stu': 'kettle-1', 'teapot-bot': 'kettle-2', 'kettle-bot': 'kettle-3' }));
  createGrantMark(ctx.db, { text: 'kettle PRs merge on green CI', ref: 'kettle#3', at: null, name: 'kettle-merges', actor: 'kettle-bot' });
  recordGrantAction(ctx.db, { grant: 'kettle-merges', target: 'kettle#9', note: null, actor: 'teapot-bot' });

  await expect(voidGrantAction({ db: ctx.db, args: { id: 1, reason: 'wrong PR' }, probe: ctx.probeAs('kettle-3'), clock: () => new Date('2026-10-14T03:00:00Z') })).rejects.toMatchObject({ code: 'not_allowed', message: 'only teapot-bot, who logged grant action 1, or z-stu may void it' });
  expect(ctx.db.query('SELECT voided_at FROM grant_actions').all()).toStrictEqual([{ voided_at: null }]);
  expect(ctx.db.query('SELECT COUNT(*) AS total FROM news').get()).toStrictEqual({ total: 0 });
});

test.each([
  ['atc names no caller session because the daemon is old', undefined],
  ['atc finds no session for the caller', null],
])('a caller atc cannot name is refused when %s', async (_case, peerSession) => {
  const ctx = setupTest();
  at(NOON_SYDNEY);
  setMeta(ctx.db, 'fleet_ids', JSON.stringify({ 'z-stu': 'kettle-1', 'teapot-bot': 'kettle-2', 'kettle-bot': 'kettle-3' }));
  createGrantMark(ctx.db, { text: 'kettle PRs merge on green CI', ref: 'kettle#3', at: null, name: 'kettle-merges', actor: 'kettle-bot' });
  recordGrantAction(ctx.db, { grant: 'kettle-merges', target: 'kettle#9', note: null, actor: 'teapot-bot' });

  await expect(voidGrantAction({ db: ctx.db, args: { id: 1, reason: 'wrong PR' }, probe: ctx.probeAs(peerSession), clock: () => new Date('2026-10-14T03:00:00Z') })).rejects.toMatchObject({ code: 'not_allowed' });
  expect(ctx.db.query('SELECT voided_at FROM grant_actions').all()).toStrictEqual([{ voided_at: null }]);
});

test('an atc daemon with no socket at its path refuses the void and says why', async () => {
  const ctx = setupTest();
  at(NOON_SYDNEY);
  setMeta(ctx.db, 'fleet_ids', JSON.stringify({ 'z-stu': 'kettle-1', 'teapot-bot': 'kettle-2', 'kettle-bot': 'kettle-3' }));
  createGrantMark(ctx.db, { text: 'kettle PRs merge on green CI', ref: 'kettle#3', at: null, name: 'kettle-merges', actor: 'kettle-bot' });
  recordGrantAction(ctx.db, { grant: 'kettle-merges', target: 'kettle#9', note: null, actor: 'teapot-bot' });

  await expect(voidGrantAction({ db: ctx.db, args: { id: 1, reason: 'wrong PR' }, probe: { openClient: () => AtcClient.open(join(ctx.directory, 'no-atc-daemon.sock'), 1500) }, clock: () => new Date('2026-10-14T03:00:00Z') })).rejects.toMatchObject({
    code: 'not_allowed',
    message: 'only teapot-bot, who logged grant action 1, or z-stu may void it; atc cannot say who is calling (Failed to connect)',
  });
  expect(ctx.db.query('SELECT voided_at FROM grant_actions').all()).toStrictEqual([{ voided_at: null }]);
});

test('a session with no recorded fleet id is refused even when its name matches the actor', async () => {
  const ctx = setupTest();
  at(NOON_SYDNEY);
  setMeta(ctx.db, 'fleet_ids', JSON.stringify({ 'z-stu': 'kettle-1', 'teapot-bot': 'kettle-2', 'kettle-bot': 'kettle-3' }));
  createGrantMark(ctx.db, { text: 'kettle PRs merge on green CI', ref: 'kettle#3', at: null, name: 'kettle-merges', actor: 'kettle-bot' });
  recordGrantAction(ctx.db, { grant: 'kettle-merges', target: 'kettle#9', note: null, actor: 'teapot-bot' });
  setMeta(ctx.db, 'fleet_ids', JSON.stringify({ 'z-stu': 'kettle-1' }));

  await expect(voidGrantAction({ db: ctx.db, args: { id: 1, reason: 'wrong PR' }, probe: ctx.probeAs('kettle-2'), clock: () => new Date('2026-10-14T03:00:00Z') })).rejects.toMatchObject({ code: 'not_allowed' });
});

test('an unknown act id is refused as not found', async () => {
  const ctx = setupTest();
  at(NOON_SYDNEY);
  setMeta(ctx.db, 'fleet_ids', JSON.stringify({ 'z-stu': 'kettle-1', 'teapot-bot': 'kettle-2', 'kettle-bot': 'kettle-3' }));
  createGrantMark(ctx.db, { text: 'kettle PRs merge on green CI', ref: 'kettle#3', at: null, name: 'kettle-merges', actor: 'kettle-bot' });
  recordGrantAction(ctx.db, { grant: 'kettle-merges', target: 'kettle#9', note: null, actor: 'teapot-bot' });

  await expect(voidGrantAction({ db: ctx.db, args: { id: 7, reason: 'wrong PR' }, probe: ctx.probeAs('kettle-1'), clock: () => new Date('2026-10-14T03:00:00Z') })).rejects.toMatchObject({ code: 'not_found', message: 'no grant action 7' });
});

test('a void act has no move to void again, so a second void is refused, naming when, by whom and why it was voided', async () => {
  const ctx = setupTest();
  at(NOON_SYDNEY);
  setMeta(ctx.db, 'fleet_ids', JSON.stringify({ 'z-stu': 'kettle-1', 'teapot-bot': 'kettle-2', 'kettle-bot': 'kettle-3' }));
  createGrantMark(ctx.db, { text: 'kettle PRs merge on green CI', ref: 'kettle#3', at: null, name: 'kettle-merges', actor: 'kettle-bot' });
  recordGrantAction(ctx.db, { grant: 'kettle-merges', target: 'kettle#9', note: null, actor: 'teapot-bot' });
  await voidGrantAction({ db: ctx.db, args: { id: 1, reason: 'wrong PR' }, probe: ctx.probeAs('kettle-2'), clock: () => new Date('2026-10-14T03:00:00Z') });

  await expect(voidGrantAction({ db: ctx.db, args: { id: 1, reason: 'again' }, probe: ctx.probeAs('kettle-1'), clock: () => new Date('2026-10-14T03:00:00Z') })).rejects.toMatchObject({
    code: 'bad_state',
    message: 'grant action 1 was already voided at 2026-10-14T03:00:00Z by teapot-bot: wrong PR',
    data: { state: 'void' },
  });
  expect(ctx.db.query('SELECT voided_by, void_reason FROM grant_actions').all()).toStrictEqual([{ voided_by: 'teapot-bot', void_reason: 'wrong PR' }]);
  expect(ctx.db.query("SELECT COUNT(*) AS total FROM events WHERE action = 'grant-void'").get()).toStrictEqual({ total: 1 });
});

test('the voided time comes from the given clock, never from HQ_NOW', async () => {
  const ctx = setupTest();
  at('2099-01-01T00:00:00Z');
  setMeta(ctx.db, 'fleet_ids', JSON.stringify({ 'z-stu': 'kettle-1', 'teapot-bot': 'kettle-2', 'kettle-bot': 'kettle-3' }));
  createGrantMark(ctx.db, { text: 'kettle PRs merge on green CI', ref: 'kettle#3', at: null, name: 'kettle-merges', actor: 'kettle-bot' });
  recordGrantAction(ctx.db, { grant: 'kettle-merges', target: 'kettle#9', note: null, actor: 'teapot-bot' });

  const voided = await voidGrantAction({ db: ctx.db, args: { id: 1, reason: 'wrong PR' }, probe: ctx.probeAs('kettle-1'), clock: () => new Date('2026-10-14T03:00:00Z') });

  expect(voided.voided_at).toBe('2026-10-14T03:00:00Z');
});
