/**
 * Recognises secret-shaped environment variable names for CRED-10, whatever
 * casing convention names it (`SCREAMING_SNAKE`, `camelCase`, or Ghost's own
 * `double__underscore` nesting). Regex-based, like `migrationClassifier.ts`
 * — see secretEnvironmentVariable.md for what it does and doesn't catch.
 */
const SECRET_SEGMENTS: ReadonlySet<string> = new Set([
  'password',
  'passwd',
  'pwd',
  'pass',
  'secret',
  'token',
  'credential',
]);
const SECRET_JOINED_PHRASES: readonly string[] = [
  'apikey',
  'accesskey',
  'privatekey',
  'clientsecret',
];

function normalizeSegments(key: string): readonly string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((segment) => segment.length > 0);
}

/** The `_FILE` convention CRED-10 asks for — a compliant name, never a finding. */
export function usesFileConvention(key: string): boolean {
  return /_file$/i.test(key);
}

export function isSecretLikeEnvironmentVariable(key: string): boolean {
  if (usesFileConvention(key)) {
    return false;
  }
  const segments = normalizeSegments(key);
  if (segments.some((segment) => SECRET_SEGMENTS.has(segment))) {
    return true;
  }
  const joined = segments.join('');
  return SECRET_JOINED_PHRASES.some((phrase) => joined.includes(phrase));
}
