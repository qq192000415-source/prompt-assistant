// 让从 SuYan 原样搬来的 vitest 测试在 node --test 下运行：只实现这些测试用到的 describe/it/expect/vi。
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

// expect.any、expect.stringMatching 这类「部分匹配」的期望值。
const ASYMMETRIC = Symbol('asymmetric');
const asymmetric = (label, test) => ({ label, [ASYMMETRIC]: test });
const isPlainObject = (value) => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const hasAsymmetric = (value) =>
  Boolean(value?.[ASYMMETRIC]) || (Array.isArray(value) ? value.some(hasAsymmetric) : isPlainObject(value) && Object.values(value).some(hasAsymmetric));

// toMatchObject：期望里写到的字段必须相等，实际值可以多出别的字段；数组按位置逐个比较。
function matchesObject(actual, expected) {
  if (expected?.[ASYMMETRIC]) return expected[ASYMMETRIC](actual);
  if (expected === null || typeof expected !== 'object') return isDeepStrictEqual(actual, expected);
  if (actual === null || typeof actual !== 'object') return false;
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((value, index) => matchesObject(actual[index], value));
  }
  return Object.keys(expected).every((key) => matchesObject(actual[key], expected[key]));
}

// toEqual 有部分匹配时逐层比较；和 vitest 一样忽略值为 undefined 的字段。
function equals(actual, expected) {
  if (expected?.[ASYMMETRIC]) return expected[ASYMMETRIC](actual);
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value, index) => equals(actual[index], value));
  if (isPlainObject(expected)) {
    if (!actual || typeof actual !== 'object') return false;
    const keys = (object) => Object.keys(object).filter((key) => object[key] !== undefined).sort();
    return isDeepStrictEqual(keys(actual), keys(expected)) && keys(expected).every((key) => equals(actual[key], expected[key]));
  }
  return isDeepStrictEqual(actual, expected);
}

function contains(actual, expected) {
  if (typeof actual === 'string') return actual.includes(expected);
  return Array.isArray(actual) && actual.some((entry) => isDeepStrictEqual(entry, expected));
}

const callsOf = (mock) => {
  assert.ok(mock?.mock?.calls, 'expected a vi.fn() mock');
  return mock.mock.calls;
};

const messageMatches = (error, message) =>
  message === undefined || (message instanceof RegExp ? message.test(String(error?.message)) : String(error?.message).includes(message));

function matchers(actual, negate) {
  const check = (passed, message) => assert.ok(negate ? !passed : passed, `${negate ? 'not ' : ''}${message}`);
  const show = (value) => JSON.stringify(value)?.slice(0, 400);
  return {
    toBe: (expected) => check(Object.is(actual, expected), `expected ${show(actual)} to be ${show(expected)}`),
    toEqual: (expected) => {
      if (negate || hasAsymmetric(expected)) check(equals(actual, expected), `expected ${show(actual)} to equal ${expected?.label ?? show(expected)}`);
      else assert.deepEqual(JSON.parse(JSON.stringify(actual ?? null)), JSON.parse(JSON.stringify(expected ?? null)));
    },
    toContain: (expected) => check(contains(actual, expected), `expected ${show(actual)} to contain ${show(expected)}`),
    toMatchObject: (expected) => check(matchesObject(actual, expected), `expected ${show(actual)} to match ${show(expected)}`),
    toBeNull: () => check(actual === null, `expected ${show(actual)} to be null`),
    toHaveLength: (length) => check(actual?.length === length, `expected length ${actual?.length} to be ${length}`),
    toMatch: (pattern) => check(typeof pattern === 'string' ? String(actual).includes(pattern) : pattern.test(String(actual)), `expected ${show(actual)} to match ${pattern}`),
    toBeLessThanOrEqual: (limit) => check(actual <= limit, `expected ${show(actual)} <= ${limit}`),
    toBeCloseTo: (target, digits = 2) => check(Math.abs(actual - target) < 10 ** -digits / 2, `expected ${show(actual)} to be close to ${target}`),
    toBeTypeOf: (type) => check(typeof actual === type, `expected ${show(actual)} to be of type ${type}`),
    toBeInstanceOf: (type) => check(actual instanceof type, `expected ${show(actual)} to be instance of ${type?.name}`),
    // toHaveProperty(键, 值)：只支持一层键名，给了值时要相等。
    toHaveProperty: (key, ...value) =>
      check(actual != null && key in Object(actual) && (value.length === 0 || equals(actual[key], value[0])), `expected ${show(actual)} to have property ${key}`),
    toHaveBeenCalled: () => check(callsOf(actual).length > 0, 'expected mock to have been called'),
    toHaveBeenCalledTimes: (count) => check(callsOf(actual).length === count, `expected ${count} calls, got ${callsOf(actual).length}`),
    toHaveBeenCalledWith: (...args) => check(callsOf(actual).some((call) => equals(call, args)), `expected a call with ${show(args)}`),
    toThrowError: (message) => matchers(actual, negate).toThrow(message),
    // toThrow(消息)：actual 是函数，调用后必须抛错，给了消息时要包含它（也可以是正则）。
    toThrow: (message) => {
      let thrown = null;
      try {
        actual();
      } catch (error) {
        thrown = error;
      }
      check(Boolean(thrown) && messageMatches(thrown, message), `expected to throw ${message ?? ''}, got ${thrown?.message ?? 'nothing'}`);
    },
  };
}

// expect(promise).resolves / .rejects：等它落定后再对结果或错误用同一套匹配器。
function settled(promise, wantRejection) {
  return new Proxy({}, {
    get: (_target, name) => async (...args) => {
      let value;
      let rejected = false;
      try {
        value = await promise;
      } catch (error) {
        value = error;
        rejected = true;
      }
      assert.equal(
        rejected,
        wantRejection,
        wantRejection ? `expected promise to reject, it resolved with ${JSON.stringify(value)?.slice(0, 200)}` : `expected promise to resolve, it rejected: ${value?.message ?? value}`,
      );
      if (name === 'toThrow') {
        assert.ok(messageMatches(value, args[0]), `expected rejection "${value?.message}" to match ${args[0]}`);
        return undefined;
      }
      return matchers(value, false)[name](...args);
    },
  });
}

export function expect(actual) {
  return {
    ...matchers(actual, false),
    not: matchers(actual, true),
    get resolves() {
      return settled(actual, false);
    },
    get rejects() {
      return settled(actual, true);
    },
  };
}

expect.arrayContaining = (expected) =>
  asymmetric(`arrayContaining ${JSON.stringify(expected)}`, (actual) => Array.isArray(actual) && expected.every((value) => contains(actual, value)));
expect.objectContaining = (expected) => asymmetric(`objectContaining ${JSON.stringify(expected)}`, (actual) => matchesObject(actual, expected));
expect.stringContaining = (expected) => asymmetric(`stringContaining ${expected}`, (actual) => typeof actual === 'string' && actual.includes(expected));
expect.stringMatching = (pattern) => asymmetric(`stringMatching ${pattern}`, (actual) => typeof actual === 'string' && new RegExp(pattern).test(actual));
const PRIMITIVE_TYPES = new Map([
  [String, 'string'],
  [Number, 'number'],
  [Boolean, 'boolean'],
  [Function, 'function'],
]);
expect.any = (type) =>
  asymmetric(`any ${type?.name}`, (actual) => (PRIMITIVE_TYPES.has(type) ? typeof actual === PRIMITIVE_TYPES.get(type) : actual instanceof type));

// vi.fn 和 vi.stubGlobal：只实现 SuYan 测试用到的部分（记录调用、设定返回值、临时替换全局变量）。
const stubbedGlobals = new Map();

export const vi = {
  fn(implementation) {
    let current = implementation;
    const once = [];
    const mock = function (...args) {
      mock.mock.calls.push(args);
      const run = once.length ? once.shift() : current;
      return run ? run.apply(this, args) : undefined;
    };
    mock.mock = { calls: [] };
    mock.mockImplementation = (next) => ((current = next), mock);
    mock.mockReturnValue = (value) => ((current = () => value), mock);
    mock.mockResolvedValue = (value) => ((current = async () => value), mock);
    mock.mockRejectedValue = (error) => ((current = async () => Promise.reject(error)), mock);
    mock.mockResolvedValueOnce = (value) => (once.push(async () => value), mock);
    mock.mockClear = () => ((mock.mock.calls = []), mock);
    return mock;
  },
  stubGlobal(name, value) {
    if (!stubbedGlobals.has(name)) stubbedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    globalThis[name] = value;
  },
  unstubAllGlobals() {
    for (const [name, descriptor] of stubbedGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    stubbedGlobals.clear();
  },
};
