#!/usr/bin/env bash
# DOC-11 — a repo on the tier list publishes a docs site. Reads the repo's
# .docs-site declaration against tools/docs-site-tiers.tsv; warns or fails as
# that repo's row says: check-docs-site.md.
# Usage: check-docs-site.sh [--repo NAME] [--run-build] [--json] [--mode X] [--self-test]

# shellcheck disable=SC2094  # finding writes to stdout; the declaration is only ever read

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib/ratchet.sh
. "$HERE/lib/ratchet.sh"

TIERS_FILE="${DOCS_SITE_TIERS_FILE:-$HERE/docs-site-tiers.tsv}"
DECL=".docs-site"
CLAUSE="DOC-11"
GATE_LEVEL="warn"

# page<TAB>slug<TAB>Title rows that this tier requires.
tier_pages() {
  awk -F'\t' -v t="$1" '
    /^[ \t]*#/ || NF < 4 { next }
    $1 == "page" { n = split($4, a, ","); for (i = 1; i <= n; i++) if (a[i] == t) { print $2 "\t" $3; break } }
  ' "$TIERS_FILE"
}

# tier<TAB>mode of one repo row; nothing when the repo is not listed.
register_row() {
  awk -F'\t' -v r="$1" '
    /^[ \t]*#/ || NF < 4 { next }
    $1 == "repo" && $2 == r { print $3 "\t" $4; exit }
  ' "$TIERS_FILE"
}

register_rows_count() { # kind
  awk -F'\t' -v k="$1" '/^[ \t]*#/ || NF < 4 { next } $1 == k { n++ } END { print n + 0 }' "$TIERS_FILE"
}

# A missing or empty list must never read as a clean scan.
register_usable() {
  [ -f "$TIERS_FILE" ] || { echo "check-docs-site: no tier list at $TIERS_FILE" >&2; return 1; }
  [ "$(register_rows_count page)" -gt 0 ] && [ "$(register_rows_count repo)" -gt 0 ] || {
    echo "check-docs-site: the tier list at $TIERS_FILE has no page or repo rows; refusing to report a clean run with nothing to check" >&2
    return 1
  }
}

note() {
  [ "$RATCHET_JSON" -eq 1 ] || printf '::notice::%s %s\n' "$CLAUSE" "$1"
}

# The enforce path sets its own level. ratchet_finding would downgrade a
# finding on an untracked or missing file to a warning, which fails open.
finding_enforce() {
  local file="$1" line="$2" msg="$3"
  if ratchet_is_exempt "$file" "$CLAUSE" || ratchet_is_allowed "$file" "$line" "$CLAUSE"; then
    RATCHET_EXEMPTED=$((RATCHET_EXEMPTED + 1))
    [ "$RATCHET_JSON" -eq 1 ] && ratchet__json "$CLAUSE" "$file" "$line" "exempt" "$msg"
    return 0
  fi
  RATCHET_FAILURES=$((RATCHET_FAILURES + 1))
  if [ "$RATCHET_JSON" -eq 1 ]; then
    ratchet__json "$CLAUSE" "$file" "$line" "error" "$msg"
  else
    printf '::error file=%s,line=%s::%s %s\n' "$file" "$line" "$CLAUSE" "$msg"
  fi
}

finding() { # file line message
  if [ "$GATE_LEVEL" = "enforce" ]; then
    finding_enforce "$1" "$2" "$3"
  else
    ratchet_finding_warn "$CLAUSE" "$1" "$2" "$3"
  fi
}

# Name of the repo being checked: --repo, then GITHUB_REPOSITORY, then origin.
resolve_repo() {
  local name="$1" url
  if [ -n "$name" ]; then printf '%s' "$name"; return 0; fi
  if [ -n "${GITHUB_REPOSITORY:-}" ]; then printf '%s' "${GITHUB_REPOSITORY##*/}"; return 0; fi
  url=$(git remote get-url origin 2>/dev/null) || return 1
  [ -n "$url" ] || return 1
  url=${url%.git}
  printf '%s' "${url##*[/:]}"
}

# Where a path really points once symlinks are followed.
real_path() { # path [depth]
  local p="$1" depth="${2:-0}" d t
  [ "$depth" -lt 20 ] || return 1
  if [ -d "$p" ]; then (cd "$p" && pwd -P); return; fi
  d=$(cd "$(dirname -- "$p")" 2>/dev/null && pwd -P) || return 1
  if [ -L "$p" ]; then
    t=$(readlink -- "$p") || return 1
    case "$t" in
      /*) real_path "$t" $((depth + 1)) ;;
      *) real_path "$d/$t" $((depth + 1)) ;;
    esac
  else
    printf '%s/%s\n' "$d" "$(basename -- "$p")"
  fi
}

# Prints why a declared path is refused and returns 0; returns 1 when it is
# acceptable or simply absent (absence is reported separately).
path_problem() {
  local p="$1" real
  case "$p" in
    '') echo "is empty"; return 0 ;;
    /*) echo "is an absolute path"; return 0 ;;
  esac
  case "/$p/" in */../*) echo "contains '..'"; return 0 ;; esac
  [ -e "$p" ] || [ -L "$p" ] || return 1
  if real=$(real_path "$p"); then
    case "$real/" in "$ROOT_REAL"/*) return 1 ;; esac
  fi
  echo "resolves outside the repository (symlink or otherwise)"
  return 0
}

declared_path() { # slug; prints the first declared path for it
  local e
  for e in "${PAGES[@]+"${PAGES[@]}"}"; do
    if [ "${e%%$'\t'*}" = "$1" ]; then printf '%s' "${e#*$'\t'}"; return 0; fi
  done
  return 1
}

# The repo's .docs-site declaration, read into PAGES, BUILD and OUTPUT.
read_declaration() {
  local line kind rest slug path n=0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    line=${line%$'\r'}
    case "$line" in ''|\#*) continue ;; esac
    kind=${line%%$'\t'*}
    rest=""
    case "$line" in *$'\t'*) rest=${line#*$'\t'} ;; esac
    case "$kind" in
      page)
        slug=${rest%%$'\t'*}
        path=""
        case "$rest" in *$'\t'*) path=${rest#*$'\t'} ;; esac
        PAGES+=("$slug"$'\t'"$path")
        PAGE_LINES+=("$n")
        ;;
      build) BUILD="$rest" ;;
      output) OUTPUT="$rest" ;;
      *) finding "$DECL" "$n" "unknown row '$kind' in $DECL; expected page, build or output" ;;
    esac
  done < "$DECL"
}

check_pages() { # tier
  local tier="$1" slug title path problem i=0 e
  # Every declared path is judged, whether or not the tier asks for it.
  for e in "${PAGES[@]+"${PAGES[@]}"}"; do
    slug=${e%%$'\t'*}
    path=${e#*$'\t'}
    if problem=$(path_problem "$path"); then
      finding "$DECL" "${PAGE_LINES[$i]}" "page '$slug' path '$path' $problem"
    fi
    i=$((i + 1))
  done
  while IFS=$'\t' read -r slug title; do
    [ -n "$slug" ] || continue
    if ! path=$(declared_path "$slug"); then
      finding "$DECL" 1 "the $tier tier requires the page '$slug' ($title), and $DECL does not declare it"
    elif path_problem "$path" >/dev/null; then
      :  # already reported above
    elif [ ! -f "$path" ]; then
      finding "$path" 1 "page '$slug' ($title) is declared but the file does not exist"
    elif ! grep -q '[^[:space:]]' "$path"; then
      finding "$path" 1 "page '$slug' ($title) is empty"
    fi
  done < <(tier_pages "$tier")
}

check_build_and_output() {
  local out tracked count first problem
  if [ -z "$BUILD" ]; then
    finding "$DECL" 1 "no build row: declare the command CI runs to build the site"
  fi
  if [ -z "$OUTPUT" ]; then
    finding "$DECL" 1 "no output row: declare the directory the build writes to"
    return 0
  fi
  out=${OUTPUT#./}
  while [ "${out%/}" != "$out" ]; do out=${out%/}; done
  case "$out" in
    ''|.) finding "$DECL" 1 "output '$OUTPUT' is the repository root; it must be a directory of its own"; return 0 ;;
  esac
  if problem=$(path_problem "$out"); then
    finding "$DECL" 1 "output '$OUTPUT' $problem"
    return 0
  fi
  tracked=$(git ls-files -- ":(literal)$out")
  count=$(printf '%s\n' "$tracked" | grep -c .)
  if [ "$count" -gt 0 ]; then
    first=$(printf '%s\n' "$tracked" | head -n 1)
    finding "$first" 1 "$count tracked file(s) under the output directory '$out'; built HTML is never committed (DOC-3)"
  fi
}

run_declared_build() {
  [ -n "$BUILD" ] || return 0
  if ! bash -c "$BUILD" >&2; then
    finding "$DECL" 1 "the declared build command failed: $BUILD"
  fi
}

main() {
  local repo_arg="" run_build=0 rest=() name row tier mode required problem
  while [ $# -gt 0 ]; do
    case "$1" in
      --repo)
        [ $# -ge 2 ] || { echo "check-docs-site: --repo needs a name" >&2; return 2; }
        repo_arg="$2"; shift 2 ;;
      --run-build) run_build=1; shift ;;
      *) rest+=("$1"); shift ;;
    esac
  done
  # --mode is accepted and ignored: the register's mode governs this gate.
  ratchet_init "${rest[@]+"${rest[@]}"}" || return 2
  register_usable || return 2
  ROOT_REAL=$(cd "$RATCHET_ROOT" && pwd -P) || return 2

  if ! name=$(resolve_repo "$repo_arg"); then
    note "no repository name could be resolved; not checked"
    return 0
  fi
  row=$(register_row "$name")
  if [ -z "$row" ]; then
    note "$name is not on the tier list; not checked"
    return 0
  fi
  tier=${row%%$'\t'*}
  mode=${row#*$'\t'}
  case "$tier" in full|overview|exempt) ;; *) echo "check-docs-site: $name has tier '$tier'; expected full, overview or exempt" >&2; return 2 ;; esac
  case "$mode" in warn|enforce) ;; *) echo "check-docs-site: $name has mode '$mode'; expected warn or enforce" >&2; return 2 ;; esac
  if [ "$tier" = "exempt" ]; then
    note "$name is in the exempt tier; no docs site required"
    return 0
  fi
  required=$(tier_pages "$tier")
  [ -n "$required" ] || { echo "check-docs-site: the tier list requires no pages for the $tier tier; refusing to report a clean run" >&2; return 2; }

  GATE_LEVEL="$mode"
  if [ ! -f "$DECL" ] && [ ! -L "$DECL" ]; then
    finding "$DECL" 1 "no $DECL declaration: the $tier tier needs one naming its pages, build command and output directory"
  elif problem=$(path_problem "$DECL"); then
    finding "$DECL" 1 "$DECL $problem"
  else
    read_declaration
    check_pages "$tier"
    check_build_and_output
    [ "$run_build" -eq 1 ] && run_declared_build
  fi

  if [ "$RATCHET_JSON" -eq 0 ]; then
    printf 'check-docs-site: repo=%s tier=%s mode=%s failures=%d warnings=%d exempt=%d\n' \
      "$name" "$tier" "$mode" "$RATCHET_FAILURES" "$RATCHET_WARNINGS" "$RATCHET_EXEMPTED"
  fi
  [ "$RATCHET_FAILURES" -eq 0 ]
}

PAGES=()
PAGE_LINES=()
BUILD=""
OUTPUT=""
ROOT_REAL=""

# --- self-test -------------------------------------------------------------
SELF="$HERE/check-docs-site.sh"
DOC_FILE="$HERE/../docs/documentation.md"
FIXTURE_SLUGS="overview where-it-fits how-it-works change-to-live running-or-using-it decisions-and-limits reference glossary"

# Output and exit status of one run, in $out and $rc.
run_gate() { out=$(bash "$SELF" "$@" 2>&1); rc=$?; }

fail() { echo "FAIL: $1"; [ -z "${out:-}" ] || printf '%s\n' "$out"; return 1; }

expect_clean() { # label args...
  local label="$1"; shift
  run_gate "$@"
  [ "$rc" -eq 0 ] || { fail "$label: exited $rc"; return 1; }
  case "$out" in *'::warning'*|*'::error'*) fail "$label: reported a finding"; return 1 ;; esac
}

expect_red() { # label needle args...
  local label="$1" needle="$2"; shift 2
  run_gate "$@"
  [ "$rc" -ne 0 ] || { fail "$label: exited 0, expected a failure"; return 1; }
  case "$out" in *'::error'*) ;; *) fail "$label: no ::error:: finding"; return 1 ;; esac
  case "$out" in *"$needle"*) ;; *) fail "$label: output does not name '$needle'"; return 1 ;; esac
}

expect_warn() { # label needle args...
  local label="$1" needle="$2"; shift 2
  run_gate "$@"
  [ "$rc" -eq 0 ] || { fail "$label: exited $rc, a warn-mode repo must never fail"; return 1; }
  case "$out" in *'::warning'*) ;; *) fail "$label: no ::warning:: finding (a silent pass)"; return 1 ;; esac
  case "$out" in *"$needle"*) ;; *) fail "$label: output does not name '$needle'"; return 1 ;; esac
  case "$out" in *'::error'*) fail "$label: a warn-mode repo emitted ::error::"; return 1 ;; esac
}

write_fixture_register() { # file
  local f="$1" s
  {
    for s in $FIXTURE_SLUGS; do
      case "$s" in
        overview) printf 'page\t%s\tTitle %s\tfull,overview\n' "$s" "$s" ;;
        *) printf 'page\t%s\tTitle %s\tfull\n' "$s" "$s" ;;
      esac
    done
    printf 'repo\tfx-full-enforce\tfull\tenforce\t# fixture\n'
    printf 'repo\tfx-full-warn\tfull\twarn\t# fixture\n'
    printf 'repo\tfx-overview-enforce\toverview\tenforce\t# fixture\n'
    printf 'repo\tfx-exempt\texempt\tenforce\t# fixture\n'
  } > "$f"
}

write_fixture_site() { # leaves .docs-site and docs/site/*.md in the working directory
  local s
  mkdir -p docs/site
  : > .docs-site
  for s in $FIXTURE_SLUGS; do
    printf 'page body for %s\n' "$s" > "docs/site/$s.md"
    printf 'page\t%s\tdocs/site/%s.md\n' "$s" "$s" >> .docs-site
  done
  printf 'build\ttrue\noutput\tsite-out\n' >> .docs-site
}

# Invariants of the shipped tier list, so the clause prose and the register
# cannot drift apart unseen.
check_real_register() {
  local reg="$HERE/docs-site-tiers.tsv" dup bad section title n
  TIERS_FILE="$reg"
  [ -f "$reg" ] || { echo "FAIL: no tier list at $reg"; return 1; }
  [ -f "$DOC_FILE" ] || { echo "FAIL: no documentation.md at $DOC_FILE"; return 1; }
  dup=$(awk -F'\t' '/^[ \t]*#/ || NF < 4 { next } $1 == "repo" { print $2 }' "$reg" | sort | uniq -d)
  [ -z "$dup" ] || { echo "FAIL: duplicate repo rows: $dup"; return 1; }
  dup=$(awk -F'\t' '/^[ \t]*#/ || NF < 4 { next } $1 == "page" { print $2 }' "$reg" | sort | uniq -d)
  [ -z "$dup" ] || { echo "FAIL: duplicate page slugs: $dup"; return 1; }
  bad=$(awk -F'\t' '/^[ \t]*#/ || NF < 4 { next } $1 == "repo" && $3 !~ /^(full|overview|exempt)$/ { print $2 ": tier " $3 }' "$reg")
  [ -z "$bad" ] || { echo "FAIL: undefined tier: $bad"; return 1; }
  bad=$(awk -F'\t' '/^[ \t]*#/ || NF < 4 { next } $1 == "repo" && $4 !~ /^(warn|enforce)$/ { print $2 ": mode " $4 }' "$reg")
  [ -z "$bad" ] || { echo "FAIL: mode must be warn or enforce: $bad"; return 1; }
  bad=$(awk -F'\t' '/^[ \t]*#/ || NF < 4 { next } $1 == "page" { n = split($4, a, ","); for (i = 1; i <= n; i++) if (a[i] !~ /^(full|overview)$/) print $2 ": tier " a[i] }' "$reg")
  [ -z "$bad" ] || { echo "FAIL: a page names an undefined tier: $bad"; return 1; }
  bad=$(awk -F'\t' '/^[ \t]*#/ || NF < 4 { next } $1 == "page" && $2 !~ /^[a-z0-9-]+$/ { print $2 }' "$reg")
  [ -z "$bad" ] || { echo "FAIL: a page slug is not lower-case words and hyphens: $bad"; return 1; }
  section=$(sed -n '/^## DOC-11/,$p' "$DOC_FILE")
  [ -n "$section" ] || { echo "FAIL: DOC-11 is not defined in $DOC_FILE"; return 1; }
  while IFS= read -r title; do
    printf '%s\n' "$section" | grep -qF -- "$title" \
      || { echo "FAIL: page title '$title' is in the tier list but not in DOC-11's prose"; return 1; }
  done < <(awk -F'\t' '/^[ \t]*#/ || NF < 4 { next } $1 == "page" { print $3 }' "$reg")
  n=$(tier_pages full | grep -c .)
  [ "$n" -eq 8 ] || { echo "FAIL: the full tier lists $n pages; DOC-11 says eight"; return 1; }
  printf '%s\n' "$section" | grep -qF 'tools/docs-site-tiers.tsv' \
    || { echo "FAIL: DOC-11 does not cite tools/docs-site-tiers.tsv"; return 1; }
}

self_test() {
  local tmp rc=0
  tmp=$(mktemp -d) || return 2
  (
    cd "$tmp" || exit 2
    ratchet_scratch_repo_init || exit 2
    fixture_register="$tmp.register.tsv"
    write_fixture_register "$fixture_register"
    export DOCS_SITE_TIERS_FILE="$fixture_register"
    unset GITHUB_REPOSITORY

    write_fixture_site
    git add -A && git commit -qm site

    expect_clean "GREEN: an enforce full-tier repo with all eight pages" --repo fx-full-enforce || exit 1

    # RED, then restore and GREEN again, one defect at a time.
    rm docs/site/glossary.md
    expect_red "RED: a declared page is missing" glossary --repo fx-full-enforce || exit 1
    git checkout -q -- docs/site/glossary.md
    expect_clean "GREEN: the missing page restored" --repo fx-full-enforce || exit 1

    : > docs/site/how-it-works.md
    expect_red "RED: an empty page" how-it-works --repo fx-full-enforce || exit 1
    printf '   \n\n' > docs/site/how-it-works.md
    expect_red "RED: a whitespace-only page" how-it-works --repo fx-full-enforce || exit 1
    git checkout -q -- docs/site/how-it-works.md

    grep -v 'glossary' .docs-site > .docs-site.new && mv .docs-site.new .docs-site
    expect_red "RED: a required page that is not declared" glossary --repo fx-full-enforce || exit 1
    git checkout -q -- .docs-site

    grep -v '^build' .docs-site > .docs-site.new && mv .docs-site.new .docs-site
    expect_red "RED: no build row" build --repo fx-full-enforce || exit 1
    git checkout -q -- .docs-site

    grep -v '^output' .docs-site > .docs-site.new && mv .docs-site.new .docs-site
    expect_red "RED: no output row" output --repo fx-full-enforce || exit 1
    git checkout -q -- .docs-site

    mkdir site-out && echo '<html></html>' > site-out/index.html && git add -f site-out/index.html
    expect_red "RED: a built file is tracked under the output directory" site-out --repo fx-full-enforce || exit 1
    git rm -q --cached site-out/index.html && rm -rf site-out
    expect_clean "GREEN: the tracked output file removed" --repo fx-full-enforce || exit 1

    sed 's|docs/site/glossary.md|../escape.md|' .docs-site > .docs-site.new && mv .docs-site.new .docs-site
    expect_red "RED: a page path with .." "'..'" --repo fx-full-enforce || exit 1
    git checkout -q -- .docs-site
    sed 's|docs/site/glossary.md|/etc/hosts|' .docs-site > .docs-site.new && mv .docs-site.new .docs-site
    expect_red "RED: an absolute page path" "absolute" --repo fx-full-enforce || exit 1
    git checkout -q -- .docs-site
    rm docs/site/glossary.md && ln -s /etc/hosts docs/site/glossary.md
    expect_red "RED: a page that is a symlink out of the tree" "outside the repository" --repo fx-full-enforce || exit 1
    rm docs/site/glossary.md && ln -s overview.md docs/site/glossary.md
    expect_clean "GREEN: a page that is a symlink inside the tree" --repo fx-full-enforce || exit 1
    rm docs/site/glossary.md && git checkout -q -- docs/site/glossary.md

    # The register governs the level, not the caller's mode. A consumer that
    # sets enforce must not turn a warn repo red, and one that sets warn must
    # not soften an enforce repo.
    rm docs/site/glossary.md
    expect_red "RED: enforce repo with --mode warn still fails" glossary --repo fx-full-enforce --mode warn || exit 1
    printf 'warn\n' > .standards.mode
    expect_red "RED: enforce repo with .standards.mode warn still fails" glossary --repo fx-full-enforce || exit 1
    rm .standards.mode
    git checkout -q -- docs/site/glossary.md

    # WARN never reddens, and a control case proves warnings are emitted at all.
    rm -rf docs .docs-site && git rm -q -r --cached . >/dev/null 2>&1
    expect_warn "WARN: no declaration" "no .docs-site" --repo fx-full-warn || exit 1
    expect_warn "WARN: no declaration, --mode enforce" "no .docs-site" --repo fx-full-warn --mode enforce || exit 1
    expect_warn "WARN: no declaration, --mode warn" "no .docs-site" --repo fx-full-warn --mode warn || exit 1
    expect_red "RED: the same tree under an enforce repo" "no .docs-site" --repo fx-full-enforce || exit 1
    write_fixture_site
    sed 's|^build.*|build\tfalse|' .docs-site > .docs-site.new && mv .docs-site.new .docs-site
    expect_clean "GREEN: a failing build is not run without --run-build" --repo fx-full-warn || exit 1
    expect_warn "WARN: a failing build under --run-build" "build command failed" --repo fx-full-warn --run-build || exit 1
    expect_warn "WARN: a failing build under --run-build --mode enforce" "build command failed" --repo fx-full-warn --run-build --mode enforce || exit 1
    expect_red "RED: a failing build under --run-build in an enforce repo" "build command failed" --repo fx-full-enforce --run-build || exit 1
    sed 's|^build.*|build\ttrue|' .docs-site > .docs-site.new && mv .docs-site.new .docs-site
    expect_clean "GREEN: a passing build under --run-build" --repo fx-full-enforce --run-build || exit 1

    # An overview-tier repo needs only the overview page.
    grep -v -e glossary -e reference .docs-site > .docs-site.new && mv .docs-site.new .docs-site
    expect_clean "GREEN: an overview-tier repo with only the overview page" --repo fx-overview-enforce || exit 1
    expect_red "RED: the same declaration under the full tier" glossary --repo fx-full-enforce || exit 1

    # Repo name resolution, and repos the gate must leave alone.
    expect_clean "GREEN: an unlisted repo is not checked" --repo fx-unlisted || exit 1
    expect_clean "GREEN: an exempt repo is not checked" --repo fx-exempt || exit 1
    expect_clean "GREEN: no resolvable repo name is not checked" || exit 1
    GITHUB_REPOSITORY=org/fx-full-enforce expect_red "RED: the name is read from GITHUB_REPOSITORY" glossary || exit 1
    git remote add origin https://example.invalid/org/fx-full-enforce.git
    expect_red "RED: the name is read from the origin remote" glossary || exit 1

    # An empty or missing tier list is never a clean scan.
    DOCS_SITE_TIERS_FILE="$tmp.none.tsv" run_gate --repo fx-full-enforce
    [ "$rc" -eq 2 ] || { fail "a missing tier list exited $rc, expected 2"; exit 1; }
    : > "$tmp.empty.tsv"
    DOCS_SITE_TIERS_FILE="$tmp.empty.tsv" run_gate --repo fx-full-enforce
    [ "$rc" -eq 2 ] || { fail "an empty tier list exited $rc, expected 2"; exit 1; }
    printf '# comments only\n' > "$tmp.empty.tsv"
    DOCS_SITE_TIERS_FILE="$tmp.empty.tsv" run_gate --repo fx-full-enforce
    [ "$rc" -eq 2 ] || { fail "a comments-only tier list exited $rc, expected 2"; exit 1; }
    grep -v '^repo' "$fixture_register" > "$tmp.empty.tsv"
    DOCS_SITE_TIERS_FILE="$tmp.empty.tsv" run_gate --repo fx-full-enforce
    [ "$rc" -eq 2 ] || { fail "a tier list with no repo rows exited $rc, expected 2"; exit 1; }
    grep -v '^page' "$fixture_register" > "$tmp.empty.tsv"
    DOCS_SITE_TIERS_FILE="$tmp.empty.tsv" run_gate --repo fx-full-enforce
    [ "$rc" -eq 2 ] || { fail "a tier list with no page rows exited $rc, expected 2"; exit 1; }
    sed 's|fx-full-enforce\tfull\tenforce|fx-full-enforce\tfull\tmaybe|' "$fixture_register" > "$tmp.empty.tsv"
    DOCS_SITE_TIERS_FILE="$tmp.empty.tsv" run_gate --repo fx-full-enforce
    [ "$rc" -eq 2 ] || { fail "an undefined mode exited $rc, expected 2"; exit 1; }
    rm -f "$tmp.empty.tsv"

    # The shipped tier list: invariants, then every row run in an empty repo.
    unset DOCS_SITE_TIERS_FILE
    check_real_register || exit 1
    rm -rf docs .docs-site
    local repo row_tier row_mode
    while IFS=$'\t' read -r repo row_tier row_mode; do
      [ -n "$repo" ] || continue
      if [ "$row_mode" = "warn" ]; then
        if [ "$row_tier" = "exempt" ]; then
          expect_clean "REAL REGISTER: $repo (exempt)" --repo "$repo" || exit 1
        else
          expect_warn "REAL REGISTER: $repo ($row_tier, warn)" "no .docs-site" --repo "$repo" || exit 1
        fi
      fi
    done < <(awk -F'\t' '/^[ \t]*#/ || NF < 4 { next } $1 == "repo" { print $2 "\t" $3 "\t" $4 }' "$HERE/docs-site-tiers.tsv")
    exit 0
  ) || rc=$?
  rm -rf "$tmp" "$tmp.register.tsv" "$tmp.none.tsv" "$tmp.empty.tsv"
  [ "$rc" -eq 0 ] && echo "check-docs-site.sh: self-test passed"
  return "$rc"
}

case "${1:-}" in
  --self-test) self_test; exit $? ;;
  *) main "$@"; exit $? ;;
esac
