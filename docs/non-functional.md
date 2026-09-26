# Non-functional requirements

Some qualities are floors that no product ever trades; others are a balance
that each product sets for itself and moves as it matures. Where each product
currently sits is recorded in the private operations docs.

## NFR-1 — floors are never traded

Security, accessibility, supplier ethics ([`PRIN-4`](principles.md)) and
honest sustainability claims are floors. They hold for every product at every
stage and are never traded for anything.

**Why:** they are what branchLeft stands for, so a product that breaks one is
not one we would ship.

**Check plan:** review; a design document says how it meets each floor.

## NFR-2 — availability, performance and cost are set per product

Availability, performance and cost are traded per product and per stage of
maturity, and each product records its current position in the operations
docs.

**Why:** a product still being built leans to low cost while a core service
leans to availability, and recording the position tells work which way to
lean.

**Check plan:** review; design documents cite the recorded position.

## NFR-3 — leaning on cost never blocks the pivot

A design that leans towards low cost must not block an easy later move
towards more availability or performance.

**Why:** products mature, and the balance has to be able to move with them.

**Check plan:** review of design documents for products that lean on cost.

## NFR-4 — sustainability is measured and published

Collect and publish as many sustainability measures and substantiated claims
as possible: supplier renewable status, image sizes, resource use.

**Why:** sustainability is a claim we make to customers, so it has to rest on
evidence.

**Check plan:** review; each published figure traces to a measurement.

## NFR-5 — accessible wherever the public meets us

Everything public-facing is accessible, not only web pages: emails, generated
documents and command-line output too.

**Why:** accessibility is a floor (`NFR-1`), and people meet us through more
than websites.

**Check plan:** review of new public-facing output; axe on HTML email where it
applies.

## NFR-6 — objectives we hold ourselves to

Once a service has service-level objectives, we hold ourselves to them and
report a miss openly, in proportion to its effect.

**Why:** an objective nobody reports against is only a wish.

**Check plan:** review; an incident entry (`OPS-5`) records any objective it
missed.
