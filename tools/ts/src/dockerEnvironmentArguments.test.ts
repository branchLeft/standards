import { describe, expect, it } from 'vitest';
import { parseEnvironmentArguments } from './dockerEnvironmentArguments.ts';

describe('parseEnvironmentArguments', () => {
  it('parses the legacy single-pair form', () => {
    expect(parseEnvironmentArguments('LISTEN_HOST 0.0.0.0')).toEqual([
      { key: 'LISTEN_HOST', value: '0.0.0.0' },
    ]);
  });

  it('parses multiple KEY=value pairs', () => {
    expect(parseEnvironmentArguments('PORT=8080 NODE_ENV=production')).toEqual([
      { key: 'PORT', value: '8080' },
      { key: 'NODE_ENV', value: 'production' },
    ]);
  });

  it('keeps a quoted value with spaces as one pair, unquoted', () => {
    expect(parseEnvironmentArguments('GREETING="hello world"')).toEqual([
      { key: 'GREETING', value: 'hello world' },
    ]);
  });

  it('returns nothing for a legacy form with no value', () => {
    expect(parseEnvironmentArguments('LISTEN_HOST')).toEqual([]);
  });
});
