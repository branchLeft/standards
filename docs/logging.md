# Logging

Logs exist for debugging. A log line that is not searchable and informative
serves no purpose. Logs are short-lived, and they are not an audit trail:
audit is a separate feature, built on purpose.

## LOG-1 — one logging layer everywhere

Every service logs through one shared logging layer, the same across
languages, registered as middleware at the application's top level.

**Why:** one shape everywhere means one way to search, and top-level
middleware means no request goes unlogged.

**Check plan:** review of each service's entrypoint for the middleware
registration; later, an ast-grep rule per framework.

## LOG-2 — one JSON log schema

Every log line is one JSON object carrying the common fields: timestamp,
level, service, version, host, environment, event name, message, request and
trace IDs, the HTTP fields on request lines, and on errors the error type and
an error ID a user can quote to us. Any other field may be added freely.

**Why:** common fields make every service searchable the same way, and free
fields leave room for what each service needs.

**Check plan:** a JSON Schema for the common fields, asserted by each service's
logging-middleware tests.

## LOG-3 — four indexed labels

The log store indexes only four labels: `service`, `host`, `environment` and
`level`. Everything else stays inside the JSON.

**Why:** each distinct combination of labels creates a new stream, and a
high-variety label such as a request ID breaks the store.

**Check plan:** a CI check of the log shipper's configuration against the
four-label list.

## LOG-4 — nothing sensitive in logs

Logs never contain secrets or personal data. Redaction happens twice: at the
source, in the service's logging middleware, and again in the log shipper for
known patterns such as email addresses and tokens. Where the fact matters, log
a redaction marker, a character count or a fixed message instead. Mail-server
logs, which have to name addresses, keep only a hash of the part before the
`@`.

**Why:** logs are copied, shipped and kept, so anything sensitive in them
spreads further than the service that wrote it.

**Check plan:** unit tests of the middleware's redaction; a test of the
shipper's redaction rules against sample lines.

## LOG-5 — raw logs are kept 30 days

Raw logs are kept for 30 days, enforced by the log store's own retention.

**Why:** debugging needs weeks of logs, not years, and every day kept is
personal data held.

**Check plan:** a CI check of the log store's retention setting; the period is
recorded under [`DP-4`](data-protection.md).

## LOG-6 — logging is not audit

A system that needs an audit trail builds one as its own feature, with its own
storage and retention. Customer-facing and admin portals need one.

**Why:** logs are short-lived and lossy by design, so they cannot prove who
did what.

**Check plan:** review of the design of any portal where customers or
administrators act.

## LOG-7 — aggregates come from logs automatically

Every service gets aggregate metrics derived from its logs, such as errors per
service per minute, with no per-service work.

**Why:** aggregates take little storage, so they can outlive the raw logs by
years (`OBS-9`).

**Check plan:** promtool unit tests on the log store's recording rules.

## LOG-8 — one self-hosted log stack

Logs are shipped by Grafana Alloy into a self-hosted Grafana Loki, alongside
Prometheus and Grafana. VictoriaLogs is the fallback if Loki doesn't fit.

**Why:** logs and metrics share one platform and one Grafana, from a supplier
and licence already in use.

**Check plan:** review of the monitoring stack's deployment code.
