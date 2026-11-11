# personalDataGate.ts

DP-7 says no personal data appears in source, commit messages, issue trackers,
CI logs, or the transcripts and stored memory of automated tooling. This gate
reads the one of those places a script can reach from the repo's own files: the
working tree. `detectPersonalData` in `personalData.ts` does the matching;
`PersonalDataGate` walks the tracked files and reports.

TypeScript-only and advisory: `docs/index.md` keeps DP-7 `pending`, and every
`tools/thresholds.tsv` row it reads is `#provisional`, so a finding never fails
a repo until the owner moves the gate class.

## What it recognises

- An email address, unless its domain is an RFC 2606 or RFC 6761 reserved name
  (`example.com`, `example.org`, `example.net`, and anything under `.example`,
  `.test`, `.invalid`, `.localhost`), its local part is a role mailbox, or it
  sits in a URL's userinfo (`https://user:secret@host`, a credential and the
  credential clauses' concern). A file name that looks like an address
  (`logo@2x.png`) is not one.
- A public IPv4 address on a line that also carries a timestamp, which is the
  shape of a pasted access or application log line. Private, loopback,
  link-local, shared-address, benchmark and documentation ranges are not
  personal data and are skipped, as is any quad with an octet over 255 or a
  fifth dotted number (a version string).

An IP address alone on a line, with no timestamp, is not reported: a server's
own address in configuration is indistinguishable from a client's, and a
finding nobody trusts is worse than a narrower one.

## Never repeats the value

The finding names the file, the line and the kind, never the matched text. The
audit output goes to CI logs, which DP-7 keeps clean, so a gate that echoed the
address would commit the breach it reports.

## Ratchet behaviour

The clause leaves this to the PR that writes the gate. The scan covers the
working tree only. A finding there is remediable (delete or replace the value),
so it can ride the ordinary ratchet like the other readers: advisory today, and
promoted only when the owner moves the gate class. A history scan is not
remediable (a committed address stays reachable) and would permanently bar a
repo that once committed one, so it is deliberately not part of this gate.

## Settings (`tools/thresholds.tsv`, clause DP-7)

- `scan_extensions`: the file extensions read.
- `skip_basenames`: lockfiles, skipped by name.
- `role_mailboxes`: local parts that name a role, not a person.
- `placeholder_domains`: further domains to treat as placeholders (no row ships;
  the reserved names above are built in).

Lines over 2000 characters are skipped: they are minified bundles or encoded
blobs, not prose or a pasted log.

## What it cannot see

Names, postal addresses, phone numbers, free text and identifiers that are not
email or IP shaped; commit messages and history; issue trackers; CI logs; the
transcripts and memory of tooling. DP-7 stays `pending` because those are the
larger part of the clause, and a row marked `auto` would claim them.
