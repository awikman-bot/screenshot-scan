#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Tests the decision in .github/scripts/outside-pr-gate.sh (the "Outside PR
# reviewed" check). No network, no GitHub.
#
#   tests/outside-pr-gate.test.sh        (or: make test)

set -euo pipefail
ROOT=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
GATE="$ROOT/.github/scripts/outside-pr-gate.sh"
LABEL=maintainer-reviewed
passed=0
failed=0

# expect <pass|fail> <description> <action> <association> <author> [event label]
expect() {
    local want=$1 name=$2 got=pass
    ACTION=$3 ASSOCIATION=$4 AUTHOR=$5 EVENT_LABEL=${6:-} GATE_LABEL=$LABEL \
        "$GATE" >/dev/null 2>&1 || got=fail
    if [[ "$got" == "$want" ]]; then
        echo "ok   $name"
        passed=$((passed + 1))
    else
        echo "FAIL $name (expected $want, got $got)"
        failed=$((failed + 1))
    fi
}

# People who can push anyway
expect pass "owner: opened"                opened      OWNER        awikman-bot
expect pass "collaborator: new push"       synchronize COLLABORATOR someone
expect pass "member: opened"               opened      MEMBER       someone
expect pass "dependabot: opened"           opened      NONE         'dependabot[bot]'

# Outside authors: fail until a maintainer adds the label
expect fail "outside: opened"              opened      NONE                   stranger
expect fail "first-timer: opened"          opened      FIRST_TIME_CONTRIBUTOR stranger
expect fail "past contributor: opened"     opened      CONTRIBUTOR            stranger
expect pass "outside: label added"         labeled     NONE                   stranger "$LABEL"
expect pass "contributor: label added"     labeled     CONTRIBUTOR            stranger "$LABEL"

# …and fail again on anything after that
expect fail "outside: new push"            synchronize NONE stranger
expect fail "outside: reopened"            reopened    NONE stranger
expect fail "outside: label removed"       unlabeled   NONE stranger "$LABEL"
expect fail "outside: other label added"   labeled     NONE stranger bug
expect fail "outside: other label removed" unlabeled   NONE stranger bug
expect fail "outside: label name is a prefix" labeled  NONE stranger "$LABEL-not"

# Things an author controls must not help
expect fail "login looks like dependabot"  opened      NONE dependabot
expect fail "login looks like the owner"   opened      NONE OWNER
expect fail "unknown association"          opened      SOMETHING_NEW stranger
expect fail "missing association"          opened      ''   stranger

echo
echo "$passed passed, $failed failed"
[[ $failed -eq 0 ]]
