/**
 * A ~60-line test runner. No framework, no build step, no dependencies —
 * it runs in the same browser the app runs in, which is the only environment
 * the app actually targets.
 */

const suites = [];
let current = null;

export function describe(name, body) {
  current = { name, tests: [] };
  suites.push(current);
  body();
  current = null;
}

export function it(name, body) {
  if (!current) throw new Error('it() must be called inside describe()');
  current.tests.push({ name, body });
}

export function expect(actual) {
  return {
    toBe(expected) {
      if (!Object.is(actual, expected)) {
        throw new Error(`expected ${format(expected)}, got ${format(actual)}`);
      }
    },
    toEqual(expected) {
      const a = JSON.stringify(actual);
      const b = JSON.stringify(expected);
      if (a !== b) throw new Error(`expected ${b}, got ${a}`);
    },
    toContain(needle) {
      const ok = typeof actual === 'string' ? actual.includes(needle) : [...actual].includes(needle);
      if (!ok) throw new Error(`expected ${format(actual)} to contain ${format(needle)}`);
    },
    notToContain(needle) {
      const ok = typeof actual === 'string' ? actual.includes(needle) : [...actual].includes(needle);
      if (ok) throw new Error(`expected ${format(actual)} not to contain ${format(needle)}`);
    },
    toBeTruthy() {
      if (!actual) throw new Error(`expected a truthy value, got ${format(actual)}`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`expected a falsy value, got ${format(actual)}`);
    },
    toHaveLength(length) {
      if (actual?.length !== length) {
        throw new Error(`expected length ${length}, got ${actual?.length}`);
      }
    },
  };
}

function format(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** @returns {Promise<{ passed: number, failed: number, results: object[] }>} */
export async function run(output) {
  let passed = 0;
  let failed = 0;
  const results = [];

  for (const suite of suites) {
    const group = { name: suite.name, tests: [] };
    results.push(group);

    for (const test of suite.tests) {
      try {
        await test.body();
        passed += 1;
        group.tests.push({ name: test.name, ok: true });
      } catch (error) {
        failed += 1;
        group.tests.push({ name: test.name, ok: false, message: error.message });
      }
    }
  }

  if (output) render(output, results, passed, failed);
  return { passed, failed, results };
}

function render(output, results, passed, failed) {
  output.textContent = '';

  const summary = document.createElement('p');
  summary.className = failed ? 'summary summary--fail' : 'summary summary--pass';
  summary.textContent = `${passed} passed, ${failed} failed`;
  output.append(summary);

  for (const suite of results) {
    const section = document.createElement('section');
    const heading = document.createElement('h2');
    heading.textContent = suite.name;
    section.append(heading);

    const list = document.createElement('ul');
    for (const test of suite.tests) {
      const item = document.createElement('li');
      item.className = test.ok ? 'ok' : 'fail';
      item.textContent = `${test.ok ? '✓' : '✕'} ${test.name}`;
      if (!test.ok) {
        const message = document.createElement('pre');
        message.textContent = test.message;
        item.append(message);
      }
      list.append(item);
    }

    section.append(list);
    output.append(section);
  }
}
