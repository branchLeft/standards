# Infrastructure operations

Every stack applies through CI under a deploy identity scoped to what its program creates, never an ambient credential on a laptop; the identity's narrowness is the security control, not friction to route around.

## IAC-1 — CI applies; a human applies only what CI's identity cannot

A hand-run `pulumi up` is legitimate only for what a stack's deploy identity is deliberately unable to apply (bootstrap, a new project-level IAM binding, a new Secret Manager secret where the deployer holds no such role, the stack's own federation), signalled by a CI 403 and not by preference or hurry, after which the next CI run must report `unchanged`; the only other human steps are minting a supplier token in a console that offers no API for it and first creating a project or account with a supplier, each with its own runbook, and this is the exception list `CI-13` refers to.

**Why:** the narrow scope makes the 403 the design working, so a compromised workflow in a public repo reaches only what the identity holds, and a step earns a place on the list only because no API exists, never because automating it was inconvenient.

**Check:** review; whether a 403 is bootstrap-class or a role list that should be widened (`IAC-2`) needs judgement.

## IAC-2 — broadening a deploy identity is never applied by CI

A permission broadening a deploy identity is granted out-of-band first under a human's own credentials, imported into the stack's state second and merged third, and CI never applies it.

**Why:** a deployer that could grant itself new permissions would no longer be bounded by anything CI enforces.

**Check:** review; the deploy identity's role list is derived from what its program creates.

## IAC-3 — everything is declared in code

All infrastructure and deployments are declared in code as pinned versions plus the shape they deploy onto, and nothing is created by hand except where a supplier offers no API.

**Why:** declared infrastructure can be reviewed, rebuilt and compared, while hand-made infrastructure can only be remembered.

**Check:** review; each stack's preview shows no drift.

## IAC-4 — CI delivers everything

Every host is provisioned and every deploy delivered by CI, deploy credentials are held only by CI, and no path is delivered by hand.

**Why:** a path delivered by hand depends on a person's time and a laptop's credentials.

**Check:** an audit of each repo's deploy paths that fails on any path delivered by hand.
