import { describe, expect, it } from 'vitest';
import { finalStage, isStageReference, parseDockerfile } from './dockerfile.ts';

describe('parseDockerfile', () => {
  it('parses a single-stage Dockerfile', () => {
    const stages = parseDockerfile(
      ['FROM debian:bookworm-slim', 'USER 1000', 'HEALTHCHECK CMD true'].join('\n')
    );
    expect(stages).toHaveLength(1);
    expect(stages[0]?.baseImage).toBe('debian:bookworm-slim');
    expect(stages[0]?.instructions.map((item) => item.keyword)).toEqual(['USER', 'HEALTHCHECK']);
  });

  it('splits multi-stage builds at each FROM and names stages via AS', () => {
    const content = [
      'FROM node:20 AS build',
      'RUN npm ci',
      'FROM debian:bookworm-slim',
      'COPY --from=build /app /app',
      'USER 1000',
    ].join('\n');
    const stages = parseDockerfile(content);
    expect(stages).toHaveLength(2);
    expect(stages[0]?.name).toBe('build');
    expect(stages[1]?.name).toBeUndefined();
    expect(finalStage(stages)).toBe(stages[1]);
  });

  it('recognises a FROM referencing an earlier stage by name', () => {
    const stages = parseDockerfile(['FROM node:20 AS build', 'FROM build', 'USER 1000'].join('\n'));
    expect(isStageReference('build', stages)).toBe(true);
    expect(isStageReference('node:20', stages)).toBe(false);
  });

  it('joins backslash line continuations into one instruction', () => {
    const content = [
      'FROM debian:bookworm-slim',
      'RUN apt-get update \\',
      '    && apt-get install -y curl',
    ].join('\n');
    const stages = parseDockerfile(content);
    expect(stages[0]?.instructions[0]?.args).toBe('apt-get update && apt-get install -y curl');
  });

  it('is case-insensitive on the instruction keyword', () => {
    const stages = parseDockerfile('from debian:bookworm-slim\nuser 1000');
    expect(stages[0]?.instructions[0]?.keyword).toBe('USER');
  });

  it('skips comment lines', () => {
    const stages = parseDockerfile(
      ['FROM debian:bookworm-slim', '# a comment', 'USER 1000'].join('\n')
    );
    expect(stages[0]?.instructions).toHaveLength(1);
  });

  it('reports the FROM line number for a stage', () => {
    const stages = parseDockerfile(['# header comment', 'FROM debian:bookworm-slim'].join('\n'));
    expect(stages[0]?.fromLine).toBe(2);
  });

  it('returns no stages for content with no FROM', () => {
    expect(parseDockerfile('# just a comment\n')).toEqual([]);
  });
});
