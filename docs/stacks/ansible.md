# Ansible

Host state is declared in Ansible, in roles that a person can read, learn from
the public documentation and change without an agent. These clauses fix the
shape of that code so a review can cite one.

They apply [`SH-3`](../shell-and-python.md), [`IAC-3`](../infrastructure.md),
`IAC-4`, `CI-13` and `OPS-1` to Ansible and do not restate them. Where a clause
here and one of those differ, the stricter reading governs.

## ANS-1 — host state is declared in Ansible

Anything that configures a host (packages, files, users, services, firewall
rules, scheduled jobs) is declared in Ansible playbooks and roles, written in
YAML. A script that performs host configuration is not an alternative to a
role.

**Why:** a shell script hides desired state inside control flow, so a reader
must simulate it to learn what the host should look like, and must reason about
a second run rather than read it. A module states the end state and reports
whether it changed anything.

**Check plan:** review; a file in the diff that changes host state is YAML
under `ansible/`.

## ANS-2 — Python 3, fully typed, is the only language for custom code

A custom module, plugin or filter is Python 3 and nothing else. Every
signature is annotated (`TYP-2`), mypy runs in strict mode and ruff runs
(`PY-2`, `TYP-5`), and the project's minimum Python is the oldest interpreter
any target host provides (`PY-3`). A module carries its `DOCUMENTATION`,
`EXAMPLES` and `RETURN` blocks, declares `supports_check_mode=True`, and is
unit tested (`TEST-1`).

A module belongs to one role and lives in that role's `library/`, with shared
helpers in its `module_utils/` and filters in `filter_plugins/`. Where
Ansible's own imports are untyped, the mypy override names the `ansible.*`
modules only; a blanket `ignore_missing_imports` is not the override.

**Why:** custom code is where an untyped, untested language comes back in, and
a module runs on a host with the privileges of the play.

**Check plan:** mypy strict and ruff over `ansible/` in CI, and a check that
`pyproject.toml` declares `requires-python`.

## ANS-3 — no bash in a role, except a program the role installs

A role's tasks and handlers contain no `ansible.builtin.shell`,
`ansible.builtin.raw` or `ansible.builtin.script` task. Logic that does not fit
a module is a Python module (`ANS-2`), not a shell fragment.

The one exception is a program the role installs onto the host as part of the
service it configures, such as a helper run by a timer. It is a file the role
ships, it meets `SH-1` like any other shell, and the role's test (`ANS-15`)
runs it.

**Why:** shell inside a role is the script `ANS-1` replaces, one step removed,
and `shell` reports every run as changed.

**Check plan:** a check that fails on those three module names under
`ansible/roles/*/tasks` and `ansible/roles/*/handlers`; review until it exists.

## ANS-4 — the toolchain is pinned

ansible-core, ansible-lint, Molecule and its driver plugin, mypy and ruff are
pinned to exact versions in one committed requirements file under `ansible/`.
Every collection a role uses is pinned to an exact version in
`ansible/requirements.yml` and is vendored: the pinned copy is committed to the
repository, so that a clean checkout installs the pinned set with no network
beyond the pins. CI installs the Python tools from the requirements file and
uses the vendored collections.

The pre-commit hook for ansible-lint is the one other place a pin lives:
pre-commit installs a hook into its own virtual environment, so the hook's
`rev` is the ansible-lint version in the requirements file, and a bump changes
both in one pull request.

A bump is a deliberate pull request that changes the pin and, for a collection,
the vendored copy together. Dependabot raises the pip pins (`DEP-8`); it has no
ecosystem for Ansible collections, so nothing raises a collection bump and
whoever changes `ansible-core` reviews the collection pins in the same pull
request.

**Why:** Ansible's behaviour moves between core releases, so an unpinned
install makes a green run unrepeatable, the reason `CI-1` pins actions. A
vendored collection cannot change, or disappear, between two runs of one commit.

**Check plan:** a check that every line in the requirements file and every
collection entry carries an exact version; review of a bump, and of the vendored
copy against its pin until a check for that exists.

**Named limit:** nothing prompts a collection bump between `ansible-core`
changes, so a collection can age silently until one of those reviews.
Dependabot's list of supported ecosystems has no entry for Ansible collections,
and this page does not add a scheduled job it cannot defend.

**Named limit:** where the vendored copy lives, how Ansible and ansible-lint
find it, and how a check proves that it matches its pin are decided by the
foundation ticket that pins `ansible-core` and vendors the collections, and are
recorded here by amendment. This page does not state them.

**Named limit:** ansible-lint's documentation says it supports only the latest
`ansible-core` when run as a pre-commit hook, so the hook can run a different
`ansible-core` from the pinned one. The CI run at the pinned versions is the
result that blocks (`CI-14`). Separately, Molecule's configuration page lists
`galaxy` as the default dependency manager and `dependency` as the first step of
its default sequences, and says the manager can be disabled by setting
`enabled` to false. This page has not established whether that step reaches a
public index with the vendored copy in place, so how a scenario's dependency
step is configured is recorded by the same amendment.

## ANS-5 — ansible-lint runs at the production profile

`.ansible-lint` at the repository root sets `profile: production`, the
strictest of the six profiles (`min`, `basic`, `moderate`, `safety`, `shared`,
`production`). It runs from the repository root, non-mutating (`CI-4`: no
`--fix` in a job), in pre-commit and in CI. CI passes `--strict`, whose help
text is "Return non-zero exit code on warnings as well as errors", and the
file sets `strict: true`.

No route that hides a finding or a file from the lint is used. In the
configuration file, none of `skip_list`, `exclude_paths`, `mock_modules`,
`mock_roles` or `kinds` is set. No ignore file exists: neither
`.ansible-lint-ignore` nor `.config/ansible-lint-ignore.txt`, the two names the
tool looks for by default. In the invocation, which is the pre-commit hook's
`args` and the CI step's command line, none of `-x` (`--skip-list`),
`--exclude` or `-i` (`--ignore-file`) is passed. No task carries the
`skip_ansible_lint` tag, which the tool's usage page documents as skipping all
task-based rules for a task. `warn_list` is set explicitly to `experimental`
alone. ansible-lint's default warn list is `experimental`, `jinja[spacing]` and
`fqcn[deep]`, and a list the file defines replaces it, so the two rules that
the profile includes are errors, not warnings. The tool's documentation does
not say whether a `warn_list` rule fails under `strict`, so the clause does not
depend on it.

`enable_list` includes `no-log-password`, which is opt-in (`ANS-16`). A single
finding is suppressed on its own line with `# noqa: <rule>` at the end of the
line, and the reason is a comment on the line above: the documentation does not
say whether text after the rule id is allowed. `.ansible-lint`, `.yamllint` and
any ignore file are exemption files for `STD-001` and `REPO-5`: a pull request
does not loosen one to make its own gate pass, and CODEOWNERS covers them.

**Why:** the profile is the maintained, named definition of good Ansible, so
the standard borrows it rather than keeping a private rule list. Each listed
route removes a finding or a file from what the profile sees, so a profile that
a pull request can switch off by adding one line is not a floor.

**Check plan:** a CI step running ansible-lint with `--strict`, and a check
that `.ansible-lint` names the production profile, sets none of the keys above
and a `warn_list` of `experimental` alone, that no ignore file exists, that no
workflow or pre-commit `args` passes one of the flags above, and that no task
under `ansible/` carries the `skip_ansible_lint` tag. Until that check exists
these are review.

**Named limit:** the routes listed are the ones read in the tool's
documentation and source for this page; the page does not claim the list is
every route the tool offers. `ANSIBLE_LINT_IGNORE_FILE` is not one of them: the
usage page says it overrides the name of the default ignore file, but in the
source read its only use is as the output path of `--generate-ignore`, and the
loader that reads an ignore file does not mention it.

## ANS-6 — yamllint covers every YAML file under `ansible/`

`.yamllint` extends `default` and keeps the five settings ansible-lint's `yaml`
rule requires: `comments.min-spaces-from-content` is 1,
`braces.min-spaces-inside` is 0, `braces.max-spaces-inside` is 1, and
`octal-values.forbid-implicit-octal` and `octal-values.forbid-explicit-octal`
are both true. It also sets two values the same way ansible-lint's own default
configuration does, which that rule's page shows: `line-length.max` is 160,
where yamllint's `default` preset enables the rule with that rule's own maximum,
and `document-start` is disabled. yamllint runs in pre-commit and in CI over
every YAML file under `ansible/`, as its own step, so a file ansible-lint does
not treat as Ansible content is covered too.

**Why:** unformatted YAML turns a one-line change into a whole-file diff and
hides what changed from a reviewer.

**Check plan:** a CI step running yamllint with the committed `.yamllint`, and a
check that the file keeps the five settings above and the two values after
them.

## ANS-7 — every role declares its interface in `meta/argument_specs.yml`

Every role has `meta/argument_specs.yml`. It has one entry point per tasks file
the role exposes, `main` for `tasks/main.yml`, and an `options` entry for every
variable the role reads from outside it, each with `type` and `description`
and either `required` or `default`. A list states `elements`, a nested
dictionary states `options`, and a closed set states `choices`.

The role reads no outside variable the spec does not declare, its
`defaults/main.yml` agrees with the spec's defaults, and every variable name
begins with the role's name followed by an underscore. Ansible validates the
arguments at the start of the role and fails the role on a mismatch. The check
coerces: a value of `1` passes a `str` check and the role still receives the
integer, so a role that needs a string converts it explicitly.

**Why:** without a spec a role's interface is whatever its tasks happen to
read, and a misspelt variable silently falls back to a default.

**Check plan:** a check that every directory under `ansible/roles/` has the
file; review of the spec against the variables the tasks read.

## ANS-8 — modules and plugins are named by fully qualified collection name

Every module and plugin a task or template names carries its fully qualified
collection name, including `ansible.builtin.`. The `collections:` keyword is
not used to shorten a name. A module bundled in a role's `library/` is the one
bare name and carries the role's name as a prefix; a module needed by more than
one role moves to a collection and is called by its qualified name.

**Why:** a short name leaves the namespace to be resolved at run time, so the
same task can run different code on two controllers.

**Check plan:** the `fqcn` rule, which the production profile includes
(`ANS-5`), for the names a task uses; review for the rest, including every
file under a role's `templates/`.

**Named limit:** the `fqcn` rule's documentation says it checks module and
plugin names in Ansible content, that its `fqcn[keyword]` check is about the
`collections` keyword, and that it does not use that keyword to resolve names.
It says nothing about a filter named in a template or about a bare module from
a role's `library/`, so a reviewer reads templates for an unqualified filter,
and the first role that ships a `library/` module records here how the rule
treats it.

## ANS-9 — a module before a command

A task uses a module wherever one exists. `ansible.builtin.command`, given as
an argument list with no shell features, is used only where no module exists,
and it states its change with `changed_when`, or `creates` or `removes`, so it
reports truthfully. A command that is needed twice, or whose output must be
parsed or branched on, becomes a Python module (`ANS-2`).

**Why:** a module knows the state it manages and reports change from it. A
command reports what the author guessed, and an idempotence proof (`ANS-11`)
over guesses proves nothing.

**Check plan:** the `command-instead-of-module`, `command-instead-of-shell` and
`no-changed-when` rules under the production profile (`ANS-5`); review for a
command where a module exists that those rules do not know, because the first
rule works from a fixed set of commands in its source.

## ANS-10 — every role supports check mode

A role and a playbook run to completion under `--check --diff` against a host
in either state. A custom module declares `supports_check_mode=True` and makes
no change when `module.check_mode` is set. A task whose result depends on one
that did not run in check mode is skipped explicitly with a stated reason,
rather than reporting nothing. `check_mode: false` is set only on a task that
reads and changes nothing, so that later tasks have its result.

**Why:** the dry run is what an approver sees before the click (`CI-13`). A
role that fails under it, or silently skips half its tasks, gives them nothing
to approve.

**Check plan:** review of the role and of any module in the diff. The approved
delivery path (`ANS-17`) has a plan job that runs in check mode and shows each
host's diff before the approval. The role's test (`ANS-15`) also requires a CI
run of Molecule's `check` action.

**Named limit:** Molecule's configuration page lists `check` as a step of
`check_sequence`, after `converge`, and its usage page lists it as an action;
neither page says what the step runs, so this page does not claim that it runs
the role in check mode. Whatever it runs covers the state the scenario is in
when it runs, and the other state is review.

## ANS-11 — a second run changes nothing

Running a role against a host it has already configured reports zero changed
tasks. The role's test sequence includes Molecule's `idempotence` step and the
step is never removed. A task that always reports changed is a defect to fix
with a module, `changed_when`, `creates` or `removes`, never an exception.

**Why:** an apply that is not idempotent cannot be repeated safely after a
partial failure, and its change report stops meaning anything.

**Check plan:** the role's Molecule run in CI (`ANS-15`) fails when the
idempotence step reports a change.

## ANS-12 — one role per logical service

A role configures one service, or one cross-cutting capability with one reason
to change, and nothing else. It does not edit another role's files or restart
another role's service; the one exception is a capability role, which writes the
paths its caller passes it (below). Other composition is in a playbook, which
lists roles in order; `meta/main.yml` carries no `dependencies`. A role's name
is lowercase letters, digits and underscores, starting with a letter.

A role may include another role only when the included role is a **capability
role**. A capability role:

- configures no service, and restarts, reloads, starts and stops nothing;
- owns no host state of its own: it writes only to paths its caller passes in as
  inputs, and to no path it names itself;
- declares every input in `meta/argument_specs.yml`, the options of a list
  element or of a dictionary included, and gives every input that is not
  `required: true` a `default` there (a `default` key counts whatever its value,
  null included; an option with neither `required: true` nor a `default` fails);
- is called with `include_role`, with every required top-level input given at
  the call and no top-level input the entry point does not declare. A top-level
  input is an option of the entry point itself, named by a variable the call
  sets; an option of a list element or of a dictionary the call passes is a
  nested input, and each element or dictionary the call passes gives the nested
  options that are required. An optional input the call leaves out takes the
  default its `argument_specs` entry declares and no other; a default that
  appears only in `defaults/main.yml`, in `group_vars` or in the caller's own
  variables is not declared;
- names in its README each role that calls it.

Ansible does not apply a default declared in `argument_specs` to the role. The
value an omitted optional top-level input takes at run time is that of whatever
variable of its name is in scope, and the role's `defaults/main.yml` is the
lowest-precedence place such a variable can come from: a variable of the same
name in `group_vars`, `host_vars`, the play's `vars`, `set_fact` or extra vars
overrides it. For an option of a list element the value comes from the role's
tasks. The role's own defaults and tasks hold the same value as the declared
default (`ANS-7`), so a reader of the spec learns what an omitted input
becomes, unless the caller's scope sets a variable of that name.

Any other composition stays in a playbook. The tasks and handlers of a role never
`include_tasks` or `import_tasks` a file outside their own role, and no role uses
`import_role` or a `meta/main.yml` `dependencies` entry to compose another.

```yaml
- name: Record the applied state of each class
  ansible.builtin.include_role:
    name: EXAMPLE_CAPABILITY_ROLE
    tasks_from: EXAMPLE_ENTRY_POINT
  vars:
    example_capability_paths:
      - /var/lib/EXAMPLE_DIRECTORY/EXAMPLE_FILE
```

**Why:** shared logic needs one home, or each role copies it and the copies
drift. A role that includes another hides from its playbook what gets applied.
A capability role that touches only the paths it is handed, takes only inputs
that are declared, has each required one given at the call, declares a default
for each optional one and names its callers keeps that visible, and the caller
stays the owner of the files and of every action on them. A declared default
tells a caller what an omitted input becomes, and only while the role's own
defaults equal it and no variable of that name is set in the caller's scope,
which is why both are on the review list.

**Check plan:** per part of the rule.

- Enforced by a check in the repository that owns the roles, such as
  `ansible/checks/test_role_composition_gate.py` in `shared-infra`:
  - an `include_tasks` or `import_tasks` in a role's tasks or handlers whose
    path leaves that role;
  - every `import_role`, whatever role it names, and every `meta/main.yml` with
    a `dependencies` entry;
  - every `include_role`, against the conditions of a capability role that a
    tool can read and not against a list of roles: the included role has
    `argument_specs` for the entry point the call names, every input of that
    entry point that is not `required: true` has a `default` there, the options
    of a list element or of a dictionary included, the call gives every
    required top-level input and no top-level input the entry point does not
    declare, and the included role's README names the calling role;
  - where the check requires a citation of the standards pull request that
    recorded this rule, it reads the cited pull request through the API and
    asserts that it is merged and that the cited commit is its merge commit.
- Review only: that an included role is a capability role, because no marker
  that a tool can read says so; that it configures no service and acts on
  nothing but the paths its caller passes; that every variable its tasks read is
  an input it declares, because a check sees what a call gives and not what a
  task reads; and that the value an omitted optional input takes in the role's
  `defaults/main.yml` or tasks equals the `default` its `argument_specs` entry
  declares, because a check that reads the spec and the call cannot see which
  value runs; that no variable of the name of an omitted optional input is set
  in the caller's scope (`group_vars`, `host_vars`, the play's `vars`,
  `set_fact`, extra vars), because such a variable overrides the role's
  defaults and a check that reads the spec and the call does not read the
  caller's scope; and that each list element or dictionary a call passes gives
  its required nested options, because a check that reads the names of the
  variables a call sets sees the top-level inputs and not what is inside them.
  Whatever the list above does not name is review.
- A repository's check may hold a condition this clause leaves open, such as
  that a capability role includes no role itself, or that the included role is
  named by a path built from the caller's `role_path` and not by a bare name.
  The clause neither requires nor forbids it, and the repository states the
  condition in its own documentation.
- Where no such check exists in the repository, the whole composition rule is
  review only.

The `role-name` rule (basic profile, included by `ANS-5`) checks the name.

**Named limit:** ansible-lint lists `meta-no-dependencies` under its production
profile, but its profiles page links that entry to a GitHub issue rather than
a rule page and says such entries are not yet implemented. Nothing in the lint
refuses a role dependency, so this part of the clause is review-only until
the rule exists or a repository adds its own check.

**Named limit:** a check that reads task and handler files sees the name or
path an include states. An include whose target is built from a variable is not
seen, and is review only.

**Named limit:** the default an `argument_specs` entry declares and the value the
role runs with are two copies, because Ansible does not apply the spec's default
to the role. A check that reads the spec and the call cannot see the second, so
their equality is review only. For an option of a list element the second copy
is in the role's tasks and not in a `defaults/` file.

**Named limit:** an omitted optional top-level input takes the value of any
variable of its name in the caller's scope, because the role's defaults have the
lowest precedence. The rule says the input takes its declared default and no
other, and a check cannot see the caller's inventory and plays. A variable that
shadows an omitted optional input is review only.

**Named limit:** this clause does not say whether a capability role may itself
include another capability role, nor whether the rule applies to a role from a
collection (`ANS-13`). Neither is decided here, and a reviewer raises either as
an open question rather than passing or failing the diff on this clause.

## ANS-13 — where roles and playbooks live

A role lives in the repository that owns the service it configures, under
`ansible/roles/<role_name>/`, so a change to the service and to its deployment
is one pull request. A playbook lives in `ansible/playbooks/` and
only selects hosts and lists roles with their variables. A role needed by more
than one repository is published from one repository as a versioned collection
and consumed by an exact version (`ANS-4`); it is never copied between
repositories.

Where inventories live is not decided here.

**Why:** a role kept apart from the service it deploys drifts from it, and a
copied role is two roles with one name.

**Check plan:** review of new paths under `ansible/` in the diff.

**Named limit:** this is a chosen trade-off, not a consequence of `PRIN-5`,
which a single host-configuration repository would satisfy as well. The cost is
that a host whose roles come from several repositories needs one playbook that
lists them, and this page does not decide which repository owns it.

## ANS-14 — a README a maintainer can use cold

Every role has a `README.md` written for a maintainer new to the repository
(`DOC-4`, `DOC-6`). In this order it states: the one service the role
configures and what it does not do; its interface, by pointing at
`meta/argument_specs.yml` and saying which variables are secrets; its
requirements (ansible-core, collections, supported target systems); what it
changes on a host (files, units, ports, users); how to run its test; how it is
delivered (`ANS-17`); and how to change it safely.

The README carries no host names, addresses or tenant data.

**Why:** the role must be maintainable by a person if no agent touches it
again, and a role understood only by its author is not.

**Check plan:** review of the README against the role's tasks.

## ANS-15 — every role carries a container-only Molecule test

A role has a Molecule scenario at `molecule/default/` that converges the role
on a container, runs a second converge to prove idempotence (`ANS-11`) and
runs a verify playbook that asserts the outcome, not only that converge
finished (`TEST-2`).

The scenario's driver is `docker` or `podman`. The `default` driver with
`managed: False`, which runs against a host that already exists, a
`docker_host` or connection option that reaches anything but the local
container runtime, and any inventory naming a production host are refused: the
test never touches a production host. No platform sets `docker_host`, and the
CI job leaves `DOCKER_HOST` unset: the docker driver's create playbook takes
`docker_host` from that environment variable when the platform sets none, so a
set variable can point the test at another engine.

Each platform image is pinned by digest (`CON-3`) and sets
`pre_build_image: true`. Without it the create playbook builds the image and
tags it `molecule_local/<image>`, and a tag cannot carry a digest. A platform
that needs `privileged` or added capabilities says why in the scenario file.

CI runs the scenario's default test sequence and its `check` action (`ANS-10`),
and the result blocks merge (`CI-14`).

**Why:** a role proven only by running it on production is not proven, and a
test that can reach production is a second way to apply to it (`ANS-17`).

**Check plan:** a check that every role has the scenario, that no scenario
names an unmanaged driver, sets `docker_host` or omits `pre_build_image: true`,
and that the CI job does not set `DOCKER_HOST`; the CI run is the test.

**Named limit:** none of Molecule, its docker plugin or the create playbook
was run when this clause was written; each statement above is from the
playbook's source and the tools' documentation. A digest reference on the
pre-built path is passed to the container engine unchanged by that source and
has not been proven to run, so the first role to use it records the result.

## ANS-16 — secrets never reach a log

Every task that reads, templates or passes a secret sets `no_log: true`,
including a task in a loop, and sets `diff: false` where `--diff` would show
the rendered secret. A secret reaches a role as a variable supplied at run time, never as a default
in `defaults/main.yml`, and is never committed (`CRED-11`) or logged (`LOG-4`).
A Molecule test uses throwaway values made for the run.

**Why:** a secret in a CI log is published to everyone who can read it, and
Ansible prints task arguments and diffs by default.

**Check plan:** review of every task and template in the diff that reads,
renders or passes a secret, for `no_log: true` and `diff: false`. Two checks
back the review and neither replaces it: the `no-log-password` rule, enabled in
`.ansible-lint` (`ANS-5`), and the secret scan of `CRED-11`, which looks for
committed values.

**Named limit:** where a secret comes from at run time, and how it reaches a
host that pulls its commit, is decided by the secrets pattern and recorded here
by amendment. This page names no delivery mechanism and states no property of
one.

**Named limit:** `no-log-password` flags a task only when one of its module
argument names contains `password`, the task has a `loop` or `with_` key, and
`no_log` is not true. A token written through `template`, `copy`, `uri` or
`command` outside a loop is not flagged, so no tool checks this clause for the
common case; a check written for the purpose would close it. Separately,
Ansible's role argument validation documentation lists no `no_log` key for an
argument spec and does not say whether a failed validation prints the supplied
value, so whether a secret variable in `meta/argument_specs.yml` can reach a
log through a validation failure is not established.

## ANS-17 — a role is applied only by the gated workflow

Delivery to a production host is only through a GitHub workflow run against
`main`, after the approval of its protected deployment environment (`CI-12`,
`CI-13`, `IAC-4`). The approved shape is a gated pull. A plan job shows each
host's diff before the approval. After the approval, the host runs
`ansible-pull` of that exact commit of `main`, and CI never holds a root shell.
Every live apply also gets a second run that must report zero changes. A nightly
drift run in check mode is part of the same approved plan.

Pushing from a CI runner to the host over SSH was the alternative the owner did
not choose. This page does not approve it, and a ticket cannot cite this clause
for it; choosing it is a decision for the owner.

An agent is never authorised to deliver to a production host in any other way.
It does not run `ansible-playbook` against one from a local machine, either to
apply or in check mode: a check-mode run opens a session to the host and is
not the approved shape. A probe, a lab or a spike that touches no
production host is not delivery and is outside this clause. A hand-made
emergency change is redone through the workflow within a day (`OPS-1`), and the
human exceptions are `IAC-1`'s list; this page adds none.

An author's local run is the role's Molecule test, whose targets are
containers on that machine (`ANS-15`).

**Why:** a deploy from a laptop skips the approval and the review, depends on
that laptop's credentials, and leaves no run to audit.

**Check plan:** review; a delivery workflow has a plan job before a protected
environment, the host's pull follows the gate, a second run follows every live
apply, and no document tells an agent to run `ansible-playbook` by hand.

**Named limit:** how the pull is triggered, how the host verifies the commit it
pulls, and how the second run is wired into the workflow are decided by the
trigger-wrapper and reusable-CI tickets and recorded here by amendment. This
page states only the shape the owner approved.

## A worked example

The shape below uses placeholder names. It is the layout `ANS-7`, `ANS-13` and
`ANS-15` describe, not a role to copy.

### The tree

```text
ansible/
  requirements.txt
  requirements.yml
  pyproject.toml
  playbooks/
    example_service.yml
  roles/
    example_service/
      README.md
      defaults/main.yml
      meta/main.yml
      meta/argument_specs.yml
      tasks/main.yml
      handlers/main.yml
      templates/credentials.j2
      library/example_service_probe.py
      molecule/default/
        molecule.yml
        converge.yml
        verify.yml
.ansible-lint
.yamllint
```

### The interface

```yaml
argument_specs:
  main:
    short_description: Install and configure EXAMPLE_SERVICE
    description: Installs the package, renders its configuration and keeps the service running.
    author: AUTHOR_NAME
    options:
      example_service_state:
        type: str
        description: Whether the service is present or absent.
        choices: [present, absent]
        default: present
      example_service_listen_port:
        type: int
        description: TCP port the service listens on.
        default: 8080
      example_service_allowed_networks:
        type: list
        elements: str
        description: Networks allowed to connect, in CIDR form.
        default: []
      example_service_api_token:
        type: str
        required: true
        description: Token the service uses upstream. Supplied at run time.
```

This is `meta/argument_specs.yml`. The role's own `defaults/main.yml` holds the
same defaults and no value for the token (`ANS-7`, `ANS-16`).

### The role metadata

`meta/main.yml` has no `dependencies` entry (`ANS-12`). ansible-lint's `schema`
rule requires `galaxy_info.standalone` for a role that is not part of a
collection and refuses an empty file. The meta schema it enforces requires
`author`, `description`, `license` and `min_ansible_version` when `standalone`
is true, and types `min_ansible_version` as a string. `meta-incorrect` refuses
the placeholder text of the generated template for the author, description,
company and licence. The value of `min_ansible_version` is the pinned
`ansible-core` version (`ANS-4`), the one the role's test runs against.

```yaml
galaxy_info:
  standalone: true
  author: AUTHOR_NAME
  description: Installs and configures EXAMPLE_SERVICE.
  license: LICENSE_ID
  min_ansible_version: PINNED_CORE_VERSION
```

### The lint configuration

This is `.ansible-lint` at the repository root (`ANS-5`).

```yaml
profile: production
strict: true
warn_list:
  - experimental
enable_list:
  - no-log-password
```

This is `.yamllint` at the repository root, with the five settings ansible-lint's
`yaml` rule requires, the two values ansible-lint's own default configuration
sets, and nothing that loosens the five (`ANS-6`).

```yaml
extends: default
rules:
  line-length:
    max: 160
  document-start: disable
  comments:
    min-spaces-from-content: 1
  braces:
    min-spaces-inside: 0
    max-spaces-inside: 1
  octal-values:
    forbid-implicit-octal: true
    forbid-explicit-octal: true
```

### The Python configuration

This is `pyproject.toml` under `ansible/` (`ANS-2`). The override names the
`ansible.*` modules only, so every other import is still checked. The
`requires-python` value shown is an example: it is the oldest interpreter any
target host provides (`PY-3`).

```toml
[project]
name = "example-service-ansible"
requires-python = ">=3.11"

[tool.mypy]
strict = true

[[tool.mypy.overrides]]
module = ["ansible.*"]
ignore_missing_imports = true
```

### The Molecule scenario

This is `molecule/default/molecule.yml` (`ANS-15`). `pre_build_image: true` is
what lets the image reference carry a digest.

```yaml
driver:
  name: docker
platforms:
  - name: instance
    image: IMAGE_NAME:TAG@sha256:DIGEST
    pre_build_image: true
```

`converge.yml` applies the role with throwaway values, setting `no_log: true`
on the task that passes the token (`ANS-16`), and `verify.yml` asserts the
outcome rather than that converge finished (`TEST-2`):

```yaml
- name: Converge
  hosts: all
  tasks:
    - name: Apply the role
      ansible.builtin.include_role:
        name: example_service
      vars:
        example_service_api_token: THROWAWAY_VALUE
      no_log: true
```

```yaml
- name: Verify
  hosts: all
  tasks:
    - name: Read the credentials file
      ansible.builtin.stat:
        path: /etc/example-service/credentials
      register: example_service_credentials
    - name: Assert it exists and is private to its owner
      ansible.builtin.assert:
        that:
          - example_service_credentials.stat.exists
          - example_service_credentials.stat.mode == '0600'
```

### A task that handles a secret

```yaml
- name: Render the credentials file
  ansible.builtin.template:
    src: credentials.j2
    dest: /etc/example-service/credentials
    owner: root
    group: root
    mode: '0600'
  no_log: true
  diff: false
```
