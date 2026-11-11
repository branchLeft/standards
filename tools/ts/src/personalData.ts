export type PersonalDataKind = 'email address' | 'client IP address in a log line';

export interface PersonalDataSettings {
  /** Lower-case local parts that name a role, not a person (`noreply`). */
  readonly roleMailboxes: ReadonlySet<string>;
  /** Lower-case domains whose addresses are placeholders, subdomains included. */
  readonly placeholderDomains: ReadonlySet<string>;
}

// Longer lines are minified bundles or encoded blobs, not prose or a pasted log.
const MAX_LINE_LENGTH = 2000;

const EMAIL = /([A-Za-z0-9._%+-]+)@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})/g;
const IPV4 = /(?<![\w.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?!\w|\.\d)/g;

// RFC 2606 and RFC 6761 reserved names: never a real mailbox, so never a person.
const RESERVED_TOP_LEVELS = ['example', 'test', 'invalid', 'localhost'];
const RESERVED_DOMAINS = ['example.com', 'example.org', 'example.net'];

// `logo@2x.png` has the shape of an address and is a file name.
const FILE_EXTENSION_LABELS = new Set([
  'ts',
  'tsx',
  'js',
  'mjs',
  'cjs',
  'jsx',
  'json',
  'md',
  'py',
  'sh',
  'yml',
  'yaml',
  'toml',
  'css',
  'scss',
  'html',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'ico',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'lock',
  'txt',
  'map',
  'wasm',
  'zip',
  'gz',
  'tgz',
  'pdf',
]);

const TIMESTAMPS = [
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/,
  /\d{2}\/[A-Za-z]{3}\/\d{4}:\d{2}:\d{2}/,
  /\b[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\b/,
];

function isUnderDomain(domain: string, root: string): boolean {
  return domain === root || domain.endsWith(`.${root}`);
}

function isPlaceholderDomain(domain: string, settings: PersonalDataSettings): boolean {
  const lower = domain.toLowerCase();
  const labels = lower.split('.');
  const last = labels[labels.length - 1] ?? '';
  if (RESERVED_TOP_LEVELS.includes(last) || FILE_EXTENSION_LABELS.has(last)) {
    return true;
  }
  const placeholders = [...RESERVED_DOMAINS, ...settings.placeholderDomains];
  return placeholders.some((root) => isUnderDomain(lower, root));
}

// `https://user:secret@host` carries a credential in the URL's userinfo, which
// is the credential clauses' concern; `mailto:` has no `//` and is still caught.
function isUrlUserinfo(line: string, matchStart: number): boolean {
  const before = line.slice(0, matchStart);
  const token = before.slice(before.search(/\S*$/));
  return token.includes('://');
}

function hasEmailAddress(line: string, settings: PersonalDataSettings): boolean {
  for (const match of line.matchAll(EMAIL)) {
    const local = (match[1] ?? '').toLowerCase();
    const domain = match[2] ?? '';
    if (settings.roleMailboxes.has(local)) continue;
    if (isPlaceholderDomain(domain, settings)) continue;
    if (isUrlUserinfo(line, match.index)) continue;
    return true;
  }
  return false;
}

function toInteger(octets: readonly number[]): number {
  return octets.reduce((total, octet) => total * 256 + octet, 0);
}

// [first octets, prefix length]: unspecified, private, shared, loopback,
// link-local, benchmark, the RFC 5737 documentation ranges, multicast and reserved.
const NON_PERSONAL_BLOCKS: readonly (readonly [readonly number[], number])[] = [
  [[0, 0, 0, 0], 8],
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10],
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12],
  [[192, 0, 2, 0], 24],
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],
  [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24],
  [[224, 0, 0, 0], 3],
];

function isInBlock(address: number, block: readonly [readonly number[], number]): boolean {
  const size = 2 ** (32 - block[1]);
  return Math.floor(address / size) === Math.floor(toInteger(block[0]) / size);
}

function isPublicIpv4(octets: readonly number[]): boolean {
  if (octets.some((octet) => octet > 255)) return false;
  const address = toInteger(octets);
  return !NON_PERSONAL_BLOCKS.some((block) => isInBlock(address, block));
}

function hasLogLineClientAddress(line: string): boolean {
  if (!TIMESTAMPS.some((pattern) => pattern.test(line))) return false;
  for (const match of line.matchAll(IPV4)) {
    if (isPublicIpv4(match.slice(1, 5).map(Number))) return true;
  }
  return false;
}

/**
 * Which kinds of personal data one line carries. Never returns the matched
 * value: the finding is printed to CI logs, which DP-7 itself keeps clean.
 */
export function detectPersonalData(
  line: string,
  settings: PersonalDataSettings
): readonly PersonalDataKind[] {
  if (line.length > MAX_LINE_LENGTH) return [];
  const kinds: PersonalDataKind[] = [];
  if (hasEmailAddress(line, settings)) kinds.push('email address');
  if (hasLogLineClientAddress(line)) kinds.push('client IP address in a log line');
  return kinds;
}
