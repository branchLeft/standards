import { describe, expect, it } from 'vitest';
import { detectPersonalData } from './personalData.ts';
import type { PersonalDataSettings } from './personalData.ts';

// Addresses are assembled at run time so this file, which the repo scans, does
// not carry an address-shaped literal of its own.
const AT = '@';
const address = (local: string, domain: string): string => `${local}${AT}${domain}`;
const logLine = (ip: string): string => ['2026-11-10T09:30:00Z', 'GET /health', ip].join(' ');

const SETTINGS: PersonalDataSettings = {
  roleMailboxes: new Set(['noreply', 'git']),
  placeholderDomains: new Set(['placeholder-corp.net']),
};

describe('detectPersonalData: email addresses', () => {
  it('flags an address on a real-looking domain', () => {
    expect(detectPersonalData(`contact ${address('alice', 'corp-mail.net')}`, SETTINGS)).toEqual([
      'email address',
    ]);
  });

  it('flags an address after mailto:', () => {
    const line = `<a href="mailto:${address('alice', 'corp-mail.net')}">`;
    expect(detectPersonalData(line, SETTINGS)).toEqual(['email address']);
  });

  it('does not flag RFC 2606 reserved example domains or their subdomains', () => {
    for (const domain of ['example.com', 'example.org', 'mail.example.net', 'host.test']) {
      expect(detectPersonalData(address('alice', domain), SETTINGS)).toEqual([]);
    }
  });

  it('does not flag a domain the settings list as a placeholder', () => {
    expect(detectPersonalData(address('alice', 'ops.placeholder-corp.net'), SETTINGS)).toEqual([]);
  });

  it('does not flag a role mailbox, in any case', () => {
    expect(detectPersonalData(address('NoReply', 'corp-mail.net'), SETTINGS)).toEqual([]);
  });

  it('does not flag a file name that has the shape of an address', () => {
    expect(detectPersonalData(`![logo](${address('logo', '2x.png')})`, SETTINGS)).toEqual([]);
  });

  it('does not flag credentials in a URL userinfo', () => {
    const line = `https://deploy:hunter2${AT}registry.corp-mail.net/path`;
    expect(detectPersonalData(line, SETTINGS)).toEqual([]);
  });

  it('does not flag a package pin or an image digest', () => {
    expect(detectPersonalData(`pnpm add pkg${AT}1.2.3 img${AT}sha256:abc`, SETTINGS)).toEqual([]);
  });

  it('skips a minified-length line rather than scan it', () => {
    const line = `${'x'.repeat(2001)} ${address('alice', 'corp-mail.net')}`;
    expect(detectPersonalData(line, SETTINGS)).toEqual([]);
  });
});

describe('detectPersonalData: client addresses in log lines', () => {
  it('flags a public IPv4 address beside a timestamp', () => {
    expect(detectPersonalData(logLine('8.8.8.8'), SETTINGS)).toEqual([
      'client IP address in a log line',
    ]);
  });

  it('flags a common-log-format line', () => {
    const line = ['8.8.8.8', '-', '-', '[10/Nov/2026:09:30:00 +0000]', '"GET / HTTP/1.1"'].join(
      ' '
    );
    expect(detectPersonalData(line, SETTINGS)).toEqual(['client IP address in a log line']);
  });

  it('does not flag an address with no timestamp on the line', () => {
    expect(detectPersonalData('dns upstream 8.8.8.8', SETTINGS)).toEqual([]);
  });

  it('does not flag private, loopback, link-local or documentation ranges', () => {
    for (const ip of ['10.1.2.3', '127.0.0.1', '172.20.0.5', '192.168.1.9', '169.254.1.1']) {
      expect(detectPersonalData(logLine(ip), SETTINGS)).toEqual([]);
    }
    for (const ip of ['192.0.2.7', '198.51.100.7', '203.0.113.7']) {
      expect(detectPersonalData(logLine(ip), SETTINGS)).toEqual([]);
    }
  });

  it('flags the addresses just outside the private and shared blocks', () => {
    for (const ip of ['172.15.0.1', '172.32.0.1', '100.63.0.1', '100.128.0.1', '11.0.0.1']) {
      expect(detectPersonalData(logLine(ip), SETTINGS)).toEqual([
        'client IP address in a log line',
      ]);
    }
  });

  it('does not flag shared, benchmark or multicast space', () => {
    for (const ip of ['100.64.0.1', '100.127.255.254', '198.18.0.1', '198.19.255.1', '239.1.1.1']) {
      expect(detectPersonalData(logLine(ip), SETTINGS)).toEqual([]);
    }
  });

  it('does not flag a version number or an out-of-range quad', () => {
    expect(detectPersonalData(logLine('999.1.1.1'), SETTINGS)).toEqual([]);
    expect(detectPersonalData(logLine('v8.8.8.8'), SETTINGS)).toEqual([]);
    expect(detectPersonalData(logLine('8.8.8.8.8'), SETTINGS)).toEqual([]);
  });

  it('reports both kinds when a line carries both', () => {
    const line = `${logLine('8.8.8.8')} ${address('alice', 'corp-mail.net')}`;
    expect(detectPersonalData(line, SETTINGS)).toEqual([
      'email address',
      'client IP address in a log line',
    ]);
  });

  it('never repeats the matched value', () => {
    const kinds = detectPersonalData(logLine('8.8.8.8'), SETTINGS).join(' ');
    expect(kinds).not.toContain('8.8.8.8');
  });
});
