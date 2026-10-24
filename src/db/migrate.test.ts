import { expect, onTestFinished, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from './migrate.ts';
import { MIGRATIONS } from './migrations.ts';

// A scratch folder with a child script that opens and migrates the database it is given, the way an
// hq command does after an install, and 4 database paths in it.
async function setupTest() {
  const dir = mkdtempSync(join(tmpdir(), 'hq-migrate-')),
    paths = [0, 1, 2, 3].map((round) => join(dir, `hq-${round}.db`)),
    script = join(dir, 'child.ts');
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  await Bun.write(script, `import { openDb } from ${JSON.stringify(join(import.meta.dir, 'open-db.ts'))};\nconsole.log(openDb(process.argv[2]).query('PRAGMA user_version').get().user_version);\n`);
  return { paths, script };
}

test.each([
  ['5 versions behind', true, 4],
  ['not yet created', false, 0],
])('4 migrators started at once against one database %s all finish at the newest schema, 4 times over', async (_case, isBehind, seeded) => {
  const app = await setupTest(),
    behind = app.paths.filter(() => isBehind).map((path) => {
      const db = new Database(path, { create: true, strict: true });
      db.exec('PRAGMA journal_mode = WAL;');
      migrate(db, path, false, MIGRATIONS.slice(0, -5));
      db.close();
      return path;
    }),
    children = app.paths.flatMap((path) => [0, 1, 2, 3].map(() => Bun.spawn(['bun', app.script, path], { stdout: 'pipe', stderr: 'pipe' }))),
    codes = await Promise.all(children.map(async (child) => await child.exited)),
    stderrs = await Promise.all(children.map(async (child) => await new Response(child.stderr).text().then((text) => text.trim()))),
    versions = await Promise.all(children.map(async (child) => await new Response(child.stdout).text().then((text) => text.trim())));

  expect({ seeded: behind.length, codes, stderrs, versions }).toStrictEqual({ seeded, codes: children.map(() => 0), stderrs: children.map(() => ''), versions: children.map(() => String(MIGRATIONS.length)) });
});

test('v35 adds the pr_status table and keeps the rows already in the database', () => {
  const base = mkdtempSync(join(tmpdir(), 'hq-migrate-v35-')),
    db = new Database(join(base, 'hq.db'), { create: true, strict: true }),
    path = join(base, 'hq.db');
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  onTestFinished(() => db.close());
  db.exec('PRAGMA journal_mode = WAL;');
  migrate(db, path, false, MIGRATIONS.slice(0, 34));
  db.query("INSERT INTO events (subject, subject_id, action, actor, at, data) VALUES ('hq', 'kettle', 'boil', 'z-kettle', '2026-10-14T01:00:00Z', '{}')").run();

  expect(migrate(db, path, true, MIGRATIONS.slice(0, 35))).not.toBeNull();
  expect(db.query('SELECT subject_id, action FROM events').all()).toStrictEqual([{ subject_id: 'kettle', action: 'boil' }]);
  expect(db.query('SELECT name FROM pragma_table_info(\'pr_status\') ORDER BY cid').all()).toStrictEqual(
    ['repo', 'pr', 'head', 'gate', 'gate_head', 'gate_at', 'answer', 'answer_head', 'answer_source', 'answer_note', 'answer_at', 'next', 'next_at', 'updated_at'].map((name) => ({ name })),
  );
});

test('v36 adds the shipped_cache table and keeps the rows already in the database', () => {
  const base = mkdtempSync(join(tmpdir(), 'hq-migrate-v36-')),
    db = new Database(join(base, 'hq.db'), { create: true, strict: true }),
    path = join(base, 'hq.db');
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  onTestFinished(() => db.close());
  db.exec('PRAGMA journal_mode = WAL;');
  migrate(db, path, false, MIGRATIONS.slice(0, 35));
  db.query("INSERT INTO pr_status (repo, pr, updated_at) VALUES ('kettle', 7, '2026-10-14T01:00:00Z')").run();

  expect(migrate(db, path, true, MIGRATIONS.slice(0, 36))).not.toBeNull();
  expect(db.query('SELECT repo, pr FROM pr_status').all()).toStrictEqual([{ repo: 'kettle', pr: 7 }]);
  expect(db.query("SELECT name FROM pragma_table_info('shipped_cache') ORDER BY cid").all()).toStrictEqual(['kind', 'key', 'body', 'fetched_at', 'expires_at'].map((name) => ({ name })));
  expect((db.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(36);
});

test('it adds done_when to unblocks in v37 and keeps every row', () => {
  const base = mkdtempSync(join(tmpdir(), 'hq-migrate-v37-'));
  const db = new Database(join(base, 'hq.db'), { create: true, strict: true });
  const path = join(base, 'hq.db');
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  onTestFinished(() => db.close());
  db.exec('PRAGMA journal_mode = WAL;');
  migrate(db, path, false, MIGRATIONS.slice(0, 36));
  db.query(
    "INSERT INTO unblocks (id, task, unblocks, notify, added_by, state, added_seq, added_at, updated_at) VALUES ('kettle', 'Descale the kettle', '[]', '[]', 'kettle-triage', 'open', 1, '2026-10-14T01:00:00Z', '2026-10-14T01:00:00Z')",
  ).run();

  expect(migrate(db, path, true, MIGRATIONS.slice(0, 37))).not.toBeNull();
  expect(db.query('SELECT id, task, state, done_when FROM unblocks').all()).toStrictEqual([{ id: 'kettle', task: 'Descale the kettle', state: 'open', done_when: null }]);
  expect(db.query('PRAGMA user_version').get()).toStrictEqual({ user_version: 37 });
});

test('v38 lets a follow-up be a review one and keeps every follow-up', () => {
  const base = mkdtempSync(join(tmpdir(), 'hq-migrate-v38-'));
  const db = new Database(join(base, 'hq.db'), { create: true, strict: true });
  const path = join(base, 'hq.db');
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  onTestFinished(() => db.close());
  db.exec('PRAGMA journal_mode = WAL;');
  migrate(db, path, false, MIGRATIONS.slice(0, 37));
  db.query("INSERT INTO followups (issue, from_ref, filed_at, source, added_by, added_at) VALUES ('GEO-9801', 'kettle#3', '2026-10-14T01:00:00Z', 'final', 'z-kettle', '2026-10-14T01:00:00Z')").run();

  expect(migrate(db, path, true, MIGRATIONS.slice(0, 38))).not.toBeNull();
  db.query("INSERT INTO followups (issue, from_ref, filed_at, source, added_by, added_at) VALUES ('GEO-9802', 'widgets#7', '2026-10-15T01:00:00Z', 'review', 'z-kettle', '2026-10-15T01:00:00Z')").run();
  expect(db.query('SELECT issue, from_ref, source FROM followups ORDER BY issue').all()).toStrictEqual([
    { issue: 'GEO-9801', from_ref: 'kettle#3', source: 'final' },
    { issue: 'GEO-9802', from_ref: 'widgets#7', source: 'review' },
  ]);
  expect(db.query("SELECT name FROM pragma_table_info('linear_filed') ORDER BY cid").all()).toStrictEqual(['issue', 'created_at', 'source', 'pr_ref', 'fetched_at'].map((name) => ({ name })));
});

test('it adds the focus table in v39 and keeps every row', () => {
  const base = mkdtempSync(join(tmpdir(), 'hq-migrate-v39-'));
  const db = new Database(join(base, 'hq.db'), { create: true, strict: true });
  const path = join(base, 'hq.db');
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  onTestFinished(() => db.close());
  db.exec('PRAGMA journal_mode = WAL;');
  migrate(db, path, false, MIGRATIONS.slice(0, 38));
  db.query("INSERT INTO meta (key, value) VALUES ('kettle', 'warm')").run();

  expect(migrate(db, path, true, MIGRATIONS.slice(0, 39))).not.toBeNull();
  expect(db.query('SELECT key, value FROM meta').all()).toStrictEqual([{ key: 'kettle', value: 'warm' }]);
  expect(db.query("SELECT name FROM pragma_table_info('focus') ORDER BY cid").all()).toStrictEqual(['id', 'terms', 'reserves', 'set_at', 'set_by'].map((name) => ({ name })));
  expect(db.query('PRAGMA user_version').get()).toStrictEqual({ user_version: 39 });
});

test('it adds kind, deadline and overdue_told_at to unblocks in v40, and keeps every row as an owner item', () => {
  const base = mkdtempSync(join(tmpdir(), 'hq-migrate-v40-'));
  const db = new Database(join(base, 'hq.db'), { create: true, strict: true });
  const path = join(base, 'hq.db');
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  onTestFinished(() => db.close());
  db.exec('PRAGMA journal_mode = WAL;');
  migrate(db, path, false, MIGRATIONS.slice(0, 39));
  db.query(
    "INSERT INTO unblocks (id, task, unblocks, notify, added_by, state, added_seq, added_at, updated_at) VALUES ('kettle', 'Descale the kettle', '[]', '[]', 'kettle-triage', 'open', 1, '2026-10-14T01:00:00Z', '2026-10-14T01:00:00Z')",
  ).run();

  expect(migrate(db, path, true, MIGRATIONS.slice(0, 40))).not.toBeNull();
  expect(db.query('SELECT id, task, kind, deadline, overdue_told_at FROM unblocks').all()).toStrictEqual([{ id: 'kettle', task: 'Descale the kettle', kind: 'owner', deadline: null, overdue_told_at: null }]);
  expect(() => db.query("UPDATE unblocks SET kind = 'teapot' WHERE id = 'kettle'").run()).toThrow(/CHECK constraint failed/u);
  expect(db.query('PRAGMA user_version').get()).toStrictEqual({ user_version: 40 });
});

test('it adds the Claude window reset times in v41, NULL on every older row', () => {
  const base = mkdtempSync(join(tmpdir(), 'hq-migrate-v41-'));
  const db = new Database(join(base, 'hq.db'), { create: true, strict: true });
  const path = join(base, 'hq.db');
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  onTestFinished(() => db.close());
  db.exec('PRAGMA journal_mode = WAL;');
  migrate(db, path, false, MIGRATIONS.slice(0, 40));
  db.query("INSERT INTO usage_samples (at, account, five_hour, seven_day) VALUES ('2026-10-14T01:00:00Z', 'abcdef012345', 10, 20)").run();

  expect(migrate(db, path, true, MIGRATIONS.slice(0, 41))).not.toBeNull();
  expect(db.query('SELECT account, five_hour_resets_at, seven_day_resets_at FROM usage_samples').all()).toStrictEqual([{ account: 'abcdef012345', five_hour_resets_at: null, seven_day_resets_at: null }]);
  expect(db.query("SELECT name FROM pragma_table_info('capacity_samples') WHERE name LIKE 'claude_%_resets_at' ORDER BY name").all()).toStrictEqual([{ name: 'claude_five_hour_resets_at' }, { name: 'claude_seven_day_resets_at' }]);
  expect(db.query('PRAGMA user_version').get()).toStrictEqual({ user_version: 41 });
});

test('it adds the slot-minutes table in v42 and refuses a cause outside the three', () => {
  const base = mkdtempSync(join(tmpdir(), 'hq-migrate-v42-'));
  const db = new Database(join(base, 'hq.db'), { create: true, strict: true });
  const path = join(base, 'hq.db');
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  onTestFinished(() => db.close());
  db.exec('PRAGMA journal_mode = WAL;');
  migrate(db, path, false, MIGRATIONS.slice(0, 41));

  expect(migrate(db, path, true, MIGRATIONS.slice(0, 42))).not.toBeNull();
  db.query("INSERT INTO slot_minutes (day, cause, minutes) VALUES ('2026-10-14', 'delivery', 12.5)").run();
  expect(db.query('SELECT day, cause, minutes FROM slot_minutes').all()).toStrictEqual([{ day: '2026-10-14', cause: 'delivery', minutes: 12.5 }]);
  expect(() => db.query("INSERT INTO slot_minutes (day, cause, minutes) VALUES ('2026-10-14', 'kettle', 1)").run()).toThrow(/CHECK constraint failed/u);
  expect(() => db.query("INSERT INTO slot_minutes (day, cause, minutes) VALUES ('2026-10-14', 'delivery', 1)").run()).toThrow(/UNIQUE constraint failed/u);
  expect(db.query('PRAGMA user_version').get()).toStrictEqual({ user_version: 42 });
});

test('it adds the void columns to grant_actions in v43, keeps every row as it was, and makes v43 the newest schema', () => {
  const base = mkdtempSync(join(tmpdir(), 'hq-migrate-v43-'));
  const db = new Database(join(base, 'hq.db'), { create: true, strict: true });
  const path = join(base, 'hq.db');
  onTestFinished(() => rmSync(base, { recursive: true, force: true }));
  onTestFinished(() => db.close());
  db.exec('PRAGMA journal_mode = WAL;');
  migrate(db, path, false, MIGRATIONS.slice(0, 42));
  db.query("INSERT INTO grant_actions (grant_name, target, note, actor, at) VALUES ('kettle-merges', 'kettle#9', 'on green', 'teapot-bot', '2026-10-14T01:00:00Z'), ('kettle-merges', 'kettle#10', NULL, 'kettle-bot', '2026-10-14T02:00:00Z')").run();

  expect(migrate(db, path, true)).not.toBeNull();
  expect(db.query('SELECT id, grant_name, target, note, actor, at, voided_at, voided_by, void_reason FROM grant_actions ORDER BY id').all()).toStrictEqual([
    { id: 1, grant_name: 'kettle-merges', target: 'kettle#9', note: 'on green', actor: 'teapot-bot', at: '2026-10-14T01:00:00Z', voided_at: null, voided_by: null, void_reason: null },
    { id: 2, grant_name: 'kettle-merges', target: 'kettle#10', note: null, actor: 'kettle-bot', at: '2026-10-14T02:00:00Z', voided_at: null, voided_by: null, void_reason: null },
  ]);
  expect(db.query('PRAGMA user_version').get()).toStrictEqual({ user_version: 43 });
});
