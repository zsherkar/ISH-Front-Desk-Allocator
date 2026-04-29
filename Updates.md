# Updates

This file is the running handoff log for allocation-engine work. Each pass should
add a new timestamped entry at the top or bottom, with enough detail that another
model or engineer can understand what changed, what was verified, and what still
needs attention.

## 2026-04-29 00:30:40 -04:00 - No-Availability AFP Placeholder, Dry-Run Audit, and XLSX Test Pass

### Repository Context

- Working checkout: `D:\Building\ISH-Front-Desk-Allocator-render`
- Branch: `render-monthly-hosting`
- Base commit for this pass: `139adde Tighten availability and fairness allocation`
- This pass did not touch survey responses or response tables.
- No destructive database/table changes were made.
- No new DB migration was added in this pass. Placeholder source is inferred from
  saved allocation rows when a zero-availability shift is assigned to an AFP.

### Main Change

The previous pass made availability mandatory for every assignment. This pass
restores the needed administrative exception, but keeps it narrow:

```text
If availabilityCount > 0:
  assigned respondent must have selected the shift.

If availabilityCount === 0:
  admin may explicitly enable no-availability AFP placeholders.
  only selected AFP placeholder recipients may receive the shift.
```

This keeps ordinary assignments strict while allowing impossible no-availability
shifts to be visibly parked with AFPs as operational placeholders.

### Assignment Source

Added the preferred explicit source:

```text
admin_no_availability_afp_placeholder
```

The legacy source remains recognized for compatibility:

```text
engine_no_availability_afp_fallback
```

Dashboard/export wording should treat both as:

```text
No-availability AFP placeholder
```

### Engine Changes

Updated:

- `artifacts/api-server/src/lib/allocationCore.ts`
- `artifacts/api-server/src/lib/allocationEngine.ts`

The central validator now allows an unavailable assignment only when all are true:

1. assignment source is the no-availability AFP placeholder source
2. `availabilityCount === 0`
3. respondent category is `AFP`
4. placeholder mode is enabled for the run
5. respondent is in the selected fallback AFP list

Normal assignments still require selected availability:

- `engine_normal`
- `engine_back_to_back_emergency`
- `engine_afp_cap_overflow_available`
- `manual`

No-availability placeholder assignment now runs after:

1. normal coverage
2. blank repair
3. fairness repair

Placeholder auto-distribution is deterministic:

1. lowest no-availability placeholder minutes
2. lowest total assigned minutes
3. same-day-safe pattern preferred
4. stable respondent name/id tie-break

Default same-day behavior remains safe:

- no non-adjacent double
- no triple shift day
- adjacent double allowed

Extreme stacking was not enabled in UI. The validator contains the warning code
path, but normal placeholder mode still respects same-day max/adjacency rules.

### Validator and Stats Changes

Stats now distinguish intentional placeholders from illegal unavailable
assignments.

Expected invariant:

```text
illegalAssignmentsWithoutAvailability = 0
```

New or updated stats include:

- `allowedNoAvailabilityAfpPlaceholderAssignments`
- `illegalAssignmentsWithoutAvailability`
- `noAvailabilityAfpPlaceholderCount`
- `noAvailabilityShiftsStillBlank`
- `afpNoAvailabilityPlaceholderHours`
- per-respondent `noAvailabilityPlaceholderHours`
- per-respondent `normalHours`
- per-respondent `afpCapOverflowHours`
- per-respondent `manualHours`

AFP placeholder hours are shown separately from normal AFP cap hours. Placeholder
hours may exceed AFP cap but do not count as normal cap violations.

### API and Schema Changes

Updated:

- `lib/api-spec/openapi.yaml`
- generated React client
- generated zod schemas/types

Run allocation body now supports:

```ts
allowNoAvailabilityAfpPlaceholders?: boolean;
noAvailabilityFallbackAfpIds?: number[];
```

`afpUnclaimedShiftRespondentIds` remains as a deprecated alias.

Manual adjustment body now supports:

```ts
noAvailabilityAfpPlaceholder?: boolean;
```

This is the special mode for assigning zero-availability AFP placeholders. Normal
manual assignment still requires selected availability.

Added safe dry-run endpoint:

```text
POST /api/surveys/{id}/allocations/dry-run
```

The dry-run does not delete, replace, or mutate:

- responses
- respondents
- survey settings
- existing allocations

It returns summary diagnostics:

- total shifts
- assigned shifts
- blank shifts
- blank with availability
- blank zero availability
- allowed no-availability AFP placeholders
- illegal assignments without availability
- non-AFP non-penalized mean/stddev/range
- fairness repair moves
- high-SD reason codes
- back-to-back emergency count
- AFP cap overflow count
- placeholder assignment count

### Admin UI Changes

Updated:

- `artifacts/shift-scheduler/src/pages/admin/surveys/[id].tsx`
- `artifacts/shift-scheduler/src/hooks/use-allocations.ts`

Admin allocation UI now has:

- toggle: enable no-availability AFP emergency placeholders
- AFP checkbox list for selected placeholder recipients
- dry-run audit button
- dry-run summary panel
- re-run settings for existing allocations

Manual adjustment UI now has a separate AFP-only mode:

```text
Assign zero-availability AFP placeholder
```

The backend still enforces the rule, so a non-AFP or a shift with existing
availability cannot use placeholder mode.

Dashboard now shows:

- illegal unavailable assignments
- allowed AFP placeholders
- placeholder hours
- no-availability blanks still blank

### XLSX Export Changes

Added:

- `artifacts/shift-scheduler/src/lib/calendarXlsx.ts`
- `artifacts/shift-scheduler/src/lib/calendarXlsx.test.ts`

The calendar XLSX builder is now a testable utility.

Calendar sheet behavior:

- normal assignment cells show the assigned name
- no-availability AFP placeholder cells show `Name*`
- legend says: `* No one submitted availability; AFP assigned as emergency placeholder.`
- placeholder cells get an Excel note/comment when supported
- cells remain editable plain values
- workbook is not protected

Supporting sheets include:

- `Schedule List`
- `Person Summary`
- `Blank Shifts`
- `Fairness Stats`
- `Allocation Audit`
- `AFP Analysis`

### Tests Added or Updated

API allocation tests now cover:

- placeholder off by default leaves no-availability shifts blank
- placeholder enabled assigns zero-availability shift to selected AFP
- non-AFP cannot receive no-availability placeholder
- placeholder cannot be used when anyone selected the shift
- placeholder may exceed AFP cap without becoming a normal cap violation
- placeholder respects same-day rules by default
- ordinary unavailable assignment remains illegal
- previous strike/fairness/same-day tests remain passing

Frontend workbook test now verifies:

- Calendar sheet exists and is first
- title exists
- week/weekday/weekend labels exist
- assignment names appear
- placeholder name has marker
- legend exists
- supporting sheets exist
- workbook is not protected
- supporting sheet includes placeholder source

### Validation Commands

Commands run:

```powershell
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
git diff --check
```

Results:

- `pnpm run typecheck`: passed
- `pnpm run test`: passed
  - API allocation tests: 35 passed
  - XLSX workbook tests: 1 passed
- `pnpm run build`: passed
- `git diff --check`: passed, with line-ending warnings only

Build warnings:

- Existing Vite sourcemap warnings for UI components.
- Existing chunk-size warning remains, with ExcelJS contributing to bundle size.

### Current Known Limitations

1. Fairness repair is still local search.
   - This pass did not implement depth-3/depth-4 augmenting chains or MILP/ILP.

2. Fairness repair move count is still process-memory based for saved runs.
   - Stats can recompute fairness metrics after restart.
   - Exact repair move count still depends on latest in-memory run diagnostics.

3. Placeholder settings are not persisted as a separate allocation run record.
   - Saved allocations can still infer placeholder source when a zero-availability
     shift is assigned to AFP.
   - The exact selected fallback AFP list is available in the dry-run/run request,
     but not persisted independently.

4. Dry-run audit is implemented as an API/UI workflow, but a real May-data dry-run
   was not executed in this local pass.

5. Render auto deploy remains disabled in `render.yaml`.
   - Manual Render deploy is still required after pushing unless auto deploy is
     re-enabled intentionally.

### Next Recommended Pass

1. Manually deploy the branch to Render.
2. Use dry-run audit on the real May survey.
3. Record:
   - illegal assignments without availability
   - allowed no-availability AFP placeholders
   - blank zero-availability shifts
   - blank shifts with availability
   - non-AFP non-penalized mean/stddev/range
   - fairness repair moves
4. If standard deviation is still high, implement depth-3/depth-4 augmenting-chain
   fairness repair.
5. Consider a small additive allocation-run diagnostics table if repair move count
   and run settings must survive server restarts exactly.

## 2026-04-28 23:50:07 -04:00 - Allocation Math, Availability, Fairness, Audit, and XLSX Export Pass

### Repository Context

- Working checkout: `D:\Building\ISH-Front-Desk-Allocator-render`
- Branch: `render-monthly-hosting`
- Latest pushed commit at time of this note: `139adde Tighten availability and fairness allocation`
- Related recent commits:
  - `139adde Tighten availability and fairness allocation`
  - `7c9b862 Fix coverage-first allocation audit`
  - `e5f2f9c Harden allocation engine math and stats`
  - `5fdc9b0 Refine penalty math and allocation fallbacks`
  - `357cf31 Fix respondent names and allocation rules`
- Important deployment note: `render.yaml` currently has auto deploy disabled, so pushed code does not necessarily appear on the Render URL until a manual deploy is triggered or auto deploy is re-enabled.

### High-Level Summary

This pass moved the allocator closer to a deterministic, explainable scheduling
engine rather than a loose greedy assignment script. The main changes were:

- Preferred-name and respondent mapping issues were addressed so allocations use
  the intended display names instead of accidentally surfacing emails.
- Strike penalty math was moved into a central target solver using minutes
  internally.
- AFP respondents were separated from non-AFP fairness math.
- Allocation audit and blank-shift explanations were added so blanks can be
  diagnosed instead of silently accepted.
- Same-day rules were centralized through a shared validator.
- A hard availability rule was added: no engine assignment, fallback assignment,
  or in-app manual assignment may assign a person to a shift they did not select.
- The no-availability AFP fallback behavior was disabled by the hard availability
  rule. If no one selected a shift, the shift now remains blank and is explained.
- A post-coverage fairness repair pass was added to reduce spread among non-AFPs
  after coverage is already maximized.
- Dashboard stats now expose fairness, penalty, AFP, blank-shift, and validation
  diagnostics.
- A calendar-style editable XLSX export was added using ExcelJS.

### Files and Areas Changed

Core engine and math:

- `artifacts/api-server/src/lib/allocationCore.ts`
  - Central assignment validation.
  - Same-day validation.
  - Availability enforcement.
  - Strike target solver.
- `artifacts/api-server/src/lib/allocationEngine.ts`
  - Coverage-first engine behavior.
  - Stable shift keys.
  - Scarcity-aware assignment.
  - Blank repair.
  - Fairness repair.
  - Fairness diagnostics output.
- `artifacts/api-server/src/lib/allocationCore.test.ts`
  - Penalty target math tests.
  - Shared validator tests.
- `artifacts/api-server/src/lib/allocationEngine.test.ts`
  - Regression tests for no unavailable assignment, no AFP no-availability fallback,
    same-day behavior, strike math, blank behavior, fairness repair, and coverage
    preservation.

API and persistence layer:

- `artifacts/api-server/src/routes/allocations.ts`
  - Allocation run endpoint now stores latest fairness diagnostics in memory for
    the current process.
  - Manual assignment endpoint validates availability and same-day constraints
    before saving.
  - Stats endpoint exposes allocation audit, fairness diagnostics, blank-shift
    explanations, assignment-without-availability counts, and violation summaries.

Frontend dashboard and export:

- `artifacts/shift-scheduler/src/pages/admin/surveys/[id].tsx`
  - Admin dashboard now shows fairness diagnostics.
  - No-availability AFP fallback toggles were removed from the visible UI.
  - Request payload now sends deprecated no-availability AFP fallback list as an
    empty array for compatibility.
  - Added editable calendar-style XLSX export.
- `artifacts/shift-scheduler/package.json`
  - Added `exceljs`.

API specs and generated clients:

- `lib/api-spec/openapi.yaml`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/*`

Dependency metadata:

- `package.json`
- `pnpm-lock.yaml`

### Current Mathematical Model

The non-AFP target model is:

```text
target_i = min(capacity_i, max(0, M - penalty_i))
```

Where:

- `i` is a non-AFP respondent.
- `target_i` is the target allocation for respondent `i`.
- `capacity_i` is the respondent's available capacity, in minutes.
- `M` is the virtual non-penalized non-AFP baseline.
- `penalty_i` is the strike penalty, in minutes.

The solver finds `M` by bisection so that:

```text
sum_i target_i = feasible non-AFP target pool
```

The solver uses minutes internally to avoid floating-point hour errors. Examples:

- 10 hours = 600 minutes.
- 7.5 hours = 450 minutes.
- 2 hours = 120 minutes.

The simple formula:

```text
M = (H_N + sum penalties) / number of non-AFPs
```

is only valid when there is no zero truncation and no capacity cap. The actual
implementation uses the general monotone solver so it can handle:

- no penalties
- one strike
- mixed strikes
- fractional strikes
- everyone penalized
- one non-AFP
- penalty larger than baseline
- low availability capacity

### Penalty Math Examples Now Covered

Example 1:

```text
4 non-AFPs
H_N = 80 hours
penalties = [0, 0, 0, 0]
targets = [20, 20, 20, 20]
```

Example 2:

```text
4 non-AFPs
H_N = 110 hours
penalties = [0, 0, 0, 10]
baseline M = 30
targets = [30, 30, 30, 20]
```

This specifically fixes the earlier bug where a 10-hour strike could behave as
though it deducted only 5 hours.

Example 3:

```text
4 non-AFPs
H_N = 105 hours
penalties = [0, 0, 10, 5]
baseline M = 30
targets = [30, 30, 20, 25]
```

### Current Priority Order

The engine now behaves according to this priority structure:

1. Hard validity.
   - No assignment without selected availability.
   - No duplicate shift assignment.
   - No missing respondent or missing shift reference.
   - No three shifts for one person on one day.
   - No non-adjacent double shifts on the same day.
2. Coverage.
   - Assign as many shifts as possible.
   - Do not leave a shift blank for fairness reasons if someone can legally take it.
3. Blank explanation.
   - Every blank must have an explanation.
   - Blank shifts with availability must list why each available person was blocked.
4. Same-day quality.
   - Prefer one shift per person per day.
   - Allow two shifts only if they are adjacent/back-to-back.
5. AFP cap discipline.
   - AFP normal hours respect cap.
   - AFP cap overflow can only occur through explicit allowed source and only if
     the AFP selected that shift.
6. Fairness.
   - Targets guide allocation but are not hard caps.
   - After coverage is fixed, the repair pass tries to reduce spread.
7. Stable deterministic tie-breaking.

### Hard Availability Rule

The latest rule is strict:

```text
No person may be assigned a shift unless that person explicitly selected
availability for that shift.
```

This applies to:

- engine normal assignment
- back-to-back emergency assignment
- AFP cap overflow assignment
- repair/swap logic
- in-app manual assignment

No-availability shifts now remain blank:

```text
availabilityCount = 0
assignment = blank
reason = NO_AVAILABILITY
```

The legacy assignment source name `engine_no_availability_afp_fallback` remains
in some schemas/code paths for compatibility with previously generated API types
and older records, but the central validator now requires availability for every
non-blank assignment source. The engine tests cover that AFPs are not assigned to
no-availability shifts.

### Same-Day Rules

The shared validator enforces:

- Max two shifts per person per day.
- If two shifts are assigned on the same day, they must be adjacent.
- Three shifts in one day are invalid.
- Morning-plus-evening or other non-contiguous double shifts are invalid.

Allowed adjacent examples:

- 9-11 and 11-2
- 11-2 and 2-5
- 2-5 and 5-8
- 8-12 and 12-4
- 12-4 and 4-8

Forbidden examples:

- 9-11 and 2-5
- 9-11 and 5-8
- 11-2 and 5-8
- any three shifts on the same date

### Coverage and Blank-Shift Behavior

The allocator is now coverage-first:

- Scarce shifts are prioritized earlier.
- Targets and fairness are not treated as hard eligibility caps.
- A shift with availability should not remain blank if any legal candidate can
  take it.
- Blank shifts with availability are serious and must show candidate-level
  blockers.

The audit rows expose:

- shift identity and stable shift key
- rendered blank status
- allocation record status
- assignment source
- availability count
- available respondents
- candidate eligibility
- same-day blockers
- AFP cap blockers
- final reason category

Important blank categories:

- `NO_AVAILABILITY`
- `NO_FALLBACK_AFP_SELECTED` for legacy/compatibility contexts
- `ALL_AVAILABLE_BLOCKED_BY_SAME_DAY`
- `ALL_AVAILABLE_BLOCKED_BY_AFP_CAP`
- `ALL_AVAILABLE_BLOCKED_BY_MANUAL_LOCK`
- `ALL_AVAILABLE_BLOCKED_BY_MIXED_CONSTRAINTS`
- `ENGINE_REPAIR_LIMIT_REACHED`
- `UNKNOWN`

### Stable Shift Keys

The engine computes stable shift keys:

```text
stableShiftKey = date | startTime | endTime | slotIndex
```

This is used to protect against issues where generated database shift IDs or
rendering keys drift from submitted availability. The audit and rendering logic
can now detect whether a schedule cell appears blank despite an allocation
record existing.

### Fairness Repair Pass

The latest fairness pass runs after coverage and blank repair. It does not
sacrifice coverage.

It never:

- makes a filled shift blank
- assigns someone to a shift they did not select
- violates same-day rules
- creates three shifts in one day
- creates non-adjacent same-day double shifts
- moves manual assignments

It attempts:

1. Single reassignment.
   - Move a shift from an over-target person to an under-target person if the
     under-target person selected the shift and can legally take it.
2. Pairwise swap.
   - Swap shifts between two people if both selected the shifts they would
     receive and both resulting assignments are legal.

The improvement objective is lexicographic:

1. reduce max absolute deviation from target
2. reduce non-penalized non-AFP standard deviation
3. reduce total squared deviation from target
4. reduce range between max and min non-penalized non-AFP hours

Fairness thresholds:

- target standard deviation: 2 hours
- warning standard deviation: 4 hours

If the non-penalized non-AFP standard deviation remains high, the dashboard now
shows high-SD reason codes such as:

- `HIGH_STD_DEV_NO_LEGAL_REPAIR`
- `SHIFT_GRANULARITY_LIMIT`
- `INSUFFICIENT_OVERLAPPING_AVAILABILITY`

### Dashboard Updates

The admin dashboard now exposes:

- total assigned and blank shifts
- blank shifts with zero availability
- blank shifts with availability
- assignment-without-availability counts
- manual assignment counts
- emergency/back-to-back counts
- AFP cap and over-cap summaries
- non-AFP target versus actual hours
- non-penalized non-AFP mean, median, min, max, range, and standard deviation
- target and warning standard deviation thresholds
- max deviation from mean
- max deviation from target
- squared target deviation
- whether fairness repair was attempted
- number of fairness repair moves made
- high-SD explanation codes
- blank-shift audit rows with candidate blockers

Expected invariant after the latest pass:

```text
assignmentsWithoutAvailability = 0
manualAssignmentsWithoutAvailability = 0
fallbackAssignmentsWithoutAvailability = 0
```

### Manual Assignment Behavior

In-app manual assignment is now validated before save.

Manual assignment is blocked if:

- the respondent did not select the shift
- the assignment would create an invalid same-day pattern
- the assignment would violate hard engine rules

Manual override no longer means the app can assign a respondent to a shift they
did not select. If admin needs to fix an uncovered shift, they must either leave
it blank, ask someone to cover it outside the submitted availability flow, or
edit/collect corrected availability first.

### AFP Rule Changes

AFPs still have cap logic, but AFPs also obey the same hard availability rule.

Current behavior:

- AFPs can receive normal assignments only for shifts they selected.
- AFP cap is respected for normal allocation.
- Available-shift AFP cap overflow can only happen if explicitly enabled and
  the AFP selected the shift.
- AFPs are not assigned to shifts where nobody selected availability.
- AFPs are excluded from the non-AFP fairness mean.

### XLSX Export Changes

An editable calendar-style XLSX export was added using ExcelJS.

Primary sheet:

- `Calendar`

Calendar sheet structure:

- Title: `Front Desk Schedule: Month YYYY`
- Weeks stacked vertically.
- Blue merged week header row.
- Weekday block on the left.
- Weekend block on the right.
- Date/day headers with colored styling.
- Borders around cells.
- Centered assignment text.
- Assigned names are plain editable text in calendar cells.
- Blank shifts are left blank or shown according to export behavior.
- No fake names are inserted.
- No formulas are required for assignment cells.
- Sheet is not protected.
- Landscape print setup and fit-to-width configuration included.

Supporting sheets:

- `Schedule List`
- `Person Summary`
- `Blank Shifts`
- `Fairness Stats`
- `Allocation Audit`

The existing CSV-style schedule/person data remains available through supporting
exports/sheets.

### Validation Commands Run

The latest allocation/fairness/XLSX pass was validated with:

```powershell
pnpm run typecheck
pnpm run test
pnpm run build
```

Observed result at the time of the pass:

- Typecheck passed.
- Tests passed.
- Test count: 28 tests.
- Build passed.
- Build produced existing Vite sourcemap/chunk-size warnings, including a large
  ExcelJS-related chunk. These warnings did not fail the build.

### Test Coverage Added or Updated

Tests now cover:

- no unavailable assignment
- no AFP assignment to no-availability shifts
- manual unavailable assignment block
- strike target math
- 10-hour strike not being reduced as only 5 hours
- mixed strike penalties
- fractional/edge penalty behavior
- capacity-adjusted penalty targets
- AFP excluded from non-AFP mean
- same-day max-two rule
- non-adjacent double-shift rejection
- adjacent double-shift emergency behavior
- blank shift despite availability regression
- coverage preservation during fairness repair
- fairness high-SD feasible balancing case

### Known Limitations and Next-Pass Risks

1. Fairness repair is local, not a full optimizer.
   - It currently uses single reassignment and pairwise swap.
   - It does not yet implement a full MILP/ILP model or deep augmenting-chain
     optimization.
   - It may miss improvements that require chains of depth 3-4.

2. Fairness repair move count is currently process-memory based.
   - `latestFairnessDiagnosticsBySurveyId` tracks the latest run in memory.
   - If the API server restarts, stats can recompute fairness metrics, but the
     exact previous repair move count is not persisted.

3. XLSX export was build-verified but not visually opened in Excel in this pass.
   - No dedicated XLSX unit test currently asserts exact workbook sheet structure
     and cell placement.
   - A next pass should add workbook tests if practical.

4. Live May allocation needs a real data run after deployment.
   - We need actual counts for:
     - blank shifts with zero availability
     - blank shifts with availability
     - non-penalized non-AFP mean
     - non-penalized non-AFP standard deviation
     - repair moves made
     - assignment-without-availability count
   - Expected assignment-without-availability count is 0.

5. Render deployment may not be automatic.
   - Since auto deploy is disabled in `render.yaml`, the Render service may need
     a manual deploy to reflect commit `139adde`.

6. Legacy fallback naming remains in schemas.
   - `engine_no_availability_afp_fallback` remains in generated types for
     compatibility, but it should not be used to assign a person without
     availability.
   - A future cleanup could migrate or hide the legacy enum more fully.

### Suggested Next-Pass Prompt for ChatGPT Pro

Copy/paste this prompt into ChatGPT Pro for the next reasoning pass:

```text
You are ChatGPT Pro 5.5 helping reason about a TypeScript front-desk monthly shift allocation app.

The current repo branch is `render-monthly-hosting`. The latest allocation work is commit `139adde Tighten availability and fairness allocation`.

We need the next pass to review the current allocator design and propose the strongest next implementation prompt for Codex.

Current confirmed state:

1. Hard availability invariant:
   - No engine assignment, emergency assignment, fallback assignment, AFP cap overflow assignment, repair/swap assignment, or in-app manual assignment may assign a respondent to a shift they did not select.
   - If nobody selected a shift, it remains blank with reason `NO_AVAILABILITY`.
   - AFP no-availability fallback has been disabled by the central validator and tests.

2. Strike math:
   - Non-AFP target formula:
     target_i = min(capacity_i, max(0, M - penalty_i))
   - M is solved by bisection in minutes so targets sum to the feasible non-AFP pool.
   - AFPs are excluded from the non-AFP fairness mean.
   - Tested examples include:
     - H_N=80, penalties [0,0,0,0] -> [20,20,20,20]
     - H_N=110, penalties [0,0,0,10] -> baseline 30, targets [30,30,30,20]
     - H_N=105, penalties [0,0,10,5] -> baseline 30, targets [30,30,20,25]

3. Same-day rules:
   - Max two shifts per person per day.
   - Two shifts must be adjacent/back-to-back.
   - Three shifts and non-adjacent doubles are invalid.

4. Coverage:
   - Coverage is prioritized over fairness.
   - Fairness targets are soft, not hard caps.
   - A shift with availability should not remain blank if a legal candidate can take it.
   - Blank shifts are audited with candidate-level blocker reasons.

5. Fairness repair:
   - After coverage, the engine tries local fairness repair.
   - It attempts single reassignment and pairwise swap.
   - It preserves coverage and hard constraints.
   - Improvement objective:
     1. reduce max absolute deviation from target
     2. reduce non-penalized non-AFP standard deviation
     3. reduce total squared deviation
     4. reduce non-penalized range
   - Target standard deviation is 2 hours; warning is 4 hours.

6. Dashboard:
   - Exposes fairness diagnostics, assignment-without-availability counts, blank audit rows, AFP stats, penalty stats, and high-SD reason codes.

7. Export:
   - ExcelJS calendar-style editable XLSX export exists.
   - Calendar sheet is first.
   - Supporting sheets include Schedule List, Person Summary, Blank Shifts, Fairness Stats, and Allocation Audit.

8. Validation:
   - `pnpm run typecheck`, `pnpm run test`, and `pnpm run build` passed after the latest pass.
   - Tests passed: 28.

Known limitations:

1. Fairness repair is currently local search only, not a full optimizer.
2. It may miss deeper augmenting chains requiring depth 3-4.
3. Fairness repair move count is held in process memory and not persisted across server restarts.
4. XLSX export was build-verified but not visually opened in Excel and lacks a dedicated workbook-structure test.
5. A live May allocation run is needed after deployment to measure actual blanks and actual non-penalized non-AFP standard deviation.
6. Render auto deploy may be disabled, so manual deployment may be needed.

Please think deeply and produce the next best Codex implementation prompt. The prompt should focus on:

- running a real allocation audit on the May survey data without deleting responses
- proving there are zero assignments without availability
- measuring blank shifts by category
- measuring non-penalized non-AFP mean/stddev/range on live data
- deciding whether local fairness repair is enough or whether to implement a deterministic optimizer
- if deeper repair is preferred, specify a concrete augmenting-chain algorithm depth 3-4
- if an optimizer is preferred, specify whether to use MILP/ILP/min-cost flow and how to preserve the current hard invariants
- persisting allocation run metadata and fairness diagnostics safely if needed
- adding XLSX workbook unit tests and/or visual verification
- keeping all response data and survey data untouched

Do not loosen the availability invariant. No one can be assigned a shift they did not select. Do not reintroduce no-availability AFP fallback. Coverage must be maximized only among available respondents.

Output a precise implementation prompt for Codex, not generic advice.
```

### Practical Next Steps

Recommended next Codex pass:

1. Trigger or confirm Render deploy of commit `139adde`.
2. Run the allocator on the real May survey.
3. Export or inspect allocation audit.
4. Record:
   - non-AFP non-penalized mean
   - non-AFP non-penalized standard deviation
   - assignments without availability
   - blank shifts with zero availability
   - blank shifts with availability
   - fairness repair moves made
   - AFP cap overflow usage
   - back-to-back emergency usage
5. If SD remains high above 2-4 hours, implement deeper augmenting repair or a
   deterministic optimization model.
6. Add XLSX workbook tests for the calendar sheet.
7. Persist fairness diagnostics and repair counts if the dashboard needs to
   survive server restarts with exact run metadata.
