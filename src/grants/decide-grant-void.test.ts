import { expect, test } from 'bun:test';
import { decideGrantVoid } from './decide-grant-void.ts';

test('it lets the session recorded for the act actor void the act', () => {
  const decision = decideGrantVoid({
    action: { id: 3, grant_name: 'kettle-merges', target: 'kettle#9', note: null, actor: 'teapot-bot', at: '2026-10-14T01:00:00Z', voided_at: null, voided_by: null, void_reason: null },
    caller: { kind: 'session', id: 'kettle-2' },
    fleetIDs: { 'z-stu': 'kettle-1', 'teapot-bot': 'kettle-2' },
    owner: 'z-stu',
    request: { id: 3, reason: 'wrong PR' },
  });

  expect(decision).toStrictEqual({
    ok: true,
    action: { id: 3, grant_name: 'kettle-merges', target: 'kettle#9', note: null, actor: 'teapot-bot', at: '2026-10-14T01:00:00Z', voided_at: null, voided_by: null, void_reason: null },
    voidedBy: 'teapot-bot',
    from: 'live',
    to: 'void',
  });
});

test('it lets the owner session void an act another session logged, as the owner', () => {
  const decision = decideGrantVoid({
    action: { id: 3, grant_name: 'kettle-merges', target: 'kettle#9', note: null, actor: 'teapot-bot', at: '2026-10-14T01:00:00Z', voided_at: null, voided_by: null, void_reason: null },
    caller: { kind: 'session', id: 'kettle-1' },
    fleetIDs: { 'z-stu': 'kettle-1', 'teapot-bot': 'kettle-2' },
    owner: 'z-stu',
    request: { id: 3, reason: 'wrong PR' },
  });

  expect(decision).toMatchObject({ ok: true, voidedBy: 'z-stu' });
});

test('it refuses an act id with no act as not found', () => {
  const decision = decideGrantVoid({ action: null, caller: { kind: 'session', id: 'kettle-1' }, fleetIDs: { 'z-stu': 'kettle-1' }, owner: 'z-stu', request: { id: 7, reason: 'wrong PR' } });

  expect(decision).toStrictEqual({ ok: false, code: 'not_found', message: 'no grant action 7', state: null });
});

test('it refuses another recorded session, naming who may void the act', () => {
  const decision = decideGrantVoid({
    action: { id: 3, grant_name: 'kettle-merges', target: 'kettle#9', note: null, actor: 'teapot-bot', at: '2026-10-14T01:00:00Z', voided_at: null, voided_by: null, void_reason: null },
    caller: { kind: 'session', id: 'kettle-3' },
    fleetIDs: { 'z-stu': 'kettle-1', 'teapot-bot': 'kettle-2', 'kettle-bot': 'kettle-3' },
    owner: 'z-stu',
    request: { id: 3, reason: 'wrong PR' },
  });

  expect(decision).toStrictEqual({ ok: false, code: 'not_allowed', message: 'only teapot-bot, who logged grant action 3, or z-stu may void it', state: null });
});

test('it refuses the act actor when hq fleet recorded no session for it', () => {
  const decision = decideGrantVoid({
    action: { id: 3, grant_name: 'kettle-merges', target: 'kettle#9', note: null, actor: 'teapot-bot', at: '2026-10-14T01:00:00Z', voided_at: null, voided_by: null, void_reason: null },
    caller: { kind: 'session', id: 'kettle-2' },
    fleetIDs: { 'z-stu': 'kettle-1' },
    owner: 'z-stu',
    request: { id: 3, reason: 'wrong PR' },
  });

  expect(decision).toStrictEqual({ ok: false, code: 'not_allowed', message: 'only teapot-bot, who logged grant action 3, or z-stu may void it', state: null });
});

test('it refuses a caller atc cannot name, and gives atc its cause', () => {
  const decision = decideGrantVoid({
    action: { id: 3, grant_name: 'kettle-merges', target: 'kettle#9', note: null, actor: 'teapot-bot', at: '2026-10-14T01:00:00Z', voided_at: null, voided_by: null, void_reason: null },
    caller: { kind: 'unknown', cause: 'atc found no session for the caller' },
    fleetIDs: { 'z-stu': 'kettle-1', 'teapot-bot': 'kettle-2' },
    owner: 'z-stu',
    request: { id: 3, reason: 'wrong PR' },
  });

  expect(decision).toStrictEqual({ ok: false, code: 'not_allowed', message: 'only teapot-bot, who logged grant action 3, or z-stu may void it; atc cannot say who is calling (atc found no session for the caller)', state: null });
});

test('it refuses to void a void act, naming when, by whom and why it was voided', () => {
  const decision = decideGrantVoid({
    action: { id: 3, grant_name: 'kettle-merges', target: 'kettle#9', note: null, actor: 'teapot-bot', at: '2026-10-14T01:00:00Z', voided_at: '2026-10-14T03:00:00Z', voided_by: 'teapot-bot', void_reason: 'wrong PR' },
    caller: { kind: 'session', id: 'kettle-1' },
    fleetIDs: { 'z-stu': 'kettle-1', 'teapot-bot': 'kettle-2' },
    owner: 'z-stu',
    request: { id: 3, reason: 'again' },
  });

  expect(decision).toStrictEqual({ ok: false, code: 'bad_state', message: 'grant action 3 was already voided at 2026-10-14T03:00:00Z by teapot-bot: wrong PR', state: 'void' });
});
