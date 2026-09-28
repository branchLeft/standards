import { describe, expect, it } from 'vitest';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { isBinaryInstalled } from './localBinary.ts';

const ROOT = '/repo';

describe('isBinaryInstalled', () => {
  it('is false when nothing is installed', () => {
    const fs = new FakeFileSystem();
    expect(isBinaryInstalled(fs, ROOT, 'eslint')).toBe(false);
  });

  it('is true for a binary at the repo root', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'node_modules/.bin/eslint', '#!/usr/bin/env node\n');
    expect(isBinaryInstalled(fs, ROOT, 'eslint')).toBe(true);
  });

  it('is true for a binary hoisted above the repo root', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, '../../node_modules/.bin/eslint', '#!/usr/bin/env node\n');
    expect(isBinaryInstalled(fs, ROOT, 'eslint')).toBe(true);
  });

  it('is false once the ancestor walk is exhausted', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, `${'../'.repeat(9)}node_modules/.bin/eslint`, '#!/usr/bin/env node\n');
    expect(isBinaryInstalled(fs, ROOT, 'eslint')).toBe(false);
  });

  it('does not answer for a differently named binary', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'node_modules/.bin/eslint', '#!/usr/bin/env node\n');
    expect(isBinaryInstalled(fs, ROOT, 'drizzle-kit')).toBe(false);
  });
});
