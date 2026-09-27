import { describe, expect, it } from 'vitest';
import { hasEnvironmentKey, splitWorkflowJobs, usesDeploySecret } from './workflowJobs.ts';

describe('splitWorkflowJobs', () => {
  it('splits two sibling jobs by indentation', () => {
    const content = [
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo hi',
      '  deploy:',
      '    runs-on: ubuntu-latest',
      '    environment: production',
    ].join('\n');
    const jobs = splitWorkflowJobs(content);
    expect(jobs.map((job) => job.name)).toEqual(['build', 'deploy']);
    expect(jobs[1]?.line).toBe(6);
    expect(jobs[1]?.body).toContain('environment: production');
  });

  it('reports nothing for a file with no jobs: key', () => {
    expect(splitWorkflowJobs('on: push\n')).toHaveLength(0);
  });

  it('closes the last job even with no trailing content', () => {
    const jobs = splitWorkflowJobs('jobs:\n  only:\n    runs-on: ubuntu-latest');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.name).toBe('only');
  });

  it('closes the last job on de-denting back out of jobs: to a sibling top-level key', () => {
    const content = ['jobs:', '  build:', '    runs-on: ubuntu-latest', 'concurrency: ci'].join(
      '\n'
    );
    const jobs = splitWorkflowJobs(content);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.name).toBe('build');
  });

  it('starts a fresh jobs: block after de-denting out of an earlier one', () => {
    const content = [
      'jobs:',
      '  first:',
      '    runs-on: ubuntu-latest',
      'jobs:',
      '  second:',
      '    runs-on: ubuntu-latest',
    ].join('\n');
    const jobs = splitWorkflowJobs(content);
    expect(jobs.map((job) => job.name)).toEqual(['first', 'second']);
  });
});

describe('usesDeploySecret', () => {
  it('matches a secret name containing a configured substring', () => {
    expect(usesDeploySecret('token: ${{ secrets.DEPLOY_TOKEN }}', ['DEPLOY'])).toBe(true);
  });

  it('does not match an unrelated secret name', () => {
    expect(usesDeploySecret('token: ${{ secrets.GITHUB_TOKEN }}', ['DEPLOY'])).toBe(false);
  });

  it('is case-sensitive, since GitHub secret names are conventionally upper-case', () => {
    expect(usesDeploySecret('secrets.deploy_token', ['DEPLOY'])).toBe(false);
  });
});

describe('hasEnvironmentKey', () => {
  it('finds a top-level environment: key', () => {
    expect(hasEnvironmentKey('runs-on: ubuntu-latest\nenvironment: production\n')).toBe(true);
  });

  it('finds an indented environment: key', () => {
    expect(
      hasEnvironmentKey('runs-on: ubuntu-latest\n  environment:\n    name: production\n')
    ).toBe(true);
  });

  it('reports false when no environment key is present', () => {
    expect(hasEnvironmentKey('runs-on: ubuntu-latest\n')).toBe(false);
  });
});
