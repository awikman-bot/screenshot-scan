#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Decides whether a pull request passes the "Outside PR reviewed" check.
# Called by .github/workflows/outside-pr-gate.yml; see AGENTS.md, "Pull
# requests from outside".
#
# Input (environment), all from the pull_request_target event:
#   ACTION       opened | reopened | synchronize | labeled | unlabeled
#   ASSOCIATION  the author's relation to the repo (OWNER, COLLABORATOR, NONE…)
#   AUTHOR       the author's login
#   EVENT_LABEL  the label that was just added or removed ('' for other actions)
#   GATE_LABEL   the label that means "a maintainer read these commits"
#
# Exit 0 = pass, 1 = fail. Prints the reason.
#
# Rule: a pull request from someone who cannot push to this repo passes only
# in the run that a maintainer starts by ADDING the label. That run belongs
# to the commits that exist at that moment. Every later event (a new push, a
# reopen, any other label change) fails again, so the label can never cover
# commits that the maintainer did not see. To approve again: remove the
# label, read the new commits, add the label.

set -euo pipefail

: "${ACTION:?}" "${ASSOCIATION:?}" "${AUTHOR:?}" "${GATE_LABEL:?}"
EVENT_LABEL=${EVENT_LABEL:-}

# People who can push to the repo anyway. GitHub sets this value, the author
# cannot. Outside contributors are CONTRIBUTOR, FIRST_TIME_CONTRIBUTOR, NONE…
case "$ASSOCIATION" in
    OWNER|MEMBER|COLLABORATOR)
        echo "PASS: $AUTHOR can push to this repository ($ASSOCIATION)."
        exit 0
        ;;
esac

# Dependabot's own app; "[bot]" logins cannot be registered by users.
if [[ "$AUTHOR" == "dependabot[bot]" ]]; then
    echo "PASS: Dependabot update."
    exit 0
fi

if [[ "$ACTION" == "labeled" && "$EVENT_LABEL" == "$GATE_LABEL" ]]; then
    echo "PASS: a maintainer added '$GATE_LABEL' to these commits."
    exit 0
fi

echo "FAIL: $AUTHOR cannot push to this repository ($ASSOCIATION), and no maintainer"
echo "has marked the current commits as read."
echo "Maintainers: read the whole diff, then add the label '$GATE_LABEL'"
echo "(remove it first if it is already there). Do this again after every new push."
exit 1
