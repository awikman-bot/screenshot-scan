#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Checks that a commit is part of a branch's history.
#
#   commit-on-branch.sh <commit> <branch ref>     e.g. "$GITHUB_SHA" origin/main
#
# Exit 0 if <commit> is the tip of the branch or an older commit on it,
# 1 if not (or if either name cannot be found). Run inside a git checkout
# that has the full history of the branch.
#
# Used by .github/workflows/release.yml so that a release can only be built
# from code that was merged to main. Tested by tests/commit-on-branch.test.sh.

set -euo pipefail

if [[ $# -ne 2 || -z "$1" || -z "$2" ]]; then
    echo "usage: $0 <commit> <branch ref>" >&2
    exit 1
fi

# "^{commit}" turns an annotated tag into the commit it points at, and fails
# for anything that is not a commit.
if ! commit=$(git rev-parse --verify --quiet "$1^{commit}"); then
    echo "FAIL: '$1' is not a commit in this checkout." >&2
    exit 1
fi
if ! branch=$(git rev-parse --verify --quiet "$2^{commit}"); then
    echo "FAIL: branch '$2' was not found in this checkout." >&2
    exit 1
fi

if git merge-base --is-ancestor "$commit" "$branch"; then
    echo "OK: commit $commit is on $2."
else
    echo "FAIL: commit $commit is not on $2." >&2
    exit 1
fi
