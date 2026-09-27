# composeRuntimeGate.ts

CON-5 and CON-6 stay `pending`; every finding is `advisory`.

CON-5 requires the literal `read_only: true` on the service — a service
relying on a base image that happens not to write anywhere isn't
distinguishable from one that does without running it, so this is a
declaration check, not a behavioural one.

CON-6 requires `cap_drop: [ALL]` (case-insensitive) and
`security_opt: [no-new-privileges:true]`, and separately flags
`privileged: true` and any volume mount naming `docker.sock`. It does not
check that added-back capabilities (`cap_add`) each carry a reason — that's
a review-only half of the clause a comment convention would have to encode,
and no such convention exists yet.
