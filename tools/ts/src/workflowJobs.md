# workflowJobs.ts

For people maintaining or extending `DeployEnvironmentGate` and
`DeployRolloutGate`.

`splitWorkflowJobs` is indentation-based, not a real YAML parser — the same
trade-off `check-workflows.sh`'s job-tracking passes already make. An anchor
job (`&base`) or a flow-mapping job entry (`{ runs-on: ... }`) is not split
out and its clauses are silently skipped, matching the fixture matrix rather
than the full YAML grammar.

`usesDeploySecret` is deliberately name-based, not permission-based: a
workflow file has no reliable signal for "this secret can deploy" beyond its
name, so both gates key off `tools/thresholds.tsv`'s `deploy_secret_substrings`
(CI-12) and `deploy_job_name_substrings` (OPS-2) rather than a fixed list —
a repo whose deploy secrets are named differently extends the setting rather
than the code.
