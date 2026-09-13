type TestBody = () => void | Promise<void>;

interface RegisteredTest {
  name: string;
  body: TestBody;
}

const tests: RegisteredTest[] = [];

export function test(name: string, body: TestBody): void {
  tests.push({ name, body });
}

export function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) throw new Error(message);
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(message ?? `Expected ${String(expected)}, received ${String(actual)}`);
  }
}

export function assertDeepEqual(actual: unknown, expected: unknown, message?: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(message ?? `Expected ${expectedJson}, received ${actualJson}`);
  }
}

export function assertThrows(body: () => unknown, messageIncludes?: string): void {
  let thrown: unknown = null;
  try {
    body();
  } catch (error) {
    thrown = error;
  }

  if (!thrown) throw new Error('Expected function to throw.');
  if (messageIncludes) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    if (!message.includes(messageIncludes)) {
      throw new Error(`Expected thrown message to include ${messageIncludes}, received ${message}`);
    }
  }
}

export async function runRegisteredTests(): Promise<void> {
  let passed = 0;
  const failures: string[] = [];

  for (const entry of tests) {
    try {
      await entry.body();
      passed += 1;
      console.log(`✓ ${entry.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      failures.push(`${entry.name}\n${message}`);
      console.error(`✗ ${entry.name}`);
    }
  }

  console.log(`\nTikatuka tests: ${passed}/${tests.length} passed`);
  if (failures.length > 0) {
    console.error(`\n${failures.join('\n\n')}`);
    throw new Error(`${failures.length} Tikatuka test(s) failed.`);
  }
}
