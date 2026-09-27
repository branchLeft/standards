# check-pulumi-secrets.sh

PUL-12 — a committed Pulumi stack config never carries an `encryptionsalt`.

Scoped to `Pulumi.<stack>.yaml` — the project file `Pulumi.yaml` never has
this key and is never in scope. `encryptionsalt` is always a top-level key
in a stack config, so anchoring at column zero is precise: it cannot match a
value nested under `config:`, and a `#`-prefixed line — a comment describing
the pattern rather than declaring it — never starts with the key name. A
leading UTF-8 BOM is stripped first, since it otherwise shifts whatever key
opens the file off column zero without changing what Pulumi itself reads.

The passphrase provider itself — `secretsprovider: passphrase`, or the same
thing by omission — is not checked here and is not banned. It is the salt
that is an offline oracle; a stack config with no committed `encryptionsalt`
exposes nothing crackable whatever provider it names or omits, including a
committed `secure:` ciphertext value with no salt alongside it. That is
exactly the shape the salt-injected-at-deploy pattern in
`docs/stacks/pulumi.md` commits, and it is meant to pass.

PUL-12 findings bypass `ratchet_finding` on purpose: they are not subject to
`.standards.mode: warn` or a `.standardsignore` line the way every other
clause here is. A committed passphrase salt is a permanent public-secret
exposure the instant the repo goes public, and the sanctioned way out is the
salt-injected-at-deploy pattern, not an exemption — so this is the one gate a
repo cannot adopt its way past while still carrying a committed salt.
