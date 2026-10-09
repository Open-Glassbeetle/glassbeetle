<!--
Thanks for opening this. Nothing below is a hurdle — it is just the context
that makes a review quick. Delete any section that does not apply, and open
the PR as a draft if you want feedback before it is finished.
-->

## What changed

<!-- One or two sentences. What does the code do now that it did not before? -->

## Why

<!-- The issue, the bug, or the reason. "Closes #42" is enough if the issue says it. -->

Closes #

## How it was tested

<!--
What you ran, and anything you checked by hand. If you could not test
something, say so here — that is useful, not disqualifying.
-->

## Anything left out, or worth a second opinion

<!--
Acceptance criteria you did not get to, decisions you were unsure about,
conventions you had to guess at. Naming them makes this easier to merge,
not harder.
-->

## Checklist

- [ ] `npm run lint -w @glassbeetle/api` passes (API changes)
- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] Tests cover the change — integration tests for a new endpoint, a failing-first test for a bug fix
- [ ] Docs updated if behaviour or a convention changed (`docs/`, `README.md`, `apps/web/README.md`)
- [ ] The linked issue's acceptance criteria are met, or the gaps are named above

<!--
New to the repository? Your first PR waits for a maintainer to approve the CI
run. That is a GitHub default for first-time contributors, not a judgement on
your change.
-->
