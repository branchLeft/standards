const COMMAND_START =
  '(?:^|[;&|({`]\\s*|\\b(?:sudo|xargs|time|exec)\\s+|\\b(?:ba|z|da)?sh\\s+-c\\s+[\'"]|\\b\\w+=\\S*\\s+)';
const WGET = new RegExp(`${COMMAND_START}wget(?:\\s|$)`, 'm');
const CURL = new RegExp(`${COMMAND_START}curl(?:\\s|$)`, 'm');
const GH_RELEASE_DOWNLOAD = /\bgh\s+release\s+download\b/;
const CURL_WRITES_FILE =
  /(?:^|\s)(?:-[A-Za-z]*[oO][A-Za-z]*|--output|--remote-name(?:-all)?|--remote-header-name)(?:\s|=|$)/;
const PIPED_TO_RUNNER =
  /\|\s*(?:sudo\s+(?:-\S+\s+)*)?(?:sh|bash|zsh|dash|tar|unzip|gunzip|zcat|bunzip2|xz|python3?|node|install|dpkg|apt(?:-get)?)\b/;
const RUN_A_FETCH = /\b(?:eval|(?:ba|z|da)?sh(?:\s+-c)?|source)\s+["']?[$<]\(\s*curl(?:\s|$)/;
const REDIRECT_TO_FILE = /(?:^|\s)1?>>?\s*(?!&|\/dev\/null(?:\s|$))\S/;
const MOVABLE_URL = /\/releases\/latest\/download\//;
const MOVABLE_GO_OR_NPM =
  /\b(?:go\s+install|npm\s+(?:i|install)|pnpm\s+(?:add|install)|yarn\s+(?:global\s+)?add)\b[^\n]*@latest\b/;
const MOVABLE_IMAGE = /\bdocker\s+(?:run|pull)\b[^\n]*\s\S+:latest(?:\s|$)/;

// A hash tool verifies only when told to compare (`-c` or `--check`); run
// bare it merely prints a digest, which proves nothing about the file.
const CHECK_FLAG = /(?:^|\s)(?:-[A-Za-z0-9]*c[A-Za-z0-9]*|--check)(?=\s|$)/;
const HASH_TOOLS: ReadonlySet<string> = new Set([
  'sha256sum',
  'sha512sum',
  'sha1sum',
  'shasum',
  'b3sum',
]);
const VERIFY_WORD = /(?:^|\s)(?:--?verify\S*|verify\S*|-V\S*)(?=\s|$)/;
export const DEFAULT_VERIFICATION_COMMANDS: readonly string[] = [
  'sha256sum',
  'sha512sum',
  'sha1sum',
  'shasum',
  'b3sum',
  'cosign',
  'gpg',
  'gpgv',
  'minisign',
  'slsa-verifier',
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The logical lines of a script with runs of blanks collapsed, so a command
 * reflowed across lines or padded with tabs still matches. Case is kept:
 * flags are case-sensitive (`gpg -v` is verbose, `minisign -V` verifies).
 */
function logicalLines(body: string): readonly string[] {
  return body
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '');
}

/** True when the curl command on `line` has its stdout redirected to a file. */
function curlRedirectsToFile(line: string): boolean {
  const match = CURL.exec(line);
  if (!match) {
    return false;
  }
  // A redirect after a pipe belongs to the next command, not to curl.
  const segment = line.slice(match.index + match[0].length).split(/\||;|&&|\)/)[0] ?? '';
  return REDIRECT_TO_FILE.test(segment);
}

/** True when `body` fetches a file or an archive to run or unpack, as opposed to calling an API. */
export function downloadsArtifact(body: string): boolean {
  return logicalLines(body).some((line) => {
    if (WGET.test(line) || GH_RELEASE_DOWNLOAD.test(line) || RUN_A_FETCH.test(line)) {
      return true;
    }
    return (
      CURL.test(line) &&
      (CURL_WRITES_FILE.test(line) || PIPED_TO_RUNNER.test(line) || curlRedirectsToFile(line))
    );
  });
}

/** True when `body` pipes a download straight into a shell or an extractor, which leaves nothing to verify. */
export function pipesDownloadIntoRunner(body: string): boolean {
  return logicalLines(body).some(
    (line) =>
      RUN_A_FETCH.test(line) || ((WGET.test(line) || CURL.test(line)) && PIPED_TO_RUNNER.test(line))
  );
}

/** True when `body` pins a tool to a movable tag: the `latest` release, `@latest`, or an image's `latest` tag. */
export function usesMovableTag(body: string): boolean {
  return logicalLines(body).some(
    (line) => MOVABLE_URL.test(line) || MOVABLE_GO_OR_NPM.test(line) || MOVABLE_IMAGE.test(line)
  );
}

function verifies(line: string, tool: string): boolean {
  const command = new RegExp(`${COMMAND_START}(?:\\S*/)?${escapeRegExp(tool)}(?:\\s|$)`);
  const match = command.exec(line);
  if (!match) {
    return false;
  }
  const rest = line.slice(match.index + match[0].length - 1);
  return HASH_TOOLS.has(tool) ? CHECK_FLAG.test(rest) : VERIFY_WORD.test(rest);
}

/**
 * True when `body` runs a command that checks a downloaded file against a
 * digest or a signature. Naming the tool in an `echo`, or computing a digest
 * without comparing it, does not count.
 */
export function verifiesDownload(body: string, tools: readonly string[]): boolean {
  const lines = logicalLines(body);
  return tools.some((tool) => lines.some((line) => verifies(line, tool)));
}
