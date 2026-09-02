import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('defines the required project commands', () => {
  const packagePath = join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
    scripts?: Record<string, string>;
  };

  expect(packageJson.scripts).toMatchObject({
    build: 'tsc --noEmit',
    test: 'vitest run',
    start: 'tsx src/cli.ts start',
    capture: 'tsx src/cli.ts capture',
    record: 'tsx src/cli.ts record',
    inspect: 'tsx src/cli.ts inspect',
  });
});
