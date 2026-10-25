#!/usr/bin/env bash
# Checks the shape of the scheduled repo-settings audit so it can only read.
#
# Usage: check_audit_shape.sh <workflow-file> <audit-script>
# Prints one line per violation and exits non-zero if there is any. Anything
# that is not positively recognised as the safe shape is a violation, so a new
# construct fails closed. Comment lines are dropped before every check.
#
# Portable on purpose: no regex intervals and no GNU-only awk or sed features,
# because this runs under mawk in CI and BSD awk on macOS.
set -uo pipefail

WORKFLOW="${1:-}"
AUDIT="${2:-}"
QUOTE="[\"']?"
PERMISSIONS_KEY="^${QUOTE}permissions${QUOTE}:"
ON_KEY="^${QUOTE}on${QUOTE}:"
CONTINUE_OK='^[[:space:]]*(-[[:space:]]+)?continue-on-error:[[:space:]]+'"${QUOTE}"'false'"${QUOTE}"'([[:space:]]+#.*)?[[:space:]]*$'
AUDIT_RUN='run:[[:space:]]+tools/ruleset-audit\.sh[[:space:]]*$'
TOKEN_MAP='^[[:space:]]*(-[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*:[[:space:]]+\$\{\{[[:space:]]*secrets\.RULESET_AUDIT_TOKEN[[:space:]]*\}\}[[:space:]]*$'
IF_MESSAGE='audit workflow puts an if: condition on the token guard, the audit step or its job'
EXIT_ONE='(^|[[:space:];&|(])exit[[:space:]]+1([[:space:];&|)]|$)'

violations=0
report() { # message
  printf '%s\n' "$1"
  violations=$((violations + 1))
}

strip_comments() { # file
  grep -vE '^[[:space:]]*#' "$1"
}

join_continuations() { # file: a line ending in a backslash joins the next line
  strip_comments "$1" | sed -e ':a' -e '/\\$/N' -e 's/\\\n//' -e 'ta'
}

is_get() { # word
  case "$1" in
    [Gg][Ee][Tt]) return 0 ;;
    *) return 1 ;;
  esac
}

unquote() { # word
  local stripped="${1//\"/}"
  printf '%s' "${stripped//\'/}"
}

# A word without the shell punctuation and quotes around it, so "gh", $(gh and
# gh; all read as gh.
bare_word() { # word
  local word="${1##*[;&|(\`\{]}"
  unquote "${word%%[;&|)]*}"
}

# Refuses any gh api call whose words could write: a non-GET method, or a flag
# that sends a request body. The api word may follow gh after other words, as
# in gh --hostname example.com api. Words run to the next | || && ; or ).
check_gh_api_reads() { # file message
  local file="$1" message="$2" line i word value state
  local -a words
  while IFS= read -r line; do
    read -r -a words <<< "$line"
    state=seek_gh
    for ((i = 0; i < ${#words[@]}; i++)); do
      case "$state" in
        seek_gh) [ "$(bare_word "${words[i]}")" = gh ] && state=seek_api ;;
        seek_api) [ "$(bare_word "${words[i]}")" = api ] && state=in_call ;;
        in_call)
          word="$(unquote "${words[i]}")"
          case "$word" in
            '|'|'||'|'&&'|';'|')') state=seek_gh ;;
            -X|--method)
              i=$((i + 1))
              value="$(unquote "${words[i]:-}")"
              is_get "$value" || report "$message" ;;
            -X*) is_get "${word#-X}" || report "$message" ;;
            --method=*) is_get "${word#--method=}" || report "$message" ;;
            -f|-F|--field|--raw-field|--input|-f*|-F*|--field=*|--raw-field=*|--input=*)
              report "$message" ;;
          esac ;;
      esac
    done
  done < <(join_continuations "$file")
}

# The text after the colon on the single line that matches the key, if any.
inline_after_colon() { # file key_regex
  strip_comments "$1" | grep -E "$2" | sed -e 's/^[^:]*://'
}

# The indented lines under a column-0 key, up to the next column-0 content.
top_level_block() { # file key_regex
  strip_comments "$1" | awk -v key_regex="$2" '
    $0 ~ key_regex { inside = 1; next }
    /^[^[:space:]]/ { inside = 0 }
    inside && /[^[:space:]]/ { print }
  '
}

# Of a block, the lines at its key indentation; a line indented less is marked.
block_key_lines() {
  awk '
    function indent(text) { match(text, /^[ ]*/); return RLENGTH }
    /[^[:space:]]/ {
      depth = indent($0)
      if (!has_depth) { key_depth = depth; has_depth = 1 }
      if (depth == key_depth) print
      else if (depth < key_depth) print "LESS-INDENTED " $0
    }
  '
}

has_content() { # text
  [ -n "$(printf '%s' "$1" | tr -d '[:space:]')" ]
}

check_permissions() { # workflow
  local count rest block trimmed
  count="$(strip_comments "$WORKFLOW" | grep -cE "$PERMISSIONS_KEY")"
  if [ "$count" -eq 0 ]; then
    report 'audit workflow has no top-level permissions block'
    return
  fi
  [ "$count" -eq 1 ] || report 'audit workflow has more than one top-level permissions block'
  rest="$(inline_after_colon "$WORKFLOW" "$PERMISSIONS_KEY")"
  if has_content "$rest"; then
    report 'audit workflow grants a write permission or more than contents: read'
  fi
  block="$(top_level_block "$WORKFLOW" "$PERMISSIONS_KEY")"
  trimmed="$(printf '%s\n' "$block" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  [ "$trimmed" = 'contents: read' ] \
    || report 'audit workflow grants a write permission or more than contents: read'
  if [ "$(strip_comments "$WORKFLOW" | grep -cE "^[[:space:]]+(-[[:space:]]+)?${QUOTE}permissions${QUOTE}:")" -gt 0 ]; then
    report 'audit workflow grants a write permission or more than contents: read'
  fi
}

check_triggers() { # workflow
  local count rest line
  count="$(strip_comments "$WORKFLOW" | grep -cE "$ON_KEY")"
  if [ "$count" -eq 0 ]; then
    report 'audit workflow has no top-level on: block'
    return
  fi
  [ "$count" -eq 1 ] || report 'audit workflow has more than one top-level on: block'
  rest="$(inline_after_colon "$WORKFLOW" "$ON_KEY")"
  if has_content "$rest"; then
    report 'audit workflow has a trigger besides schedule and workflow_dispatch'
  fi
  while IFS= read -r line; do
    [[ $line =~ ^[[:space:]]*(schedule|workflow_dispatch):[[:space:]]*$ ]] \
      || report 'audit workflow has a trigger besides schedule and workflow_dispatch'
  done < <(top_level_block "$WORKFLOW" "$ON_KEY" | block_key_lines)
}

# Prints each step of every job, each step preceded by a @@STEP line.
steps_of() { # workflow
  awk '
    function indent(text) { match(text, /^[ ]*/); return RLENGTH }
    function is_item(text) { return text ~ /^[ ]*-([ ]|$)/ }
    /^[[:space:]]*steps:[[:space:]]*$/ {
      in_steps = 1; steps_indent = indent($0); item_indent = -1; next
    }
    in_steps && /[^[:space:]]/ {
      depth = indent($0)
      if (item_indent < 0 && is_item($0) && depth >= steps_indent) item_indent = depth
      if (item_indent < 0) { if (depth <= steps_indent) in_steps = 0; next }
      if (depth < item_indent) { in_steps = 0; next }
      if (depth == item_indent && is_item($0)) print "@@STEP"
      print
    }
  ' "$1"
}

is_token_guard() { # step text
  local step="$1" variable
  grep -qE "$EXIT_ONE" <<< "$step" || return 1
  while IFS= read -r variable; do
    grep -qE -e "-z[[:space:]]+${QUOTE}\\\$\\{?${variable}\\}?${QUOTE}(\\]|[[:space:]]|\$)" <<< "$step" \
      && return 0
  done < <(grep -oE "$TOKEN_MAP" <<< "$step" | sed -E 's/^[[:space:]]*(-[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*):.*/\2/')
  return 1
}

# Whether a step, given as text with its item line first, has an if key at the
# column its other keys start at. Deeper lines (mappings, scripts) are not keys.
step_has_condition() { # step text
  printf '%s\n' "$1" | awk '
    function indent(text) { match(text, /^[ ]*/); return RLENGTH }
    function is_condition(text) { return text ~ /^("if"|\047if\047|if)[ ]*:/ }
    /[^[:space:]]/ {
      if (!seen_item) {
        seen_item = 1
        rest = $0; sub(/^[ ]*-[ ]*/, "", rest)
        if (rest ~ /[^[:space:]]/) { key_indent = length($0) - length(rest); found = found || is_condition(rest) }
        next
      }
      if (key_indent == "") key_indent = indent($0)
      if (indent($0) == key_indent) found = found || is_condition(substr($0, key_indent + 1))
    }
    END { exit !found }
  '
}

# Whether the job that runs the audit script has an if key beside its steps key.
job_has_condition() { # workflow
  awk '
    function indent(text) { match(text, /^[ ]*/); return RLENGTH }
    function is_condition(text) { return text ~ /^("if"|\047if\047|if)[ ]*:/ }
    /^[[:space:]]*#/ || !/[^[:space:]]/ { next }
    { count++; depth[count] = indent($0); text[count] = $0 }
    END {
      for (steps = 1; steps <= count; steps++) {
        if (text[steps] !~ /^[ ]*steps:[ ]*$/) continue
        first = steps; while (first > 1 && depth[first - 1] >= depth[steps]) first--
        last = steps; while (last < count && depth[last + 1] >= depth[steps]) last++
        holds_audit = 0; has_condition = 0
        for (line = first; line <= last; line++) {
          if (text[line] ~ /run:[ ]+tools\/ruleset-audit\.sh[ ]*$/) holds_audit = 1
          if (depth[line] == depth[steps] && is_condition(substr(text[line], depth[steps] + 1))) has_condition = 1
        }
        if (holds_audit && has_condition) found = 1
      }
      exit !found
    }
  ' "$1"
}

check_token_guard() { # workflow
  local -a steps=()
  local step="" line i audit_seen=0 guard_seen=0
  while IFS= read -r line; do
    if [ "$line" = '@@STEP' ]; then
      [ -n "$step" ] && steps+=("$step")
      step=""
    else
      step+="$line"$'\n'
    fi
  done < <(steps_of "$WORKFLOW"; echo '@@STEP')
  for ((i = 0; i < ${#steps[@]}; i++)); do
    if grep -qE "$AUDIT_RUN" <<< "${steps[i]}"; then
      audit_seen=1
      ! step_has_condition "${steps[i]}" || report "$IF_MESSAGE"
      break
    fi
    if is_token_guard "${steps[i]}"; then
      guard_seen=1
      ! step_has_condition "${steps[i]}" || report "$IF_MESSAGE"
    fi
  done
  if [ "$audit_seen" -eq 0 ]; then
    report 'audit workflow has no step running tools/ruleset-audit.sh'
  elif [ "$guard_seen" -eq 0 ]; then
    report 'audit workflow lacks a guard step that exits 1 when RULESET_AUDIT_TOKEN is empty before the audit step'
  fi
}

check_job_condition() { # workflow
  ! job_has_condition "$WORKFLOW" || report "$IF_MESSAGE"
}

check_continue_on_error() { # workflow
  local line
  while IFS= read -r line; do
    report 'audit workflow sets continue-on-error to something other than false'
  done < <(strip_comments "$WORKFLOW" | grep -F 'continue-on-error' | grep -vE "$CONTINUE_OK")
}

# Tests that only look at the path come first, so a FIFO is never opened.
check_input_file() { # file
  if [ ! -e "$1" ]; then
    report "cannot read $1"
  elif [ ! -f "$1" ]; then
    report "not a regular file: $1"
  elif [ ! -r "$1" ]; then
    report "cannot read $1"
  fi
}

[ "$#" -eq 2 ] || { echo 'usage: check_audit_shape.sh <workflow-file> <audit-script>' >&2; exit 2; }
for file in "$WORKFLOW" "$AUDIT"; do
  check_input_file "$file"
done
if [ "$violations" -eq 0 ]; then
  check_gh_api_reads "$WORKFLOW" 'audit workflow runs gh api with a non-GET method or a request-body flag'
  check_gh_api_reads "$AUDIT" 'audit script runs gh api with a non-GET method or a request-body flag'
  check_permissions
  check_triggers
  check_token_guard
  check_job_condition
  check_continue_on_error
fi
[ "$violations" -eq 0 ]
