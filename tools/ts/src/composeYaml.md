# composeYaml.ts

A YAML subset parser sized to Compose files, not a general YAML engine.
Handles block maps, block sequences, `- key: value` inline-map sequence
items, flow sequences (`[a, b]`) including ones wrapped onto several source
lines (bracket-depth tracked across lines before indentation parsing runs),
comment stripping that respects quotes, `{}` as an empty map, and — in
block context only — anchors (`&name`), aliases (`*name`) and merge keys
(`<<: *name`, including `<<: [*a, *b]`).

## Anchors, aliases and merge keys

`x-common: &common` followed by a deeper-indented block registers that
block under `common`; a later `*common` resolves to the same node, and
`<<: *common` inside another map splices that node's entries in with
lower priority than the map's own explicit keys (an explicit key always
overrides a merged one; among several merge sources, the first-listed one
wins a collision — both match standard YAML merge-key semantics). This is
the idiomatic way a Compose file shares hardening settings (`cap_drop`,
`read_only`, `security_opt`) across services, so it needs to actually work
rather than degrade gracefully: an earlier version of this parser treated
`&name` as an ordinary scalar value, which didn't just misread the anchor
— finding no colon-terminated key/value shape after it, the top-level map
parser stopped consuming lines entirely partway through the document,
silently discarding every sibling key that followed (`services:` included).
Anchors and aliases are resolved only where the fleet actually uses them —
inside a `[...]` flow sequence, a bare `*name` item is left as a literal
string, not resolved, since no observed Compose file does this.

## What it doesn't handle

No multi-document streams, no block scalars (`|`/`>`, so a multi-line
shell script under `command: |` is read as nothing), and no flow mappings
beyond the literal `{}` empty case. None of these have been observed in
the fleet's Compose files; a value shaped like one is silently dropped
rather than misparsed into something plausible-looking, so a gate reading
it sees an absence, not a wrong value. This safety property does **not**
extend to anchors/aliases/merge keys, which are actively parsed rather
than dropped — an anchor referencing a name never defined, or a merge key
whose alias isn't a map, resolves to nothing being merged rather than a
finding; it fails silent-empty, not silent-truncating, but it is still
silent. A gate that depends on a merge landing should be verified against
the rendered file, not assumed from the source alone.

## Line numbers

Every node carries the source line its key (or, for a flow value spanning
several lines, its first line) started on, so findings point at somewhere
a reviewer can look, not just "somewhere in this file".
