# Infrastructure operations

Every stack applies through CI, under a deploy identity scoped to what its
program creates — never an ambient credential on a laptop. The identity's
narrowness is the security control, not friction to route around.

## IAC-1 — CI applies; a human applies only what CI's identity cannot

A hand-run `pulumi up` is legitimate only for what a stack's deploy identity is
deliberately unable to apply: bootstrap (the first apply, which creates the
identity's own prerequisites), a new project-level IAM binding, a new Secret
Manager secret where the deployer holds no Secret Manager role, the stack's own
federation, or anything else its role list excludes by design. The signal is a
**CI 403**, not a preference or a hurry.

The narrow scope is what makes that 403 the design working: a compromised or
malicious workflow run in a public repo can only reach what the deploy identity
holds. `ghost-platform/infra/platform/serviceAccounts.ts` derives every role
from what its program creates rather than a wider template;
`website/infra/KNOWN_ISSUES.md` records four incidents of the same shape — a
stack that has run under CI for months 403s the day it first creates a
resource type outside its original role list.

That is the day-2 gap this clause names rather than papers over: a genuinely
new resource class needs one privileged apply before CI can take over the
resource it just created. After that apply, the next CI run must report
`unchanged`; if it does not, the change was not bootstrap-class and belongs in
CI. Widening the deployer's roles instead is IAC-2's territory, and it trades
away a security property on purpose — never a default a merge falls into.

## IAC-2 — broadening a deploy identity is never applied by CI

Grant the permission out-of-band first, under a human's own credentials;
`pulumi import` it into the stack's state second; merge third. Never "let CI
apply it" — a deployer that could grant itself new permissions would no longer
be bounded by anything CI enforces, the same reason `serviceAccounts.ts`
withholds `resourcemanager.projects.setIamPolicy` from every deployer in the
fleet.
