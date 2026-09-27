# composeNetworkGate.ts

CON-7, CON-8 and CON-9 stay `pending`; every finding is `advisory`.

## The `x-egress` convention

CON-9 asks for "the destinations it may reach, in code beside the service"
without naming a shape. No shared convention exists yet, so this gate
defines one: a Compose extension field, `x-egress: [host, host, ...]`, on
each service. `x-` fields are part of the Compose spec precisely for this —
Docker itself ignores them — so adding one doesn't change how the stack
runs. This is this gate's contract, not a ratified standard; changing it
later is a reviewed decision, same as any other clause moving off
`pending`.

## CON-8 and CON-9 share one test

A service with an egress list is CON-9-compliant and CON-8 doesn't apply.
A service with no egress list must have no route out at all — attached only
to networks the top-level `networks:` block marks `internal: true`, and not
on `network_mode: host` (which bypasses Compose networking entirely). A
service with a route out and no egress list fails both clauses at once,
which is why `checkEgressAndIsolation` returns findings for each.

## CON-7's private-range allowance

The clause permits binding to "loopback or the private network", not just
loopback — `ports: ["10.20.2.20:8080:80"]` is compliant if `10.20.2.20` is
RFC1918. A bare `8080:80` or a `0.0.0.0`-style entry with no host address at
all binds every interface and fails. The `edge_service_names` threshold
(default `edge`) exempts the one front-door service by name; there's no way
to identify "the edge" from Compose shape alone.

## What this doesn't cover

"A test of the generated firewall rules" (CON-9's second half) needs a
firewall-rule generator that doesn't exist yet — nothing here generates or
checks host firewall state.
