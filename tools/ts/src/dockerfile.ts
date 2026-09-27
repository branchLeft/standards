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

function joinContinuations(content: string): readonly { text: string; line: number }[] {
  const rawLines = content.split('\n');
  const joined: { text: string; line: number }[] = [];
  let buffer = '';
  let startLine = 0;
  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = rawLines[index] ?? '';
    if (buffer === '') {
      startLine = index + 1;
    }
    const withoutContinuation = raw.replace(CONTINUATION_SUFFIX, '');
    const continues = CONTINUATION_SUFFIX.test(raw) && !raw.trim().startsWith('#');
    buffer += (buffer === '' ? '' : ' ') + withoutContinuation.trim();
    if (!continues) {
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
      const match = FROM_AS_PATTERN.exec(instructionArguments);
      current = {
        name: match?.[2],
        baseImage: match?.[1] ?? instructionArguments,
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
