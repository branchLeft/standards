import { describe, expect, it } from 'vitest';
import {
  isSecretLikeEnvironmentVariable,
  usesFileConvention,
} from './secretEnvironmentVariable.ts';

describe('isSecretLikeEnvironmentVariable', () => {
  it('flags SCREAMING_SNAKE secret names', () => {
    expect(isSecretLikeEnvironmentVariable('MYSQL_ROOT_PASSWORD')).toBe(true);
    expect(isSecretLikeEnvironmentVariable('SHIM_DRAIN_TOKEN')).toBe(true);
  });

  it('flags Ghost-style double-underscore nested keys', () => {
    expect(isSecretLikeEnvironmentVariable('database__connection__password')).toBe(true);
    expect(isSecretLikeEnvironmentVariable('mail__options__auth__pass')).toBe(true);
  });

  it('flags camelCase joined-phrase secrets', () => {
    expect(isSecretLikeEnvironmentVariable('storage__S3Storage__secretAccessKey')).toBe(true);
    expect(isSecretLikeEnvironmentVariable('storage__S3Storage__accessKeyId')).toBe(true);
  });

  it('does not flag an ordinary configuration value', () => {
    expect(isSecretLikeEnvironmentVariable('database__connection__host')).toBe(false);
    expect(isSecretLikeEnvironmentVariable('LISTEN_HOST')).toBe(false);
    expect(isSecretLikeEnvironmentVariable('PORT')).toBe(false);
  });

  it('exempts the _FILE convention', () => {
    expect(isSecretLikeEnvironmentVariable('GHOST_DB_PASSWORD_FILE')).toBe(false);
    expect(usesFileConvention('GHOST_DB_PASSWORD_FILE')).toBe(true);
    expect(usesFileConvention('GHOST_DB_PASSWORD')).toBe(false);
  });
});
