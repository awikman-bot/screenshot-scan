#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Tests .github/scripts/commit-on-branch.sh (the "release only from main"
# check) against a small throwaway git repository. No network.
#
#   tests/commit-on-branch.test.sh        (or: make test)

set -euo pipefail
ROOT=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
CHECK="$ROOT/.github/scripts/commit-on-branch.sh"
WORK=$(mktemp -d)
trap 'rm -rf -- "$WORK"' EXIT
passed=0
failed=0

# A repo that ignores the user's and the system's git settings.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
cd "$WORK"
git init -q -b main .
commit() { git commit -q --allow-empty -m "$1"; }

#   main:    A --- B --- C
#                   \
#   feature:         D        (never merged)
commit A
commit B
git tag v-old                       # lightweight tag on an older main commit
git switch -q -c feature
commit D
git tag v-unmerged                  # lightweight tag on unmerged work
git tag -a -m "annotated" v-unmerged-annotated
git switch -q main
commit C
git tag v-tip
git tag -a -m "annotated" v-tip-annotated

# expect <pass|fail> <description> <args for the check…>
expect() {
    local want=$1 name=$2 got=pass
    shift 2
    "$CHECK" "$@" >/dev/null 2>&1 || got=fail
    if [[ "$got" == "$want" ]]; then
        echo "ok   $name"
        passed=$((passed + 1))
    else
        echo "FAIL $name (expected $want, got $got)"
        failed=$((failed + 1))
    fi
}

expect pass "tip of main"                       "$(git rev-parse main)" main
expect pass "older commit on main"              "$(git rev-parse v-old)" main
expect pass "tag on the tip of main"            v-tip main
expect pass "annotated tag on main"             v-tip-annotated main
expect fail "commit on an unmerged branch"      "$(git rev-parse feature)" main
expect fail "tag on an unmerged branch"         v-unmerged main
expect fail "annotated tag on an unmerged branch" v-unmerged-annotated main
expect fail "commit that does not exist"        0123456789012345678901234567890123456789 main
expect fail "branch that does not exist"        "$(git rev-parse main)" no-such-branch
expect fail "empty commit name"                 "" main
expect fail "no arguments"

# After a merge, the same commit is accepted.
git merge -q --no-ff -m "merge feature" feature
expect pass "the branch commit, once merged"    v-unmerged main

echo
echo "$passed passed, $failed failed"
[[ $failed -eq 0 ]]
