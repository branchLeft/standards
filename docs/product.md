# Product

For people deciding what PublicPress does for its customers.

These clauses bind what we build, not how the code is written. Each one is the
platform owner's decision, and changing one is too.

## PROD-1 — reader tracking starts off

A new site starts with reader tracking off. Newsletter open and click tracking
and member analytics are switched on by the publisher, knowingly, per site.

**Why:** a record of what each reader opened and clicked is a data trail about
them. It should exist only where a publisher chose it.

## PROD-2 — publishers can always leave

A publisher can always leave: all their content and members export in the
standard formats another Ghost host can import. Making PublicPress easy to run
yourself is not a goal.

**Why:** lock-in is a reason to reject a supplier (`PRIN-4`), so we hold
ourselves to the same test. Running the code yourself is a different promise.
The service is the engineering and support around the code, which someone
running a copy would quietly lose, and the licence stops the code being run as
a competing service.

## PROD-3 — private by default, never manipulative

Sites and reader features are private by default, with no dark patterns and no
engagement mechanics: nothing is tuned to keep someone reading, clicking or
coming back against their own interest. Content scanning and moderation serve
the same end, keeping readers safe.

**Why:** if it isn't safe for a child, it isn't safe. Defaults built for the
most vulnerable reader protect every reader.

## PROD-4 — security and accessibility in every plan

Security and accessibility are in every plan. Neither is ever a paid upgrade.

**Why:** `NFR-1` sets the floors, and this stops a price list undercutting
them.

## PROD-5 — no generative AI; automation is disclosed

PublicPress avoids generative AI, above all anywhere it could write or change
journalism. Automated processing that affects people, such as content scanning
and moderation, is disclosed and described to them, whether it uses a model, a
bought-in product or a fixed rule. If a generative feature is ever added, it
is opt-in, never required, and disclosed.

**Why:** "AI" is an overloaded term. The problem is generated content in a
product for trustworthy writing, not automation as such, so disclosure covers
every automated decision whatever the method is called.

## PROD-6 — shared services sit behind a contract

A shared platform service, such as the control plane or a message relay, sits
behind a clearly defined contract, so another implementation that fits the
contract can replace it. A service that can do its job without reading site
content does not read it.

**Why:** a clear seam keeps each service replaceable (`ARCH-2`, `ARCH-6`), and
content a service never reads is content it can't leak.
