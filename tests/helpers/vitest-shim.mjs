// 让从 SuYan 原样搬来的 vitest 测试在 node --test 下运行：只实现这些测试用到的 describe/it/expect 匹配器。
import { describe as nodeDescribe, it as nodeIt } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

export const describe = nodeDescribe;
export const it = nodeIt;
export const test = nodeIt;

// it.each([[a, b], ...])("名字 %s", (a, b) => {...})：每组参数一个用例，%s 依次换成参数。
it.each = (rows) => (name, fn) => {
  for (const row of rows) {
    const args = Array.isArray(row) ? row : [row];
    let index = 0;
    nodeIt(name.replace(/%[sdj]/g, () => String(args[index++])), () => fn(...args));
  }
};

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
    toMatch: (pattern) => check(typeof pattern === 'string' ? String(actual).includes(pattern) : pattern.test(String(actual)), `expected ${show(actual)} to match ${pattern}`),
    toBeLessThanOrEqual: (limit) => check(actual <= limit, `expected ${show(actual)} <= ${limit}`),
    toBeCloseTo: (target, digits = 2) => check(Math.abs(actual - target) < 10 ** -digits / 2, `expected ${show(actual)} to be close to ${target}`),
    // toThrow(消息)：actual 是函数，调用后必须抛错，给了消息时要包含它。
    toThrow: (message) => {
      let thrown = null;
      try {
        actual();
      } catch (error) {
        thrown = error;
      }
      check(Boolean(thrown) && (message === undefined || String(thrown?.message).includes(message)), `expected to throw ${message ?? ''}, got ${thrown?.message ?? 'nothing'}`);
    },
  };
}

export function expect(actual) {
  return { ...matchers(actual, false), not: matchers(actual, true) };
}

expect.arrayContaining = (expected) => ({
  label: `arrayContaining ${JSON.stringify(expected)}`,
  [ASYMMETRIC]: (actual) => Array.isArray(actual) && expected.every((value) => contains(actual, value)),
});
