# Product

These clauses bind what we build for customers, not how the code is written. Each is the platform owner's decision, and changing one is too.

## PROD-1 — reader tracking starts off

A new site starts with reader tracking off, and newsletter open and click tracking and member analytics are switched on by the publisher, knowingly, per site.

**Why:** a record of what each reader opened and clicked is a data trail about them and should exist only where a publisher chose it.

**Check:** review of new sites' default settings.

## PROD-2 — publishers can always leave

A publisher can always leave: all their content and members export in standard formats another Ghost host can import, and making PublicPress easy to run yourself is not a goal.

**Why:** lock-in is a reason to reject a supplier (`PRIN-4`), so we hold ourselves to the same test; running the code is a different promise from the service, which is the engineering and support around it.

**Check:** review of export paths and their formats.

## PROD-3 — private by default, never manipulative

Sites and reader features are private by default, with no dark patterns and no engagement mechanics (nothing tuned to keep someone reading, clicking or coming back against their own interest), and content scanning and moderation serve the same end of keeping readers safe.

**Why:** if it is not safe for a child it is not safe, and defaults built for the most vulnerable reader protect every reader.

**Check:** review of new reader-facing features and their defaults.

## PROD-4 — security and accessibility in every plan

Security and accessibility are in every plan, and neither is ever a paid upgrade.

**Why:** `NFR-1` sets the floors, and this stops a price list undercutting them.

**Check:** review of plan and pricing definitions.

## PROD-5 — no generative AI; automation is disclosed

PublicPress avoids generative AI, above all anywhere it could write or change journalism, and automated processing that affects people (content scanning, moderation) is disclosed and described to them whether it uses a model, a bought-in product or a fixed rule; a generative feature, if ever added, is opt-in, never required and disclosed.

**Why:** the problem is generated content in a product for trustworthy writing, not automation as such, so disclosure covers every automated decision whatever the method is called.

**Check:** review of new automated processing and its disclosure.

## PROD-6 — shared services sit behind a contract

A shared platform service (the control plane, a message relay) sits behind a defined contract so another implementation that fits it can replace it, and a service that can do its job without reading site content does not read it.

**Why:** a clear seam keeps each service replaceable (`ARCH-2`, `ARCH-6`), and content a service never reads is content it cannot leak.

**Check:** review of contracts between shared services and sites.
