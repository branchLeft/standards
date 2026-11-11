# shellPlaceholderGate.ts

SH-4 says a fenced shell block meant to be copied never carries an unfilled
placeholder: an unknown value is read into a variable and the command uses
`$NAME`. This reader finds placeholder-shaped tokens inside the shell fences of
tracked markdown documents. SH-4 stays `pending` and every finding is
`advisory`; the gate is not on `tools/ts-promoted.tsv`.

## What it reads

- Tracked `*.md` files, except a path under `template/` or `templates/` (the
  clause keeps `[ALL_CAPS]` placeholders in templates).
- Fenced blocks (backtick or tilde) whose language is `bash`, `sh`, `shell`,
  `zsh`, `console`, `shell-session` or `shellsession`. A block with no language,
  or any other language, is not read. A fence closes only on the same character
  at least as long, so a longer outer fence hides the fences it quotes.
- Not the body of a heredoc, and not a line that starts with `#`.

## What it reports

One finding per line, for the first of these on the line:

| Shape                           | Example                             |
| ------------------------------- | ----------------------------------- |
| angle-bracket word              | `<your-token-here>`, `<org>/<repo>` |
| `[ALL_CAPS]` with an underscore | `[TARGET_ENV]`                      |
| a name ending in `_HERE`        | `YOUR_TOKEN_HERE`                   |
| `REPLACE_ME`, `CHANGE_ME`       | `REPLACE_ME`, `CHANGEME`            |
| double-brace name               | `{{ release }}`                     |

Not placeholders, by construction: a redirection (`<input.txt`), process
substitution (`<(ls)`), a here-string, `$NAME`, `${NAME}`, a GitHub expression
(`${{ secrets.NAME }}`) and a Go template field (`{{.State.Status}}`).

## Limits

The reader cannot tell a block meant to be copied from one that shows the shape
of a command, so a usage line such as `tool <repo>` is reported. A true
exception takes `.standardsignore` for a file or an inline
`standards-allow-next-line SH-4 <reason>` on the line above. A bare
`[TOKEN]` with no underscore and a spaced `<your token>` are not matched, to
keep shell tests and comparisons out.

Promotion is the one row in `tools/ts-promoted.tsv` plus the `auto` index row and
an end-to-end fixture (docs/ratchet.md), and waits on a sweep that shows the
reported lines are real.
