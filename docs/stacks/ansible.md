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
`ansible/requirements.yml`. CI installs from those files and from nothing else.
A bump is a reviewed pull request (`DEP-8`).

**Why:** Ansible's behaviour moves between core releases, so an unpinned
install makes a green run unrepeatable, the reason `CI-1` pins actions.

**Check plan:** a check that every line in the requirements file and every
collection entry carries an exact version.

## ANS-5 — ansible-lint runs at the production profile

`.ansible-lint` at the repository root sets `profile: production`, the
strictest of the six profiles (`min`, `basic`, `moderate`, `safety`, `shared`,
`production`). It runs from the repository root, non-mutating (`CI-4`: no
`--fix` in a job), in pre-commit and in CI, and a warning fails the run
(`strict: true`).

`skip_list` is not used, because it hides violations from the output.
`warn_list` holds no production-profile rule, because a warning does not fail.
`enable_list` includes `no-log-password`, which is opt-in (`ANS-16`). A single
finding is suppressed on its own line with `# noqa: <rule>` and a reason. The
file is an exemption file for `STD-001` and `REPO-5`: a pull request does not
loosen it to make its own gate pass.

**Why:** the profile is the maintained, named definition of good Ansible, so
the standard borrows it rather than keeping a private rule list.

**Check plan:** a CI step running ansible-lint, and a check that
`.ansible-lint` names the production profile and sets no `skip_list`.

## ANS-6 — yamllint covers every YAML file under `ansible/`

`.yamllint` extends `default` and keeps the settings ansible-lint's `yaml` rule
requires; ansible-lint refuses a `.yamllint` that conflicts with them on
comment spacing and octal values. yamllint runs in pre-commit and in CI over
every YAML file under `ansible/`, as its own step, so a file ansible-lint does
not treat as Ansible content is covered too.

**Why:** unformatted YAML turns a one-line change into a whole-file diff and
hides what changed from a reviewer.

**Check plan:** a CI step running yamllint with the committed `.yamllint`.

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
(`ANS-5`).

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
`no-changed-when` rules under the production profile (`ANS-5`).

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

**Check plan:** review; the role's test (`ANS-15`) runs the converge playbook
once in check mode.

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
another role's service. Composition is in a playbook, which lists roles in
order; `meta/main.yml` carries no `dependencies`. A role's name is lowercase
letters, digits and underscores, starting with a letter.

**Why:** a role with two reasons to change cannot be tested, reviewed or
removed alone, and a dependency chain hides what a playbook applies. The
production profile already refuses role dependencies.

**Check plan:** review; the production profile (`ANS-5`) covers dependencies
and names.

## ANS-13 — where roles and playbooks live

A role lives in the repository that owns the service it configures, under
`ansible/roles/<role_name>/`, so a change to the service and to its deployment
is one pull request (`PRIN-5`). A playbook lives in `ansible/playbooks/` and
only selects hosts and lists roles with their variables. A role needed by more
than one repository is published from one repository as a versioned collection
and consumed by an exact version (`ANS-4`); it is never copied between
repositories.

Where inventories live is not decided here.

**Why:** a role kept apart from the service it deploys drifts from it, and a
copied role is two roles with one name.

**Check plan:** review of new paths under `ansible/` in the diff.

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
test never touches a production host. Each platform image is pinned by digest
(`CON-3`), and a platform that needs `privileged` or added capabilities says
why in the scenario file. CI runs the scenario and the result blocks merge
(`CI-14`).

**Why:** a role proven only by running it on production is not proven, and a
test that can reach production is a second way to apply to it (`ANS-17`).

**Check plan:** a check that every role has the scenario and that no scenario
names an unmanaged driver; the CI run is the test.

## ANS-16 — secrets never reach a log

Every task that reads, templates or passes a secret sets `no_log: true`,
including a task in a loop, and sets `diff: false` where `--diff` would show
the rendered secret. A secret reaches a role as a variable supplied by the
delivery workflow at run time (`CRED-2`, `CRED-10`), is never a default in
`defaults/main.yml`, and is never committed (`CRED-11`, `LOG-4`). A Molecule
test uses throwaway values made for the run.

**Why:** a secret in a CI log is published to everyone who can read it, and
Ansible prints task arguments and diffs by default.

**Check plan:** the `no-log-password` rule, enabled in `.ansible-lint`
(`ANS-5`), and the secret scan of `CRED-11`.

## ANS-17 — a role is applied only by the gated workflow

Delivery to a production host is only through a GitHub workflow run against
`main`, after the approval of its protected deployment environment (`CI-12`,
`CI-13`, `IAC-4`). Nobody runs `ansible-playbook` against a production host
from a local machine, to apply or in check mode, and an agent never delivers by
any other route. A hand-made emergency change is redone through the workflow
within a day (`OPS-1`). The only human exceptions are `IAC-1`'s list; this page
adds none.

The only run an author makes locally is the role's Molecule test, whose targets
are containers on that machine (`ANS-15`).

**Why:** a deploy from a laptop skips the approval and the review, depends on
that laptop's credentials, and leaves no run to audit.

**Check plan:** review; a workflow that runs `ansible-playbook` uses a
protected environment, and no document tells anyone to run it by hand.

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
        description: Token the service uses upstream. Supplied by the delivery workflow at run time.
```

### The lint and test configuration

```yaml
profile: production
strict: true
enable_list:
  - no-log-password
```

```yaml
driver:
  name: docker
platforms:
  - name: instance
    image: IMAGE_NAME:TAG@sha256:DIGEST
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
