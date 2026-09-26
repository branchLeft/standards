# Web front ends

Rules for every site we build, whatever its stack. Pick the lightest stack
that does the job, build with HTML and CSS first, and test accessibility as
the user moves through the site. Shared components are built in the component
library, which grows into our design system over time. The React application
rules are in [`react-app.md`](react-app.md).

## WEB-1 — the lightest stack that works

A site with no interactive features is a static site. A site with interactive
features is a React Router v7 application, rendered on the server on every
route.

**Why:** sometimes a static site is plenty, and server rendering keeps pages
fast and usable before any JavaScript runs.

**Check plan:** review of a new site's choice of stack.

## WEB-2 — HTML and CSS first

Build with HTML and CSS wherever they can do the job. JavaScript is used only
where it is clearly needed, such as certain authentication libraries or highly
interactive components, and pages enhance progressively
([`APP-6`](react-app.md)).

**Why:** less JavaScript means a smaller attack surface, faster pages and
simpler, cleaner web development.

**Check plan:** review of new client-side scripts in the diff; later, a
JavaScript size budget per route.

## WEB-3 — WCAG AA fails the build, AAA warns

Accessibility is tested against WCAG. An AA violation fails the build, and an
AAA finding warns. AAA is met wherever possible.

**Why:** AA is the floor we promise, and AAA is where we aim.

**Check plan:** axe-core rule tags in the shared browser-test helper: AA tags
fail, AAA tags report.

## WEB-4 — axe runs at every meaningful state

Every app's browser tests run an axe assertion at each meaningful state —
after each navigation and after interacting with a component — on every
route. The assertions sit inside the existing tests, not in a separate pass
that navigates again.

**Why:** many accessibility failures appear only after an interaction, and
reusing the existing tests avoids navigating everything twice.

**Check plan:** review of new routes and interactions against the tests;
later, a check that every route is visited by a test that calls the axe
helper.

[`APP-4`](react-app.md) is the React application form of this rule.
