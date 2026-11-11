# healthcheckGate.ts

CON-14 fails a build: it is a row of `tools/ts-promoted.tsv` and the gate
reports it through `findingPromotable`. It checks that the Dockerfile's final
stage declares a `HEALTHCHECK` instruction. A stage that builds `FROM` an
earlier stage inherits that stage's check, and the last `HEALTHCHECK` wins as
it does in Docker, so a later `HEALTHCHECK NONE` counts as none. The clause's
other half — CI actually booting the image and exercising that check — is a
`.github/workflows` concern, assigned to whatever audits CI workflows, not a
Dockerfile/Compose checker. A health check set only in a Compose file does not
satisfy it: the clause says every image has one.
