# secretEnvironmentVariable.ts / secretsFileGate.ts

CRED-10 stays `pending`; every finding is `advisory`, and the gate is not on
`tools/ts-promoted.tsv`.

## Why it is not promoted

The clause asks for `_FILE` secrets "wherever the application supports it".
The reader cannot tell which applications do. Run over `ghost-platform` it
reported 83 findings, 68 of them Ghost's own nested configuration
(`database__connection__password`, `mail__options__auth__pass`,
`storage__*__secretAccessKey`, `bulkEmail__mailgun__apiKey`), which the
rendered files pass to Ghost as `${VAR}` environment values and for which no
`_FILE` form is known to exist; 69 of the 83 sit in golden or test Compose
files. Promoted, those findings would fail the job with no known compliant
fix, and the only way out would be an exemption per file. The
`_FILE` suffix is the clause's own convention, so the threshold is not the
obstacle; the missing input is which services support it.

It becomes promotable when the reader is told that, by an owner-set list of
services or variables that cannot take a `_FILE` value, or by a skip for
golden and test Compose files, and a rerun over `ghost-platform` leaves only
findings that have a fix. A name that is an identifier rather than a secret
(`accessKeyId`) is also matched today; the owner decides whether that stays.

`isSecretLikeEnvironmentVariable` normalises a key across naming conventions
(`SCREAMING_SNAKE`, `camelCase`, Ghost's own `double__underscore` nesting)
into lowercase segments, then matches a segment against a short keyword set
(`password`, `secret`, `token`, `credential`, …) or a joined-phrase set for
two-word names (`apikey`, `accesskey`, `privatekey`, `clientsecret`). A key
already ending `_FILE` is the compliant shape and is never flagged.

This is a name heuristic, not a value inspection — a variable named
`GREETING` holding an actual secret would be missed, and a variable named
`SESSION_TOKEN_EXPIRY_SECONDS` holding a number would be flagged. Neither
has been observed in the fleet; this hasn't been tuned against a false
positive yet.
