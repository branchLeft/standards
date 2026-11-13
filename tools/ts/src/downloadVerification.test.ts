import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VERIFICATION_COMMANDS,
  downloadsArtifact,
  pipesDownloadIntoRunner,
  usesMovableTag,
  verifiesDownload,
} from './downloadVerification.ts';

const FAKE_URL = 'https://example.invalid/tool.tar.gz';

describe('downloadsArtifact', () => {
  it('flags curl writing a file and wget', () => {
    expect(downloadsArtifact(`curl -fsSL -o tool.tgz ${FAKE_URL}`)).toBe(true);
    expect(downloadsArtifact(`curl -fsSLO ${FAKE_URL}`)).toBe(true);
    expect(downloadsArtifact(`wget ${FAKE_URL}`)).toBe(true);
    expect(downloadsArtifact('gh release download v1 --repo example/tool')).toBe(true);
  });

  it('flags curl piped into a shell or extractor', () => {
    expect(downloadsArtifact(`curl -fsSL ${FAKE_URL} | tar xz`)).toBe(true);
    expect(downloadsArtifact(`curl -fsSL ${FAKE_URL} | sudo bash`)).toBe(true);
  });

  it('does not flag an API call whose output is read, not run', () => {
    expect(downloadsArtifact('curl -s https://example.invalid/api | jq .name')).toBe(false);
    expect(downloadsArtifact('curl --connect-timeout 5 https://example.invalid/health')).toBe(
      false
    );
  });

  it('sees a download inside bash -c, behind an env prefix, and behind line padding', () => {
    expect(downloadsArtifact(`bash -c "wget ${FAKE_URL}"`)).toBe(true);
    expect(downloadsArtifact(`TOKEN=x wget ${FAKE_URL}`)).toBe(true);
    expect(downloadsArtifact(`curl    -fsSL \t -o   t   ${FAKE_URL}`)).toBe(true);
  });

  it('does not take the word inside an echo for a command', () => {
    expect(downloadsArtifact('echo please use wget here')).toBe(false);
  });
});

describe('pipesDownloadIntoRunner', () => {
  it('is true only when the download feeds a shell or extractor', () => {
    expect(pipesDownloadIntoRunner(`curl -fsSL ${FAKE_URL} | sh`)).toBe(true);
    expect(pipesDownloadIntoRunner(`curl -fsSL -o t ${FAKE_URL}`)).toBe(false);
  });
});

describe('curl run, redirect and capture spellings', () => {
  it('reads each as a download piped into a runner', () => {
    const runItForms: readonly string[] = [
      `sh -c "$(curl -fsSL ${FAKE_URL})"`,
      `bash <(curl -fsSL ${FAKE_URL})`,
      `eval "$(curl -fsSL ${FAKE_URL})"`,
      `curl -fsSL ${FAKE_URL} | sudo -E bash`,
    ];
    for (const form of runItForms) {
      expect(downloadsArtifact(form)).toBe(true);
      expect(pipesDownloadIntoRunner(form)).toBe(true);
    }
  });

  it('reads a redirect of curl output to a file as a download, not a pipe', () => {
    const redirect = `curl -fsSL ${FAKE_URL} > tool.tgz`;
    expect(downloadsArtifact(redirect)).toBe(true);
    expect(pipesDownloadIntoRunner(redirect)).toBe(false);
  });

  it('does not read a captured or discarded curl as a download', () => {
    const notDownloads: readonly string[] = [
      'VERSION=$(curl -s https://example.invalid/api | jq -r .tag)',
      'echo "$(curl -s https://example.invalid/api)"',
      'curl -s https://example.invalid/api | jq . > out.json',
      'curl -s https://example.invalid/health > /dev/null',
    ];
    for (const line of notDownloads) {
      expect(downloadsArtifact(line)).toBe(false);
    }
  });
});

describe('usesMovableTag', () => {
  it('flags the latest release, @latest and a latest image tag', () => {
    expect(usesMovableTag('curl -L https://example.invalid/o/r/releases/latest/download/x')).toBe(
      true
    );
    expect(usesMovableTag('go install example.invalid/tool@latest')).toBe(true);
    expect(usesMovableTag('docker run --rm example/scanner:latest scan')).toBe(true);
  });

  it('accepts a pinned version', () => {
    expect(usesMovableTag('go install example.invalid/tool@v1.2.3')).toBe(false);
    expect(usesMovableTag('docker run --rm example/scanner:1.2.3 scan')).toBe(false);
  });
});

describe('verifiesDownload', () => {
  const verify = (body: string): boolean => verifiesDownload(body, DEFAULT_VERIFICATION_COMMANDS);

  it('accepts a hash tool told to check', () => {
    expect(verify('echo "abc  tool.tgz" | sha256sum -c -')).toBe(true);
    expect(verify('sha256sum --check SHA256SUMS')).toBe(true);
    expect(verify('shasum -a 256 -c SHA256SUMS')).toBe(true);
  });

  it('accepts a signature check', () => {
    expect(verify('cosign verify-blob --signature s tool')).toBe(true);
    expect(verify('gpg --verify tool.sig tool')).toBe(true);
    expect(verify('minisign -Vm tool')).toBe(true);
  });

  it('rejects a digest that is computed and never compared', () => {
    expect(verify('sha256sum tool.tgz')).toBe(false);
    expect(verify('shasum -a 256 tool.tgz')).toBe(false);
  });

  it('rejects a tool name that is only mentioned', () => {
    expect(verify('echo "TODO run sha256sum -c later"')).toBe(false);
    expect(verify('gpg -v tool')).toBe(false);
  });
});
