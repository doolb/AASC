import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
it('defines the required project commands', () => {
    const packagePath = join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    expect(packageJson.scripts).toMatchObject({
        build: 'node --check src/cli.js',
        test: 'vitest run',
        start: 'node src/cli.js start',
        capture: 'node src/cli.js capture',
        record: 'node src/cli.js record',
        inspect: 'node src/cli.js inspect',
        'nav-check': 'node src/cli.js nav-check',
        'nav-chain': 'node src/cli.js nav-chain',
        'nav-serve': 'node src/cli.js nav-serve',
    });
});
