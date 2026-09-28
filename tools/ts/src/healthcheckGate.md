# healthcheckGate.ts

CON-14 stays `pending`; every finding is `advisory`. Checks only that the
Dockerfile's final stage declares a `HEALTHCHECK` instruction. The clause's
other half — CI actually booting the image and exercising that check — is a
`.github/workflows` concern, assigned to whatever audits CI workflows, not
a Dockerfile/Compose checker.
