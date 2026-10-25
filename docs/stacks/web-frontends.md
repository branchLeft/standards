# Web front ends

Rules for every site we build: the lightest stack that does the job, HTML and CSS first, accessibility tested as the user moves through the site. Shared components are built in the component library, and the React application rules are in [`react-app.md`](react-app.md).

## WEB-1 — the lightest stack that works

A site with no interactive features is a static site, and a site with interactive features is a React Router v7 application rendered on the server on every route.

**Why:** a static site is sometimes plenty, and server rendering keeps pages fast and usable before any JavaScript runs.

**Check:** review of a new site's choice of stack.

## WEB-2 — HTML and CSS first

Sites are built with HTML and CSS wherever they can do the job, JavaScript is used only where clearly needed (certain authentication libraries, highly interactive components), and pages enhance progressively ([`APP-6`](react-app.md)).

**Why:** less JavaScript means a smaller attack surface, faster pages and simpler web development.

**Check:** review of new client-side scripts in the diff.

## WEB-3 — WCAG AA fails the build, AAA warns

Accessibility is tested against WCAG, an AA violation fails the build and an AAA finding warns, with AAA met wherever possible.

**Why:** AA is the floor we promise and AAA is where we aim.

**Check:** axe-core rule tags in the shared browser-test helper: AA tags fail, AAA tags report.

## WEB-4 — axe runs at every meaningful state

Every app's browser tests run an axe assertion after each navigation and after interacting with a component, on every route, inside the existing tests and not in a separate pass ([`APP-4`](react-app.md) is the React form).

**Why:** many accessibility failures appear only after an interaction, and reusing the existing tests avoids navigating everything twice.

**Check:** review of new routes and interactions against the tests.
