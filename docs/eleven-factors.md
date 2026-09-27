# The Eleven Factors, mapped

For people comparing these standards with the Eleven Factors.

[The Eleven Factors](https://11factor.org/) are principles for building
software with AI. This page maps each factor to the clauses that carry it here,
and records where we depart from it and why.

| Factor                                   | Carried by                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| I. Trust no one                          | `STD-004`, `SEC-1`                                                        |
| II. Let kids play                        | `PROD-1`, `PROD-3`                                                        |
| III. Encrypt everything                  | `SEC-12`, `SEC-13`, `DP-1`, `DP-12`                                       |
| IV. Great design is for everyone         | `PROD-4`, `NFR-1`, `NFR-5`                                                |
| V. Intent is the system                  | `DOC-9`, `PRIN-1`; departs on prompts, below                              |
| VI. Built by humanity, owned by humanity | Departs, below                                                            |
| VII. Self-hosting is a right             | `PROD-2`, in part, below                                                  |
| VIII. Many small things                  | `PRIN-5`, `ARCH-8`, `SEC-13`                                              |
| IX. Inefficient builds efficient         | `PRIN-4`, `NFR-4`, `OPS-7`; agents use a model only where no tool will do |
| X. Humans come first                     | `ARCH-1`, `REPO-10`, `DOC-10`, `PROD-5`                                   |
| XI. Centralised infrastructure is glue   | `PROD-6`, in part, below                                                  |

## Where we depart

### Factor V: decisions are published, prompts are not

Factor V proposes an open prompt ledger. We publish decisions (`DOC-9`,
`PRIN-1`), but never prompts, transcripts or agent memory (`SEC-11`):
operational hygiene and security come first.

### Factor VI: source-available, not open source

Factor VI says software built with AI should be open source. Our product code
is published under PolyForm Shield: anyone can read it and learn from it, and
use it for anything except running a competing service. It is built in public
(`PRIN-1`), but it is not open source, and we never describe it that way. The
licence is what keeps the product financially sustainable.

### Factor VII: leaving is a right, self-hosting is not a goal

Factor VII says self-hosting should always be possible without compromise.
`PROD-2` keeps the part about ownership: a publisher can always take all their
content and members elsewhere. It does not commit us to making PublicPress easy
to run yourself.

### Factor XI: replaceable, not thin

Factor XI asks for shared infrastructure that is "thin, blind, replaceable".
`PROD-6` keeps replaceable, through a defined contract, and blind wherever a
service can do its job without reading content. It drops thin: a shared
service is as capable as its job needs.
