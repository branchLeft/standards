# secretEnvironmentVariable.ts / secretsFileGate.ts

CRED-10 stays `pending`; every finding is `advisory`.

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
