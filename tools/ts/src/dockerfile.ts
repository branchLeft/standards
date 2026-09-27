/**
 * A minimal Dockerfile parser: enough to read instructions, their arguments
 * and multi-stage `FROM ... AS name` boundaries. No plugin syntax, no
 * `ARG`-in-`FROM` substitution, no heredocs — see dockerfile.md.
 */
export interface DockerInstruction {
  readonly line: number;
  readonly keyword: string;
  readonly args: string;
}

export interface DockerStage {
  readonly name: string | undefined;
  readonly baseImage: string;
  readonly fromLine: number;
  readonly instructions: readonly DockerInstruction[];
}

const CONTINUATION_SUFFIX = /\\\s*$/;
const FROM_AS_PATTERN = /^(\S+)(?:\s+AS\s+(\S+))?/i;
// One or more `--flag` or `--flag=value` tokens, e.g. `--platform=linux/amd64`
// ahead of `FROM`'s image argument.
const LEADING_FLAGS_PATTERN = /^(?:--[\w-]+(?:=\S+)?\s+)+/;

function stripLeadingFlags(instructionArguments: string): string {
  return instructionArguments.replace(LEADING_FLAGS_PATTERN, '');
}

// Comments and continuations interact: a `#`-prefixed line in the middle of
// a `\`-continued instruction contributes nothing, but — unlike a comment
// ending a real instruction — it does not end the continuation either.
// BuildKit ignores such lines and keeps joining; treating them as a hard
// stop (as a naive per-line check would) splits the rest of the shell
// command into a bogus new "instruction".
function joinContinuations(content: string): readonly { text: string; line: number }[] {
  const rawLines = content.split('\n');
  const joined: { text: string; line: number }[] = [];
  let buffer = '';
  let startLine = 0;
  let continuing = false;
  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = rawLines[index] ?? '';
    const trimmed = raw.trim();
    if (continuing && trimmed.startsWith('#')) {
      continue;
    }
    if (buffer === '') {
      startLine = index + 1;
    }
    const withoutContinuation = raw.replace(CONTINUATION_SUFFIX, '');
    const lineContinues = CONTINUATION_SUFFIX.test(raw) && !trimmed.startsWith('#');
    buffer += (buffer === '' ? '' : ' ') + withoutContinuation.trim();
    continuing = lineContinues;
    if (!lineContinues) {
      joined.push({ text: buffer, line: startLine });
      buffer = '';
    }
  }
  if (buffer !== '') {
    joined.push({ text: buffer, line: startLine });
  }
  return joined;
}

/** Splits `Dockerfile` content into stages, one per `FROM`. */
export function parseDockerfile(content: string): readonly DockerStage[] {
  const stages: DockerStage[] = [];
  let current:
    | {
        name: string | undefined;
        baseImage: string;
        fromLine: number;
        instructions: DockerInstruction[];
      }
    | undefined;

  for (const { text, line } of joinContinuations(content)) {
    if (text === '' || text.startsWith('#')) {
      continue;
    }
    const spaceIndex = text.search(/\s/);
    const keyword = (spaceIndex === -1 ? text : text.slice(0, spaceIndex)).toUpperCase();
    const instructionArguments = spaceIndex === -1 ? '' : text.slice(spaceIndex + 1).trim();

    if (keyword === 'FROM') {
      if (current) {
        stages.push(current);
      }
      const fromArguments = stripLeadingFlags(instructionArguments);
      const match = FROM_AS_PATTERN.exec(fromArguments);
      current = {
        name: match?.[2],
        baseImage: match?.[1] ?? fromArguments,
        fromLine: line,
        instructions: [],
      };
      continue;
    }
    current?.instructions.push({ line, keyword, args: instructionArguments });
  }
  if (current) {
    stages.push(current);
  }
  return stages;
}

/** The last stage is what actually ships — earlier stages are build-only. */
export function finalStage(stages: readonly DockerStage[]): DockerStage | undefined {
  return stages[stages.length - 1];
}

/** True when `reference` names an earlier stage rather than a registry image. */
export function isStageReference(reference: string, stages: readonly DockerStage[]): boolean {
  return stages.some((stage) => stage.name === reference);
}
