# composeYaml.ts

A YAML subset parser sized to Compose files, not a general YAML engine.
Handles block maps, block sequences, `- key: value` inline-map sequence
items, flow sequences (`[a, b]`) including ones wrapped onto several source
lines (bracket-depth tracked across lines before indentation parsing runs),
comment stripping that respects quotes, and `{}` as an empty map.

## What it doesn't handle

No anchors/aliases, no multi-document streams, no block scalars (`|`/`>`,
so a multi-line shell script under `command: |` is read as nothing), and no
flow mappings beyond the literal `{}` empty case. None of these have been
observed in the fleet's Compose files; a value shaped like one is silently
dropped rather than misparsed into something plausible-looking, so a gate
reading it sees an absence, not a wrong value.

## Line numbers

Every node carries the source line its key (or, for a flow value spanning
several lines, its first line) started on, so findings point at somewhere
a reviewer can look, not just "somewhere in this file".
