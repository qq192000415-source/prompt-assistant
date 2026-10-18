// 让从 SuYan 原样搬来的 vitest 测试在 node --test 下运行：只实现这些测试用到的 describe/it/expect 匹配器。
import { describe as nodeDescribe, it as nodeIt } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

export const describe = nodeDescribe;
export const it = nodeIt;
export const test = nodeIt;

// toMatchObject：期望里写到的字段必须相等，实际值可以多出别的字段；数组按位置逐个比较。
function matchesObject(actual, expected) {
  if (expected === null || typeof expected !== 'object') return isDeepStrictEqual(actual, expected);
  if (actual === null || typeof actual !== 'object') return false;
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((value, index) => matchesObject(actual[index], value));
  }
  return Object.keys(expected).every((key) => matchesObject(actual[key], expected[key]));
}

function contains(actual, expected) {
  if (typeof actual === 'string') return actual.includes(expected);
  return Array.isArray(actual) && actual.some((entry) => isDeepStrictEqual(entry, expected));
}

// expect.arrayContaining 这类「部分匹配」的期望值。
const ASYMMETRIC = Symbol('asymmetric');

function matchers(actual, negate) {
  const check = (passed, message) => assert.ok(negate ? !passed : passed, `${negate ? 'not ' : ''}${message}`);
  const show = (value) => JSON.stringify(value)?.slice(0, 400);
  return {
    toBe: (expected) => check(Object.is(actual, expected), `expected ${show(actual)} to be ${show(expected)}`),
    toEqual: (expected) => {
      if (expected?.[ASYMMETRIC]) check(expected[ASYMMETRIC](actual), `expected ${show(actual)} to equal ${expected.label}`);
      else if (negate) check(isDeepStrictEqual(actual, expected), 'equal');
      else assert.deepEqual(JSON.parse(JSON.stringify(actual ?? null)), JSON.parse(JSON.stringify(expected ?? null)));
    },
    toContain: (expected) => check(contains(actual, expected), `expected ${show(actual)} to contain ${show(expected)}`),
    toMatchObject: (expected) => check(matchesObject(actual, expected), `expected ${show(actual)} to match ${show(expected)}`),
    toBeNull: () => check(actual === null, `expected ${show(actual)} to be null`),
    toHaveLength: (length) => check(actual?.length === length, `expected length ${actual?.length} to be ${length}`),
  };
}

export function expect(actual) {
  return { ...matchers(actual, false), not: matchers(actual, true) };
}

expect.arrayContaining = (expected) => ({
  label: `arrayContaining ${JSON.stringify(expected)}`,
  [ASYMMETRIC]: (actual) => Array.isArray(actual) && expected.every((value) => contains(actual, value)),
});
