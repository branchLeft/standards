import { describe, expect, it } from 'vitest';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { findNativeSuppressions } from './nativeSuppressions.ts';

const ROOT = '/repo';

describe('findNativeSuppressions', () => {
  it('finds shellcheck and hadolint suppressions, indented and 1-based', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'a.sh', 'line one\n# shellcheck disable=SC2059\nline three\n');
    fs.set(ROOT, 'Dockerfile', 'FROM x\n# hadolint ignore=DL3008\n');
    const hits = findNativeSuppressions(fs, ROOT, ['a.sh', 'Dockerfile']);
    expect(hits).toEqual(['    a.sh:2', '    Dockerfile:2']);
  });

  it('reports nothing for a clean tree', () => {
    const fs = new FakeFileSystem();
    fs.set(ROOT, 'a.sh', 'clean\n');
    expect(findNativeSuppressions(fs, ROOT, ['a.sh'])).toEqual([]);
  });
});
