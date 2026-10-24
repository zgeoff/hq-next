import { expect, test } from 'bun:test';
import { parseGrantVoidArgs } from './parse-grant-void-args.ts';

test('an act id and a reason parse, the reason trimmed', () => {
  expect(parseGrantVoidArgs(['3855'], ' logged before the merge failed ')).toStrictEqual({ id: 3855, reason: 'logged before the merge failed' });
});

test.each([
  [['0'], 'wrong PR', 'the act id must be a positive whole number'],
  [['-4'], 'wrong PR', 'the act id must be a positive whole number'],
  [['2.5'], 'wrong PR', 'the act id must be a positive whole number'],
  [['kettle'], 'wrong PR', 'the act id must be a positive whole number'],
  [['9007199254740993'], 'wrong PR', 'the act id is too large'],
  [[], 'wrong PR', 'the act id is missing'],
  [['4', '5'], 'wrong PR', 'hq grant void takes one act id'],
  [['4'], undefined, '--reason is required'],
  [['4'], '   ', '--reason must say why'],
  [['4'], 'one\ntwo', '--reason must be one line'],
  [['4'], 'x'.repeat(201), '--reason is over 200 characters'],
])('%j with reason %j is refused: %s', (rest, reason, message) => {
  expect(() => parseGrantVoidArgs(rest, reason)).toThrow(message);
});
