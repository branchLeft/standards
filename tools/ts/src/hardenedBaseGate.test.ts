import { describe, expect, it } from 'vitest';
import { HardenedBaseGate } from './hardenedBaseGate.ts';
import { FakeFileSystem } from './test-support/fakeFileSystem.ts';
import { FakeGitClient } from './test-support/fakeGitClient.ts';
import { Ratchet } from './ratchet.ts';

const ROOT = '/repo';
const TOOLS_ROOT = '/tools';
const DIGEST = 'sha256:' + 'a'.repeat(64);

function gateFor(content: string, promoted: ReadonlySet<string> = new Set()): HardenedBaseGate {
  const fs = new FakeFileSystem();
  fs.set(ROOT, 'Dockerfile', content);
  const git = new FakeGitClient({ root: ROOT, files: ['Dockerfile'] });
  const ratchet = Ratchet.init(git, fs, ROOT, { mode: 'enforce', promoted });
  return new HardenedBaseGate(ratchet, fs, TOOLS_ROOT);
}

describe('HardenedBaseGate', () => {
  it('accepts a Docker Hardened Image base', () => {
    const gate = gateFor(`FROM docker/dhi-node:20-slim@${DIGEST}`);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('accepts the Debian slim fallback', () => {
    const gate = gateFor(`FROM debian:bookworm-slim@${DIGEST}`);
    expect(gate.run({ root: ROOT, mode: 'enforce' })).toHaveLength(0);
  });

  it('flags CON-1 for a base image that is neither hardened nor Debian slim', () => {
    const gate = gateFor(`FROM node:20-bookworm-slim@${DIGEST}`);
    const findings = gate.run({ root: ROOT, mode: 'enforce' });
    expect(findings.map((f) => f.clause)).toEqual(['CON-1']);
  });

  it('stays advisory even when its clause is on the promoted list', () => {
    const gate = gateFor(`FROM node:20@${DIGEST}`, new Set(['CON-1']));
    expect(gate.advisory).toBe(true);
    expect(gate.run({ root: ROOT, mode: 'enforce' }).map((f) => f.level)).toEqual(['advisory']);
  });
});
