# The spending budget

A user can set a ceiling on what completions may cost and see what is left of
it in the window chrome. This is the reasoning behind how that is built, and an
honest account of the half of it that cannot work yet.

Conventions every endpoint shares live in
[`api-conventions.md`](api-conventions.md).

## What works, and what has nothing to count

The budget is real: it is stored, it has periods, and the spend against it is
summed from `usage_events.cost_usd` with the query it will always use.

**Nothing writes those events.** `InferenceService` is an empty class and
`/api/v1/analytics` is an empty controller, so no completion can be made and
no cost can be recorded. Every installation reads zero, and will until
inference ships.

That is not a reason to leave the feature out, but it is a reason not to let
the UI imply a measurement. A budget showing "$20.00 of $20.00 left" forever
is indistinguishable from one that is working and unused. So the API reports
`callCount` — how many events in this period carry a cost — and the screen
says, in words, that the usage log has no writer yet. That is the same rule the
rest of this UI follows: see "What the UI does *not* invent" in
[`apps/web/README.md`](../apps/web/README.md).

`callCount` is also the right question afterwards. Once completions run, zero
stops meaning "impossible" and starts meaning "you have not used it this
period", and the sentence beside it changes while the field does not.

## Shape: another singleton

```
/api/v1/budget
```

Singular, no id, no list, no `POST` and no `DELETE` — the convention the user
profile established. One installation, one budget.

`GET /budget` returns the budget **and** the spend against it. They are one
response because the window the spend is summed over is a property of the
budget: split into two endpoints, a client would have to derive period
boundaries itself, in the browser's time zone rather than the profile's, and
would disagree with the server about which month it is.

| Method  | Path              | Notes |
| ------- | ----------------- | ----- |
| `GET`   | `/api/v1/budget`  | Always succeeds. Provisions the row on first read, with no limit. |
| `PATCH` | `/api/v1/budget`  | `limitUsd: null` removes the budget; spending stays reported. |

## The table

```sql
CREATE TABLE spend_budget (
    id           TEXT PRIMARY KEY,
    singleton    INTEGER NOT NULL DEFAULT 1 CHECK (singleton = 1) UNIQUE,
    limit_usd    REAL,                     -- NULL: no budget set
    period       TEXT NOT NULL DEFAULT 'monthly'
                 CHECK (period IN ('daily', 'weekly', 'monthly')),
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
```

`NULL` is how "no budget" is stored, rather than a limit plus an `enabled`
flag that can contradict it. One representation of absent.

`limit_usd` is `REAL` because `usage_events.cost_usd` is. Floating-point money
is normally a mistake, and this is the exception that proves it: the costs
being summed are already `REAL`, so storing the limit as integer cents would
move the conversion rather than remove it, and introduce a rounding boundary
where today there is none. What the API does instead is round every amount it
reports to whole micro-dollars — finer than any single call costs, coarse
enough that `0.30000000000000004` never reaches a client.

## Periods are anchored to the user's midnight

`period-window.ts` turns a period and an instant into a half-open window,
`[start, end)`, in the time zone on the user profile. Half-open so that an
event at the exact instant a period rolls over belongs to the new period and
to exactly one of them.

The time zone matters more than it looks. For a monthly budget, resetting at
01:00 local instead of 00:00 is a detail nobody would notice. For a daily one
it is the difference between the allowance renewing when the user wakes up and
renewing in the middle of their afternoon. This is the first thing in the
application to use `user_profile.timezone`, and the reason that field exists.

The arithmetic avoids a date library:

1. Find the civil date the instant falls on in the zone, via
   `Intl.DateTimeFormat`.
2. Do calendar maths on that civil date — a day back, a week back to Monday,
   the first of the month — with `Date.UTC`, so month lengths and leap years
   are the platform's problem.
3. Convert the civil midnight back to an instant by solving for the offset: the
   offset to apply depends on the instant being computed, so the first pass
   guesses with the offset at the equivalent UTC time and the second corrects
   it with the offset actually in force at the candidate.

Step 3 is what makes a month containing a daylight-saving change come out with
both ends at local midnight rather than one of them an hour out, and the week
containing one 167 hours long. In a zone whose clocks jump at midnight, that
local midnight does not exist and the result is the first instant of the day
that does — the sensible reading of "when the day starts", and better than
refusing to answer.

A missing or unresolvable zone falls back to UTC. The profile validates the
zone on the way in, so this only happens to a hand-edited database, and
reporting the wrong day is a better failure than refusing to report spend.

## What is counted

```sql
SELECT COALESCE(SUM(cost_usd), 0) AS spent,
       COUNT(cost_usd)            AS calls
  FROM usage_events
 WHERE occurred_at >= ? AND occurred_at < ?
```

`usage_events` is an activity log rather than a cost log — its `event_type`
also covers things like an agent being created — so the count is of events
that carry a cost, not of rows. Otherwise an installation that had only ever
created an agent would report calls it never made.

## Going over is reported, not hidden

`remainingUsd` goes negative and `usedFraction` goes above 1. Neither is
clamped: passing the budget is the single most important thing this endpoint
can say, and clamping would make it look like landing exactly on the limit.

The ring in the chrome *is* clamped, because a ring cannot draw 125%. It fills
completely and the colour and the figure carry the overage — the deck switches
from "$15.88" to "+$2.52" at that point, because "−$2.50 left" is a sentence
nobody parses at a glance.

## Nothing is enforced

The budget reports; it does not block. There is nothing to block — no code
path spends money. When inference lands it should call into `BudgetService`
before a completion and decide what to do at the limit, and that decision
(warn, block, ask) deserves its own thought rather than being guessed at now.
A `stopAtLimit` flag added today would be a setting that does nothing, which is
worse than an absent one.

## One currency

Amounts are US dollars because `usage_events.cost_usd` is. There is no currency
field: offering one would promise a conversion that a local-first application
cannot perform offline, and a budget quietly converted at a stale rate is worse
than one stated in the currency the provider actually bills in. The locale on
the user profile decides how the number is punctuated, which is the part that
should follow the person.

## Frontend

- `core/api/budget.models.ts` and `core/api/budget.service.ts`.
- `core/workspace/spend.service.ts` holds the budget in a signal, loaded once
  by the shell, and owns the thresholds: `within`, `warning` from four fifths
  of the budget, `over` from the limit itself. It is refreshed on demand rather
  than polled — nothing in this application spends money on its own, so the
  number cannot change without a request this app made.
- `features/chrome/spend-meter/` is the deck's ring. **It renders nothing until
  a limit is set.** The deck is on every screen, and a meter reading "no limit"
  forever would be a permanent reminder of a feature the user declined.
- `features/budget/` is the screen: the figures for the period, the limit and
  the period itself, and the notice about the usage log having no writer.
- The workspace panel carries a tile spanning its grid, so the budget is
  discoverable before one exists — it reads "set a budget" rather than
  "no limit", because the panel is where someone goes looking for what the
  workspace can do.
