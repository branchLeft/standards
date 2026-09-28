import { describe, expect, it } from 'vitest';
import { parseCliOptions } from './cliOptions.ts';

describe('parseCliOptions', () => {
  it('defaults to no mode override, human output and every gate', () => {
    expect(parseCliOptions([])).toEqual({ mode: undefined, json: false, advisoryOnly: false });
  });

  it('reads --mode warn', () => {
    expect(parseCliOptions(['--mode', 'warn']).mode).toBe('warn');
  });

  it('reads --mode enforce', () => {
    expect(parseCliOptions(['--mode', 'enforce']).mode).toBe('enforce');
  });

  it('rejects an unrecognised mode value', () => {
    expect(() => parseCliOptions(['--mode', 'strict'])).toThrow(/must be 'warn' or 'enforce'/);
  });

  it('sets json on --json', () => {
    expect(parseCliOptions(['--json']).json).toBe(true);
  });

  it('sets advisoryOnly on --advisory-only', () => {
    expect(parseCliOptions(['--advisory-only']).advisoryOnly).toBe(true);
  });

  it('combines every flag in one call', () => {
    expect(parseCliOptions(['--mode', 'warn', '--json', '--advisory-only'])).toEqual({
      mode: 'warn',
      json: true,
      advisoryOnly: true,
    });
  });

  it('rejects an unknown option', () => {
    expect(() => parseCliOptions(['--bogus'])).toThrow(/unknown option --bogus/);
  });
});
