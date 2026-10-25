# Ansible

Host state is declared in Ansible, in roles a person can read, learn from the public documentation and change without an agent. These clauses fix the shape of that code so a review can cite one. They apply [`SH-3`](../shell-and-python.md), [`IAC-3`](../infrastructure.md), `IAC-4`, `CI-13` and `OPS-1` to Ansible without restating them, and where a clause here differs from one of those the stricter reading governs.

## ANS-1 — host state is declared in Ansible

Anything that configures a host (packages, files, users, services, firewall rules, scheduled jobs) is declared in Ansible playbooks and roles written in YAML, and a script that performs host configuration is not an alternative to a role.

**Why:** a shell script hides desired state inside control flow so a reader must simulate it, while a module states the end state and reports whether it changed anything.

**Check:** review that a file in the diff that changes host state is YAML under `ansible/`.

## ANS-2 — Python 3, fully typed, is the only language for custom code

A custom module, plugin or filter is Python 3 only, every signature annotated (`TYP-2`), mypy strict and ruff run (`PY-2`, `TYP-5`), the minimum Python is the oldest interpreter any target host provides (`PY-3`), and a module carries its `DOCUMENTATION`, `EXAMPLES` and `RETURN` blocks, declares `supports_check_mode=True` and is unit tested (`TEST-1`), living in its one role's `library/` with helpers in `module_utils/` and filters in `filter_plugins/`; where Ansible's imports are untyped the mypy override names the `ansible.*` modules only, never a blanket `ignore_missing_imports`.

**Why:** custom code is where an untyped, untested language comes back in, and a module runs on a host with the privileges of the play.

**Check:** mypy strict and ruff over `ansible/` in CI, and a check that `pyproject.toml` declares `requires-python`.

## ANS-3 — no bash in a role, except a program the role installs

A role's tasks and handlers contain no `ansible.builtin.shell`, `ansible.builtin.raw` or `ansible.builtin.script` task, logic that does not fit a module is a Python module (`ANS-2`), and the one exception is a program the role installs as part of the service it configures (such as a helper run by a timer), which is a file the role ships, meets `SH-1` and is run by the role's test (`ANS-15`).

**Why:** shell inside a role is the script `ANS-1` replaces one step removed, and `shell` reports every run as changed.

**Check:** a check failing on those three module names under `ansible/roles/*/tasks` and `ansible/roles/*/handlers`; review until it exists.

## ANS-4 — the toolchain is pinned

ansible-core, ansible-lint, Molecule and its driver plugin, mypy and ruff are pinned to exact versions in one committed requirements file under `ansible/`, every collection a role uses is pinned to an exact version in `ansible/requirements.yml` and vendored so a clean checkout installs the pinned set with no network beyond the pins, the pre-commit ansible-lint hook's `rev` equals the requirements-file version, and a bump is a deliberate PR changing the pin and, for a collection, the vendored copy together, with the collection pins reviewed whenever `ansible-core` changes.

**Why:** Ansible's behaviour moves between core releases so an unpinned install makes a green run unrepeatable (the reason `CI-1` pins actions), and a vendored collection cannot change or disappear between two runs of one commit.

**Check:** a check that every requirements line and collection entry carries an exact version, with review of a bump and of the vendored copy against its pin until a check exists; Dependabot raises the pip pins (`DEP-8`) but has no Ansible-collection ecosystem, so a collection can age silently until that review.

## ANS-5 — ansible-lint runs at the production profile

`.ansible-lint` at the repository root sets `profile: production` and `strict: true`, runs non-mutating (`CI-4`) from the repository root in pre-commit and in CI with `--strict`, and no route hides a finding or file from it: the configuration sets none of `skip_list`, `exclude_paths`, `mock_modules`, `mock_roles` or `kinds`, no ignore file exists (`.ansible-lint-ignore` or `.config/ansible-lint-ignore.txt`), no invocation passes `-x`, `--exclude` or `-i`, no task carries the `skip_ansible_lint` tag, `warn_list` is exactly `experimental`, and `enable_list` includes `no-log-password` (`ANS-16`); a single finding is suppressed only with `# noqa: <rule>` on its line and the reason in a comment on the line above, and `.ansible-lint`, `.yamllint` and any ignore file are exemption files for `STD-001` and `REPO-5`.

**Why:** the profile is the maintained, named definition of good Ansible, and each listed route removes a finding or file from what it sees, so a profile a PR can switch off with one line is not a floor.

**Check:** a CI step running ansible-lint with `--strict`, and a check that `.ansible-lint` names the production profile, sets none of the keys above, has a `warn_list` of `experimental` alone, that no ignore file exists, no workflow or pre-commit `args` passes one of the flags and no task carries the tag; review until the check exists, and the routes listed are those found in the tool's documentation and source, not claimed exhaustive.

## ANS-6 — yamllint covers every YAML file under `ansible/`

`.yamllint` extends `default` and keeps `comments.min-spaces-from-content` at 1, `braces.min-spaces-inside` at 0, `braces.max-spaces-inside` at 1 and both `octal-values.forbid-implicit-octal` and `forbid-explicit-octal` true (the five settings ansible-lint's `yaml` rule requires), sets `line-length.max` to 160 and disables `document-start` as ansible-lint's own default does, and runs in pre-commit and CI as its own step over every YAML file under `ansible/`.

**Why:** unformatted YAML turns a one-line change into a whole-file diff and hides what changed from a reviewer, and a file ansible-lint does not treat as Ansible content is still covered.

**Check:** a CI step running yamllint with the committed `.yamllint`, and a check that the file keeps the five settings and the two values.

## ANS-7 — every role declares its interface in `meta/argument_specs.yml`

Every role has `meta/argument_specs.yml` with one entry point per tasks file the role exposes (`main` for `tasks/main.yml`) and an `options` entry for every variable the role reads from outside it, each with `type`, `description` and either `required` or `default`, a list stating `elements`, a nested dictionary stating `options` and a closed set stating `choices`, with no outside variable the spec does not declare, `defaults/main.yml` agreeing with the spec's defaults, and every variable name beginning with the role's name and an underscore.

**Why:** without a spec a role's interface is whatever its tasks happen to read and a misspelt variable silently falls back to a default; Ansible's validation coerces (a `1` passes a `str` check and the role still gets the integer), so a role needing a string converts it explicitly.

**Check:** a check that every directory under `ansible/roles/` has the file; review of the spec against the variables the tasks read.

## ANS-8 — modules and plugins are named by fully qualified collection name

Every module and plugin a task or template names carries its fully qualified collection name, `ansible.builtin.` included, the `collections:` keyword is not used to shorten a name, and a module bundled in a role's `library/` is the one bare name and carries the role's name as a prefix, while a module needed by more than one role moves to a collection.

**Why:** a short name leaves the namespace to be resolved at run time, so the same task can run different code on two controllers.

**Check:** the `fqcn` rule in the production profile (`ANS-5`) for task names, and review for the rest, including every file under a role's `templates/` and a role's `library/` module, which the rule's documentation does not cover.

## ANS-9 — a module before a command

A task uses a module wherever one exists, `ansible.builtin.command` is given as an argument list with no shell features and is used only where no module exists, stating its change with `changed_when` or `creates` or `removes`, and a command needed twice or whose output is parsed or branched on becomes a Python module (`ANS-2`).

**Why:** a module knows the state it manages and reports change from it, while a command reports what the author guessed, and an idempotence proof (`ANS-11`) over guesses proves nothing.

**Check:** the `command-instead-of-module`, `command-instead-of-shell` and `no-changed-when` rules under the production profile (`ANS-5`); review for a command where a module exists that those rules do not know, since the first works from a fixed set in its source.

## ANS-10 — every role supports check mode

A role and a playbook run to completion under `--check --diff` against a host in either state, a custom module declares `supports_check_mode=True` and changes nothing when `module.check_mode` is set, a task whose result depends on one that did not run in check mode is skipped explicitly with a stated reason, and `check_mode: false` is set only on a task that reads and changes nothing.

**Why:** the dry run is what an approver sees before the click (`CI-13`), and a role that fails under it or silently skips half its tasks gives them nothing to approve.

**Check:** review of the role and any module in the diff; the delivery path (`ANS-17`) has a plan job in check mode, and the role's test (`ANS-15`) requires a CI run of Molecule's `check` action, which Molecule's pages do not say runs the role in check mode, so the other state stays review.

## ANS-11 — a second run changes nothing

Running a role against a host it has already configured reports zero changed tasks, the role's test sequence includes Molecule's `idempotence` step and never removes it, and a task that always reports changed is fixed with a module, `changed_when`, `creates` or `removes`, never excepted.

**Why:** an apply that is not idempotent cannot be repeated safely after a partial failure, and its change report stops meaning anything.

**Check:** the role's Molecule run in CI (`ANS-15`) fails when the idempotence step reports a change.

## ANS-12 — no role imports another role

No role imports another role.

**Why:** shared logic belongs in a playbook or a collection, and a role that applies another hides from its playbook what gets applied.

**Check:** a check in the repository that owns the roles (`ansible/checks/test_role_composition_gate.py` in `shared-infra`) fails an `include_role`, an `import_role` or a `meta/main.yml` `dependencies` entry in a role; without such a check this is review.

## ANS-13 — where roles and playbooks live

A role lives in the repository that owns the service it configures, under `ansible/roles/<role_name>/` so a service change and its deployment change are one PR, a playbook lives in `ansible/playbooks/` and only selects hosts and lists roles with their variables, a role needed by more than one repository is published from one as a versioned collection consumed by an exact version (`ANS-4`) and never copied, and where inventories live is not decided here.

**Why:** a role kept apart from the service it deploys drifts from it, and a copied role is two roles with one name; this is a chosen trade-off, not a consequence of `PRIN-5`, and a host whose roles come from several repositories needs one playbook listing them, which this page does not assign to a repository.

**Check:** review of new paths under `ansible/` in the diff.

## ANS-14 — a README a maintainer can use cold

Every role has a `README.md` written for a maintainer new to the repository (`DOC-4`, `DOC-6`) that states in order the one service the role configures and what it does not do, its interface (pointing at `meta/argument_specs.yml` and naming the secret variables), its requirements, what it changes on a host, how to run its test, how it is delivered (`ANS-17`) and how to change it safely, and it carries no host names, addresses or tenant data.

**Why:** the role must be maintainable by a person if no agent touches it again, and a role understood only by its author is not.

**Check:** review of the README against the role's tasks.

## ANS-15 — every role carries a container-only Molecule test

A role has a Molecule scenario at `molecule/default/` that converges it on a container, converges a second time to prove idempotence (`ANS-11`) and runs a verify playbook asserting the outcome and not only that converge finished (`TEST-2`), with a `docker` or `podman` driver and never the `default` driver with `managed: False`, a `docker_host` or connection option reaching anything but the local runtime, or an inventory naming a production host, no platform setting `docker_host` and the CI job leaving `DOCKER_HOST` unset, each platform image pinned by digest (`CON-3`) with `pre_build_image: true`, a platform needing `privileged` or added capabilities saying why in the scenario file, and CI running the default test sequence and the `check` action (`ANS-10`) with the result blocking merge (`CI-14`).

**Why:** a role proven only by running it on production is not proven, a test that can reach production is a second way to apply to it (`ANS-17`), and a set `DOCKER_HOST` can point the test at another engine.

**Check:** a check that every role has the scenario, that no scenario names an unmanaged driver, sets `docker_host` or omits `pre_build_image: true`, and that the CI job does not set `DOCKER_HOST`; the CI run is the test, and the first role to use a digest reference on the pre-built path records that it runs.

## ANS-16 — secrets never reach a log

Every task that reads, templates or passes a secret sets `no_log: true`, in a loop too, and sets `diff: false` where `--diff` would show the rendered secret, and a secret reaches a role as a variable supplied at run time, never as a default in `defaults/main.yml`, and is never committed (`CRED-11`) or logged (`LOG-4`), with a Molecule test using throwaway values made for the run.

**Why:** a secret in a CI log is published to everyone who can read it, and Ansible prints task arguments and diffs by default.

**Check:** review of every task and template in the diff that handles a secret, backed by the `no-log-password` rule in `.ansible-lint` (`ANS-5`) and the secret scan of `CRED-11`, neither of which replaces it (the rule flags only a looped task with a `password` argument name and `no_log` not true), and how a secret reaches a host is recorded here by amendment.

## ANS-17 — a role is applied only by the gated workflow

Delivery to a production host is only through a GitHub workflow run against `main` after its protected deployment environment's approval (`CI-12`, `CI-13`, `IAC-4`), as a gated pull where a plan job shows each host's diff before the approval, the host then runs `ansible-pull` of that exact commit of `main` and CI never holds a root shell, every live apply gets a second run that must report zero changes, and a nightly drift run in check mode is part of the same plan; an agent never delivers to a production host any other way, not by `ansible-playbook` from a local machine even in check mode, a probe, lab or spike touching no production host is outside this clause, a hand-made emergency change is redone through the workflow within a day (`OPS-1`), the human exceptions are `IAC-1`'s list, and an author's local run is the role's Molecule test on local containers (`ANS-15`).

**Why:** a deploy from a laptop skips the approval and the review, depends on that laptop's credentials and leaves no run to audit, and pushing from a CI runner over SSH was the alternative the owner did not choose and this page does not approve.

**Check:** review that a delivery workflow has a plan job before a protected environment, the pull follows the gate, a second run follows every live apply and no document tells an agent to run `ansible-playbook` by hand; how the pull is triggered, how the host verifies the commit and how the second run is wired are recorded here by amendment.

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
