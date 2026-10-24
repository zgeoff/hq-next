import type { Database } from 'bun:sqlite';
import { expect, onTestFinished, test } from 'bun:test';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import rulesTable from '../lanes.json';
import { NOON_SYDNEY, at, fakeAtc, freshDb } from '../test/helpers.ts';
import { main } from './cli.ts';
import { overrideEnv } from './config/override-env.ts';
import { setMeta } from './db/set-meta.ts';
import { loadActionsSpend } from './goals/load-actions-spend.ts';
import { createGrantMark } from './grants/create-grant-mark.ts';
import { recordGrantAction } from './grants/record-grant-action.ts';
import { addRun } from './runs/add-run.ts';

// A database at noon Sydney, quiet notices and console, and a stand-in gh on PATH for
// `hq goals sync`: no repos and no closed PRs, with `billing` as the billing usage call's commands.
function setupTest(billing: string): Database {
  const fresh = freshDb(),
    log = console.log,
    path0 = process.env['PATH'],
    stubBin = `${fresh.dir}/bin`;
  onTestFinished(fresh.cleanup);
  onTestFinished(overrideEnv('HQ_NOW', NOON_SYDNEY));
  onTestFinished(overrideEnv('HQ_NOTIFY', 'off'));
  console.log = () => {};
  onTestFinished(() => (console.log = log));
  mkdirSync(stubBin);
  writeFileSync(`${stubBin}/gh`, ['#!/bin/sh', 'case "$*" in', `  *settings/billing/usage*) ${billing} ;;`, '  "repo "*) echo "[]" ;;', '  *) echo \'[{"total_count":0,"incomplete_results":false,"items":[]}]\' ;;', 'esac', ''].join('\n'));
  chmodSync(`${stubBin}/gh`, 0o755);
  process.env['PATH'] = `${stubBin}:${path0}`;
  onTestFinished(() => (process.env['PATH'] = path0));
  return fresh.db;
}

test("hq goals sync stores the month's Actions spend from GitHub billing", async () => {
  const db = setupTest(`echo '{"usageItems":[{"product":"actions","netAmount":12.5}]}'`);
  await main(['goals', 'sync', '--days', '1', '--json']);

  expect(loadActionsSpend(db, new Date(NOON_SYDNEY))).toBe(12.5);
});

test('hq goals sync replaces an earlier good Actions spend with unknown when gh fails', async () => {
  const db = setupTest(`echo 'HTTP 403' >&2; exit 1`);
  setMeta(db, 'actions_spend', JSON.stringify({ at: '2026-10-14T00:50:00Z', month: '2026-10', net: 4 }));
  await main(['goals', 'sync', '--days', '1', '--json']);

  expect(loadActionsSpend(db, new Date(NOON_SYDNEY))).toBeNull();
});

test('it warns in hq lanes status when the checkout lanes.json differs from the build', async () => {
  const fresh = freshDb();
  onTestFinished(fresh.cleanup);
  mkdirSync(`${fresh.dir}/bin`);
  writeFileSync(`${fresh.dir}/bin/systemctl`, '#!/bin/sh\nexit 3\n');
  chmodSync(`${fresh.dir}/bin/systemctl`, 0o755);
  mkdirSync(`${fresh.dir}/projects/hq`, { recursive: true });
  writeFileSync(`${fresh.dir}/projects/hq/lanes.json`, JSON.stringify({ ...rulesTable, readyState: 'Todo' }));
  const child = Bun.spawn(['bun', join(import.meta.dir, 'cli.ts'), 'lanes', 'status', '--json'], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, HOME: fresh.dir, HQ_DB: fresh.path, HQ_PROJECTS: `${fresh.dir}/projects`, HQ_CAPACITY: `${fresh.dir}/scripts/capacity.sh`, HQ_NOTIFY: 'off', HQ_NOW: NOON_SYDNEY, PATH: `${fresh.dir}/bin:${process.env['PATH']}` },
  });

  const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);

  expect(code).toBe(0);
  expect(JSON.parse(stdout)).toMatchObject({ staleBuild: `the installed hq carries an older lanes.json than ${fresh.dir}/projects/hq/lanes.json: the Ready read uses the old rules until \`bun run install-bin\` runs there` });
});

test('hq run place moves an imp run to local through the spawned CLI, and hq lanes counts it as local', async () => {
  const fresh = freshDb();
  onTestFinished(fresh.cleanup);
  mkdirSync(`${fresh.dir}/bin`);
  writeFileSync(`${fresh.dir}/bin/systemctl`, '#!/bin/sh\nexit 3\n');
  chmodSync(`${fresh.dir}/bin/systemctl`, 0o755);
  mkdirSync(`${fresh.dir}/skill/scripts`, { recursive: true });
  writeFileSync(`${fresh.dir}/skill/scripts/capacity.sh`, `echo '${JSON.stringify({ imp: { freeMib: 0, room: false } })}'\n`);
  writeFileSync(`${fresh.dir}/skill/pacing.json`, JSON.stringify({ slots: { imp: 2, local: 2 } }));
  const hq = async (...args: string[]): Promise<{ code: number; stdout: string }> => {
    const child = Bun.spawn(['bun', join(import.meta.dir, 'cli.ts'), ...args, '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, HOME: fresh.dir, HQ_DB: fresh.path, HQ_PROJECTS: `${fresh.dir}/projects`, HQ_CAPACITY: `${fresh.dir}/skill/scripts/capacity.sh`, HQ_NOTIFY: 'off', HQ_NOW: NOON_SYDNEY, HQ_AS: 'z-delivery', PATH: `${fresh.dir}/bin:${process.env['PATH']}` },
    });
    const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    return { code, stdout };
  };
  await hq('run', 'add', 'GEO-9894', '--title', 'Descale the kettle', '--where', 'imp');

  const placed = await hq('run', 'place', 'GEO-9894', 'local', '--note', 'its session runs on this host');
  const lanes = await hq('lanes');

  expect(placed.code).toBe(0);
  expect(JSON.parse(placed.stdout)).toMatchObject({ run: { issue: 'GEO-9894', place: 'local' } });
  expect(JSON.parse(lanes.stdout)).toMatchObject({ plan: { pool: { impRunning: 0, localRunning: 1 } } });
});

test('hq unblock add files a watch with a deadline, and hq unblock list shows it overdue once the deadline passes', async () => {
  const fresh = freshDb();
  onTestFinished(fresh.cleanup);
  const hq = async (now: string, ...args: string[]): Promise<{ code: number; stdout: string }> => {
    const child = Bun.spawn(['bun', join(import.meta.dir, 'cli.ts'), 'unblock', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, HOME: fresh.dir, HQ_DB: fresh.path, HQ_NOTIFY: 'off', HQ_NOW: now, HQ_AS: 'kettle-qa' },
    });
    const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    return { code, stdout };
  };
  const added = await hq(NOON_SYDNEY, 'add', '--id', 'kettle-release', '--task', 'Live-check the kettle release', '--kind', 'watch', '--deadline', '2026-10-14T02:00:00Z', '--done-when', 'release:kettle-co/kettle', '--json');

  const listed = await hq('2026-10-14T02:30:00Z', 'list');
  const json = await hq('2026-10-14T02:30:00Z', 'list', '--json');

  expect(added.code).toBe(0);
  expect(listed.stdout).toBe('Live-check the kettle release · watch · done when release:kettle-co/kettle · deadline 2026-10-14T02:00:00Z OVERDUE · added 2026-10-14T01:00:00Z · id kettle-release\n');
  expect(JSON.parse(json.stdout)).toMatchObject({ items: [{ id: 'kettle-release', kind: 'watch', deadline: '2026-10-14T02:00:00Z', overdue: true }] });
});

test('hq run done closes the run, forgets its session through atc, and notes the wrap-up on the run', async () => {
  const fresh = freshDb();
  onTestFinished(fresh.cleanup);
  onTestFinished(overrideEnv('HQ_NOW', NOON_SYDNEY));
  onTestFinished(overrideEnv('HQ_NOTIFY', 'off'));
  onTestFinished(overrideEnv('HQ_AS', 'z-delivery'));
  onTestFinished(overrideEnv('HQ_ATC_SOCKET', join(fresh.dir, 'atc.sock')));
  const printed: string[] = [];
  const log = console.log;
  console.log = (line: string) => printed.push(line);
  onTestFinished(() => (console.log = log));
  const atc = fakeAtc(fresh.dir, [
    { id: '0000a001-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'kettle-agent', alive: true, state: 'done' },
    { id: '0000a003-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'teapot-agent', alive: true, state: 'done' },
  ]);
  onTestFinished(atc.stop);
  addRun(fresh.db, { issue: 'GEO-9821', title: 'Invented kettle descaler', place: 'local', session: '0000a001-aaaa-4aaa-8aaa-aaaaaaaaaaaa', next: 'Agent working.', gate: null, geoffChat: false, lane: 'flexible', actor: 'z-delivery' });

  const code = await main(['run', 'done', 'GEO-9821', '--json']);

  expect(code).toBe(0);
  expect(JSON.parse(printed.join('\n')).wrapUp).toStrictEqual({ forgotten: ['0000a001-aaaa-4aaa-8aaa-aaaaaaaaaaaa'], destroyed: [], kept: [], failed: [] });
  expect(atc.calls).toStrictEqual([
    { method: 'session.update', input: { session: '0000a001-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pinned: false } },
    { method: 'session.kill', input: { session: '0000a001-aaaa-4aaa-8aaa-aaaaaaaaaaaa', stopOnly: true } },
    { method: 'session.update', input: { session: '0000a001-aaaa-4aaa-8aaa-aaaaaaaaaaaa', pinned: false } },
    { method: 'session.forget', input: { session: '0000a001-aaaa-4aaa-8aaa-aaaaaaaaaaaa', refusePinned: true } },
  ]);
  expect(fresh.db.query("SELECT state FROM runs WHERE issue = 'GEO-9821'").get()).toStrictEqual({ state: 'done' });
  expect(fresh.db.query("SELECT label, text FROM run_notes WHERE issue = 'GEO-9821'").all()).toStrictEqual([{ label: 'wrap-up', text: 'Wrap-up: forgot 0000a001.' }]);
});

test('hq focus set, show and clear run through the spawned CLI, with a repeated --reserve', async () => {
  const fresh = freshDb();
  onTestFinished(fresh.cleanup);
  mkdirSync(`${fresh.dir}/bin`);
  writeFileSync(`${fresh.dir}/bin/op`, '#!/bin/sh\necho "op: no session" >&2\nexit 1\n');
  chmodSync(`${fresh.dir}/bin/op`, 0o755);
  const hq = async (...args: string[]): Promise<{ code: number; stdout: string }> => {
    const child = Bun.spawn(['bun', join(import.meta.dir, 'cli.ts'), 'focus', ...args, '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, HOME: fresh.dir, HQ_DB: fresh.path, HQ_NOTIFY: 'off', HQ_NOW: NOON_SYDNEY, HQ_AS: 'z-delivery', PATH: `${fresh.dir}/bin:${process.env['PATH']}` },
    });
    const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    return { code, stdout };
  };

  const set = await hq('set', 'bug,nixie:feature', '--reserve', 'nixie=1', '--reserve', 'hq=2');
  const shown = await hq('show');
  const cleared = await hq('clear');
  const after = await hq('show');

  expect(set.code).toBe(0);
  expect(JSON.parse(shown.stdout)).toMatchObject({
    focus: { terms: [{ text: 'bug' }, { text: 'nixie:feature' }], reserves: [{ area: 'nixie', slots: 1 }, { area: 'hq', slots: 2 }], setBy: 'z-delivery' },
    counts: null,
  });
  expect(JSON.parse(cleared.stdout)).toMatchObject({ cleared: true });
  expect(JSON.parse(after.stdout)).toMatchObject({ focus: null });
});

test('hq lanes skip sets, lists and drops a skip through the spawned CLI', async () => {
  const fresh = freshDb();
  onTestFinished(fresh.cleanup);
  const hq = async (...args: string[]): Promise<{ code: number; stdout: string }> => {
    const child = Bun.spawn(['bun', join(import.meta.dir, 'cli.ts'), 'lanes', 'skip', ...args, '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, HOME: fresh.dir, HQ_DB: fresh.path, HQ_NOTIFY: 'off', HQ_NOW: NOON_SYDNEY, HQ_AS: 'z-delivery' },
    });
    const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    return { code, stdout };
  };

  const set = await hq('GEO-9881', '--until', 'GEO-9889', '--reason', 'waits on the descaler PR');
  const listed = await hq('list');
  const dropped = await hq('drop', 'GEO-9881');
  const after = await hq('list');

  expect(set.code).toBe(0);
  expect(JSON.parse(listed.stdout)).toStrictEqual({ ok: true, skips: [{ issue: 'GEO-9881', until: 'GEO-9889', reason: 'waits on the descaler PR', by: 'z-delivery', at: NOON_SYDNEY }], unread: {} });
  expect(JSON.parse(dropped.stdout)).toStrictEqual({ ok: true, issue: 'GEO-9881', dropped: true });
  expect(JSON.parse(after.stdout)).toStrictEqual({ ok: true, skips: [], unread: {} });
});

test('hq lanes shows the cause of the empty slots and the minutes by cause for today in its text and in --json slotCauses', async () => {
  const fresh = freshDb();
  onTestFinished(fresh.cleanup);
  mkdirSync(`${fresh.dir}/bin`);
  writeFileSync(`${fresh.dir}/bin/systemctl`, '#!/bin/sh\nexit 3\n');
  chmodSync(`${fresh.dir}/bin/systemctl`, 0o755);
  mkdirSync(`${fresh.dir}/skill/scripts`, { recursive: true });
  writeFileSync(`${fresh.dir}/skill/scripts/capacity.sh`, `echo '${JSON.stringify({ imp: { freeMib: 0, room: false } })}'\n`);
  writeFileSync(`${fresh.dir}/skill/pacing.json`, JSON.stringify({ slots: { imp: 0, local: 2 } }));
  setMeta(fresh.db, 'lanes_ready_issues', JSON.stringify({ at: '2026-10-14T00:55:00Z', eligible: [], design: [] }));
  setMeta(fresh.db, 'lanes_promotable_focus', JSON.stringify({ at: '2026-10-14T00:50:00Z', count: 3, focus: '[]' }));
  setMeta(fresh.db, 'lanes_slot_cause_since', JSON.stringify({ cause: 'triage', since: '2026-10-14T00:40:00Z' }));
  fresh.db.query("INSERT INTO slot_minutes (day, cause, minutes) VALUES ('2026-10-14', 'delivery', 12.4), ('2026-10-14', 'triage', 40.6), ('2026-10-13', 'supply', 99)").run();
  const hq = async (...args: string[]): Promise<string> => {
    const child = Bun.spawn(['bun', join(import.meta.dir, 'cli.ts'), 'lanes', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, HOME: fresh.dir, HQ_DB: fresh.path, HQ_PROJECTS: `${fresh.dir}/projects`, HQ_CAPACITY: `${fresh.dir}/skill/scripts/capacity.sh`, HQ_NOTIFY: 'off', HQ_NOW: NOON_SYDNEY, HQ_AS: 'z-delivery', PATH: `${fresh.dir}/bin:${process.env['PATH']}` },
    });
    const [, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    return stdout;
  };

  const text = await hq();
  const json = await hq('--json');

  expect(text).toInclude('cause: triage, 2 free slot(s) since 2026-10-14T00:40:00Z');
  expect(text).toInclude('empty slot-minutes today (Sydney): delivery 12, triage 41, supply 0');
  expect(JSON.parse(json).slotCauses).toStrictEqual({
    now: { cause: 'triage', slots: 2, since: '2026-10-14T00:40:00Z', readyAgeMinutes: 5, reason: null, backlogError: null },
    today: { delivery: 12.4, triage: 40.6, supply: 0 },
  });
});

test('hq lanes cap shows the stored cap with the working count', async () => {
  const fresh = freshDb();
  onTestFinished(fresh.cleanup);
  setMeta(fresh.db, 'lanes_cap', JSON.stringify({ cap: 7, until: '2026-10-18T21:00:00Z', reason: 'weekend pacing', by: 'z-stu', at: '2026-10-14T00:00:00Z' }));
  const child = Bun.spawn(['bun', join(import.meta.dir, 'cli.ts'), 'lanes', 'cap', '--json'], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, HOME: fresh.dir, HQ_DB: fresh.path, HQ_NOTIFY: 'off', HQ_NOW: NOON_SYDNEY } });

  const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);

  expect(code).toBe(0);
  expect(JSON.parse(stdout)).toStrictEqual({ ok: true, cap: { cap: 7, until: '2026-10-18T21:00:00Z', reason: 'weekend pacing', by: 'z-stu', at: '2026-10-14T00:00:00Z' }, working: 0, workingFrom: 'runs', error: null });
});

test('hq lanes cap refuses a change while atc cannot say who is asking, and stores nothing', async () => {
  const fresh = freshDb();
  onTestFinished(fresh.cleanup);
  setMeta(fresh.db, 'fleet_ids', JSON.stringify({ 'z-stu': 'kettle-1', 'z-delivery': 'kettle-2' }));
  const child = Bun.spawn(['bun', join(import.meta.dir, 'cli.ts'), 'lanes', 'cap', '7', '--json'], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, HOME: fresh.dir, HQ_DB: fresh.path, HQ_NOTIFY: 'off', HQ_NOW: NOON_SYDNEY, HQ_AS: 'z-stu' } });

  const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);

  expect(code).toBe(1);
  expect(JSON.parse(stdout)).toStrictEqual({ ok: false, error: { code: 'not_allowed', message: expect.stringMatching(/^atc could not say who is asking, so the lanes cap stays as it is: /u) } });
  expect(fresh.db.query("SELECT value FROM meta WHERE key = 'lanes_cap'").get()).toBeNull();
});

test('hq lanes cap refuses a count that is not a whole number', async () => {
  const fresh = freshDb();
  onTestFinished(fresh.cleanup);
  const child = Bun.spawn(['bun', join(import.meta.dir, 'cli.ts'), 'lanes', 'cap', 'seven', '--json'], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, HOME: fresh.dir, HQ_DB: fresh.path, HQ_NOTIFY: 'off', HQ_NOW: NOON_SYDNEY } });

  const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);

  expect(code).toBe(1);
  expect(JSON.parse(stdout)).toStrictEqual({ ok: false, error: { code: 'bad_args', message: 'hq lanes cap takes a whole number from 0, or off, not "seven"; hq lanes cap | cap <n> [--until <ISO time|Ddd HH:MM>] [--reason TEXT] | cap off [--reason TEXT]' } });
});

test('hq lanes --json carries the stored cap with the working count and what limits the slots', async () => {
  const fresh = freshDb();
  onTestFinished(fresh.cleanup);
  mkdirSync(`${fresh.dir}/bin`);
  writeFileSync(`${fresh.dir}/bin/systemctl`, '#!/bin/sh\nexit 3\n');
  chmodSync(`${fresh.dir}/bin/systemctl`, 0o755);
  mkdirSync(`${fresh.dir}/skill/scripts`, { recursive: true });
  writeFileSync(`${fresh.dir}/skill/scripts/capacity.sh`, `echo '${JSON.stringify({ imp: { freeMib: 0, room: false } })}'\n`);
  writeFileSync(`${fresh.dir}/skill/pacing.json`, JSON.stringify({ slots: { imp: 0, local: 2 } }));
  setMeta(fresh.db, 'lanes_ready_issues', JSON.stringify({ at: '2026-10-14T00:55:00Z', eligible: [], design: [] }));
  setMeta(fresh.db, 'lanes_promotable_focus', JSON.stringify({ at: '2026-10-14T00:50:00Z', count: 3, focus: '[]' }));
  setMeta(fresh.db, 'lanes_cap', JSON.stringify({ cap: 1, until: '2026-10-18T21:00:00Z', reason: 'weekend pacing', by: 'z-stu', at: '2026-10-14T00:00:00Z' }));
  const child = Bun.spawn(['bun', join(import.meta.dir, 'cli.ts'), 'lanes', '--json'], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, HOME: fresh.dir, HQ_DB: fresh.path, HQ_PROJECTS: `${fresh.dir}/projects`, HQ_CAPACITY: `${fresh.dir}/skill/scripts/capacity.sh`, HQ_NOTIFY: 'off', HQ_NOW: NOON_SYDNEY, HQ_AS: 'z-delivery', PATH: `${fresh.dir}/bin:${process.env['PATH']}` },
  });

  const [, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);

  expect(JSON.parse(stdout).cap).toStrictEqual({ cap: 1, until: '2026-10-18T21:00:00Z', reason: 'weekend pacing', by: 'z-stu', working: 0, limitedBy: 'cap', workingFrom: 'runs' });
});

test('hq lanes --json carries the stored cap the watcher enforces when pacing has no lanes', async () => {
  const fresh = freshDb();
  onTestFinished(fresh.cleanup);
  mkdirSync(`${fresh.dir}/bin`);
  writeFileSync(`${fresh.dir}/bin/systemctl`, '#!/bin/sh\nexit 3\n');
  chmodSync(`${fresh.dir}/bin/systemctl`, 0o755);
  mkdirSync(`${fresh.dir}/skill/scripts`, { recursive: true });
  writeFileSync(`${fresh.dir}/skill/scripts/capacity.sh`, `echo '${JSON.stringify({ imp: { freeMib: 0, room: false } })}'\n`);
  writeFileSync(`${fresh.dir}/skill/pacing.json`, '{}');
  setMeta(fresh.db, 'lanes_cap', JSON.stringify({ cap: 0, until: '2026-10-18T21:00:00Z', reason: 'kettle descaling', by: 'z-stu', at: '2026-10-14T00:00:00Z' }));
  const child = Bun.spawn(['bun', join(import.meta.dir, 'cli.ts'), 'lanes', '--json'], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, HOME: fresh.dir, HQ_DB: fresh.path, HQ_PROJECTS: `${fresh.dir}/projects`, HQ_CAPACITY: `${fresh.dir}/skill/scripts/capacity.sh`, HQ_NOTIFY: 'off', HQ_NOW: NOON_SYDNEY, HQ_AS: 'z-delivery', PATH: `${fresh.dir}/bin:${process.env['PATH']}` },
  });

  const [, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);

  expect(JSON.parse(stdout)).toMatchObject({ plan: null, cap: { cap: 0, until: '2026-10-18T21:00:00Z', reason: 'kettle descaling', by: 'z-stu', working: 0, limitedBy: 'pool', workingFrom: 'runs' } });
});

test('hq lanes prints the stored cap under the missing slot plan when pacing has no lanes', async () => {
  const fresh = freshDb();
  onTestFinished(fresh.cleanup);
  mkdirSync(`${fresh.dir}/bin`);
  writeFileSync(`${fresh.dir}/bin/systemctl`, '#!/bin/sh\nexit 3\n');
  chmodSync(`${fresh.dir}/bin/systemctl`, 0o755);
  mkdirSync(`${fresh.dir}/skill/scripts`, { recursive: true });
  writeFileSync(`${fresh.dir}/skill/scripts/capacity.sh`, `echo '${JSON.stringify({ imp: { freeMib: 0, room: false } })}'\n`);
  writeFileSync(`${fresh.dir}/skill/pacing.json`, '{}');
  setMeta(fresh.db, 'lanes_cap', JSON.stringify({ cap: 0, until: '2026-10-18T21:00:00Z', reason: 'kettle descaling', by: 'z-stu', at: '2026-10-14T00:00:00Z' }));
  const child = Bun.spawn(['bun', join(import.meta.dir, 'cli.ts'), 'lanes'], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, HOME: fresh.dir, HQ_DB: fresh.path, HQ_PROJECTS: `${fresh.dir}/projects`, HQ_CAPACITY: `${fresh.dir}/skill/scripts/capacity.sh`, HQ_NOTIFY: 'off', HQ_NOW: NOON_SYDNEY, HQ_AS: 'z-delivery', PATH: `${fresh.dir}/bin:${process.env['PATH']}` },
  });

  const [, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);

  expect(stdout.split('\n').slice(1, 3)).toStrictEqual([expect.stringMatching(/^lanes: no slot plan /u), 'cap: 0 until Mon 08:00 Sydney (kettle descaling), 0 working (counted by run: the atc reading is stale)']);
});

test('hq capacity --json carries the Claude burn hint from the usage samples', async () => {
  const fresh = freshDb();
  onTestFinished(fresh.cleanup);
  const insert = fresh.db.query('INSERT INTO usage_samples (at, account, five_hour, seven_day) VALUES (?, ?, ?, ?)');
  insert.run('2026-10-14T00:30:00Z', 'kettle01', 10, 20);
  insert.run('2026-10-14T01:00:00Z', 'kettle01', 12, 22);
  const child = Bun.spawn(['bun', join(import.meta.dir, 'cli.ts'), 'capacity', 'show', '--json'], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, HOME: fresh.dir, HQ_DB: fresh.path, HQ_NOTIFY: 'off', HQ_NOW: NOON_SYDNEY } });

  const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);

  expect(code).toBe(0);
  expect(JSON.parse(stdout)).toMatchObject({ hint: { hours: 2, limit: 95, account: 'kettle01', windows: [{ window: '7-day', samples: 2, ratePerHour: null }, { window: '5-hour', samples: 2, ratePerHour: null }] } });
});

test('hq grant void refuses bad arguments through the spawned CLI, and writes nothing', async () => {
  const fresh = freshDb();
  onTestFinished(fresh.cleanup);
  at(NOON_SYDNEY);
  createGrantMark(fresh.db, { text: 'kettle PRs merge on green CI', ref: null, at: null, name: 'kettle-merges', actor: 'kettle-bot' });
  recordGrantAction(fresh.db, { grant: 'kettle-merges', target: 'kettle#9', note: null, actor: 'teapot-bot' });
  const actionsBefore = fresh.db.query('SELECT * FROM grant_actions ORDER BY id').all();
  const eventsBefore = fresh.db.query('SELECT * FROM events ORDER BY seq').all();
  const newsBefore = fresh.db.query('SELECT * FROM news ORDER BY id').all();
  const hq = async (...args: string[]): Promise<{ code: number; stdout: string }> => {
    const child = Bun.spawn(['bun', join(import.meta.dir, 'cli.ts'), 'grant', 'void', ...args, '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, HOME: fresh.dir, HQ_DB: fresh.path, HQ_NOTIFY: 'off', HQ_NOW: NOON_SYDNEY },
    });
    const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    return { code, stdout };
  };

  const noReason = await hq('1');
  const badID = await hq('kettle', '--reason', 'wrong PR');
  const blankReason = await hq('1', '--reason', '  ');

  expect([noReason.code, badID.code, blankReason.code]).toStrictEqual([1, 1, 1]);
  expect(JSON.parse(noReason.stdout)).toMatchObject({ ok: false, error: { code: 'bad_args', message: expect.stringContaining('--reason is required') } });
  expect(JSON.parse(badID.stdout)).toMatchObject({ ok: false, error: { code: 'bad_args', message: expect.stringContaining('the act id must be a positive whole number') } });
  expect(JSON.parse(blankReason.stdout)).toMatchObject({ ok: false, error: { code: 'bad_args', message: expect.stringContaining('--reason must say why') } });
  expect(fresh.db.query('SELECT * FROM grant_actions ORDER BY id').all()).toStrictEqual(actionsBefore);
  expect(fresh.db.query('SELECT * FROM events ORDER BY seq').all()).toStrictEqual(eventsBefore);
  expect(fresh.db.query('SELECT * FROM news ORDER BY id').all()).toStrictEqual(newsBefore);
});

test('hq grant void refuses a caller atc cannot name, whatever --by and HQ_AS claim, and the act stays', async () => {
  const fresh = freshDb();
  onTestFinished(fresh.cleanup);
  at(NOON_SYDNEY);
  setMeta(fresh.db, 'fleet_ids', JSON.stringify({ 'z-stu': 'kettle-1', 'teapot-bot': 'kettle-2' }));
  createGrantMark(fresh.db, { text: 'kettle PRs merge on green CI', ref: null, at: null, name: 'kettle-merges', actor: 'kettle-bot' });
  recordGrantAction(fresh.db, { grant: 'kettle-merges', target: 'kettle#9', note: null, actor: 'teapot-bot' });
  const child = Bun.spawn(['bun', join(import.meta.dir, 'cli.ts'), 'grant', 'void', '1', '--reason', 'wrong PR', '--by', 'z-stu', '--json'], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, HOME: fresh.dir, HQ_DB: fresh.path, HQ_NOTIFY: 'off', HQ_NOW: NOON_SYDNEY, HQ_AS: 'z-stu', ATC_SESSION_ID: 'kettle-1' },
  });

  const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);

  expect(code).toBe(1);
  expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'not_allowed', message: expect.stringContaining('only teapot-bot, who logged grant action 1, or z-stu may void it; atc cannot say who is calling') } });
  expect(fresh.db.query('SELECT voided_at FROM grant_actions').all()).toStrictEqual([{ voided_at: null }]);
});

test('hq grant actions shows a voided act struck out with its reason in text and in --json, and leaves it out of the count', async () => {
  const fresh = freshDb();
  onTestFinished(fresh.cleanup);
  at(NOON_SYDNEY);
  createGrantMark(fresh.db, { text: 'kettle PRs merge on green CI', ref: null, at: null, name: 'kettle-merges', actor: 'kettle-bot' });
  recordGrantAction(fresh.db, { grant: 'kettle-merges', target: 'kettle#8', note: null, actor: 'teapot-bot' });
  recordGrantAction(fresh.db, { grant: 'kettle-merges', target: 'kettle#9', note: null, actor: 'teapot-bot' });
  fresh.db.query("UPDATE grant_actions SET voided_at = '2026-10-14T01:30:00Z', voided_by = 'z-stu', void_reason = 'logged before the merge failed' WHERE id = 1").run();
  const hq = async (...args: string[]): Promise<string> => {
    const child = Bun.spawn(['bun', join(import.meta.dir, 'cli.ts'), 'grant', 'actions', '--since', '1d', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, HOME: fresh.dir, HQ_DB: fresh.path, HQ_NOTIFY: 'off', HQ_NOW: '2026-10-14T02:00:00Z' },
    });
    const [, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    return stdout;
  };

  const text = await hq();
  const json = await hq('--json');

  expect(text.trim()).toBe('kettle-merges (mark 1): 1: kettle#9 (teapot-bot); ~~kettle#8 (teapot-bot)~~ void act 1, 2026-10-14T01:30:00Z by z-stu: logged before the merge failed');
  expect(JSON.parse(json).grants[0].voided).toStrictEqual([{ id: 1, target: 'kettle#8', note: null, actor: 'teapot-bot', at: NOON_SYDNEY, voidedAt: '2026-10-14T01:30:00Z', voidedBy: 'z-stu', voidReason: 'logged before the merge failed' }]);
});
