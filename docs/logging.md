# Logging

Logs exist for debugging; they are searchable, short-lived and not an audit trail.

## LOG-1 — one logging layer everywhere

Every service logs through one shared logging layer, the same across languages, registered as middleware at the application's top level.

**Why:** one shape means one way to search, and top-level middleware means no request goes unlogged.

**Check:** review of each service's entrypoint for the middleware registration.

## LOG-2 — one JSON log schema

Every log line is one JSON object carrying the common fields (timestamp, level, service, version, host, environment, event name, message, request and trace IDs, the HTTP fields on request lines, and on errors the error type and an error ID a user can quote), and any other field may be added freely.

**Why:** common fields make every service searchable the same way, and free fields leave room for what each service needs.

**Check:** a JSON Schema for the common fields, asserted by each service's logging-middleware tests.

## LOG-3 — four indexed labels

The log store indexes only `service`, `host`, `environment` and `level`, and everything else stays inside the JSON.

**Why:** each distinct label combination creates a new stream, and a high-variety label such as a request ID breaks the store.

**Check:** a CI check of the log shipper's configuration against the four-label list.

## LOG-4 — nothing sensitive in logs

Logs never contain secrets or personal data: redaction happens at the source in the service's logging middleware and again in the log shipper for known patterns, a redaction marker, character count or fixed message is logged where the fact matters, and mail-server logs keep only a hash of the part before the `@`.

**Why:** logs are copied, shipped and kept, so anything sensitive in them spreads further than the service that wrote it.

**Check:** unit tests of the middleware's redaction; a test of the shipper's redaction rules against sample lines.

## LOG-5 — raw logs are kept 30 days

Raw logs are kept for 30 days, enforced by the log store's own retention and recorded under [`DP-4`](data-protection.md).

**Why:** debugging needs weeks of logs, not years, and every day kept is personal data held.

**Check:** a CI check of the log store's retention setting.

## LOG-6 — logging is not audit

A system that needs an audit trail (customer-facing and admin portals do) builds one as its own feature with its own storage and retention.

**Why:** logs are short-lived and lossy by design, so they cannot prove who did what.

**Check:** review of the design of any portal where customers or administrators act.

## LOG-7 — aggregates come from logs automatically

Every service gets aggregate metrics derived from its logs, such as errors per service per minute, with no per-service work.

**Why:** aggregates take little storage, so they can outlive the raw logs by years (`OBS-9`).

**Check:** promtool unit tests on the log store's recording rules.

## LOG-8 — one self-hosted log stack

Logs are shipped by Grafana Alloy into a self-hosted Grafana Loki alongside Prometheus and Grafana, with VictoriaLogs as the fallback if Loki does not fit.

**Why:** logs and metrics share one platform and one Grafana, from a supplier and licence already in use.

**Check:** review of the monitoring stack's deployment code.
