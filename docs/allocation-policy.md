# Allocation policy

Policy version: `2026-10-v2`.

## Hard rules

- Each shift has at most one assignee, drawn from the included respondents.
- Ordinary assignments and preserved manual assignments must match submitted availability. Invalid manual locks are rejected explicitly.
- A respondent may receive at most two shifts on one date. Two shifts must touch exactly at their endpoints; separated or overlapping shifts are forbidden.
- An enabled AFP cap applies to ordinary and manual hours. Available-shift cap overflow requires its explicit option and is labelled separately.
- A placeholder is allowed only when **no included respondent selected the shift**, placeholders are enabled, and the assignee is an explicitly chosen AFP respondent. A shift with available but otherwise blocked candidates does not qualify.
- Placeholder hours are accounted separately from the normal AFP cap. They count toward total workload and the same daily restrictions. Extreme placeholder stacking is unsupported and fails explicitly.
- Returned plans, assignment provenance, hours, and unallocated shift IDs must reconcile. Invalid input or output cannot become a saved allocation.

## Priority order

The optimizer solves successive objectives and preserves earlier attained bounds. A later objective cannot trade away an earlier guarantee.

1. Maximize assigned shift count, then staffed minutes at that coverage.
2. If available-shift AFP overflow is enabled, minimize it. Minimize the worst AFP normal-hours target shortfall, then total shortfall. Targets respect caps and feasible submitted capacity; indivisible shifts can prevent exact cap attainment.
3. Establish the target-deviation envelope for the ordinary uncapped pool (General and any AFP without an enabled cap). Targets account for available capacity and strike reductions. Protect strike reductions and availability-limited target attainment, then narrow comparable General under-allocation, over-allocation, range, and total deviation. The two-hour envelope tolerance is refined by the later range/deviation objectives; it is not permission to invent availability.
4. Balance the separate placeholder workload across chosen AFP respondents: minimize the highest placeholder hours, then the difference between highest and lowest. Coverage, daily rules, and prior fairness bounds still apply, so exact equality is not always feasible.
5. Minimize adjacent pair-days within those bounds. Finally refine remaining total target deviation without increasing the selected pair bound.

“Rare back-to-back” means minimizing adjacent pairs after those coverage and equity requirements. It is not an unconditional promise of zero pairs. Pair-days count a two-shift adjacent assignment once.

## Verification and status

The allocator checks input validity, verifies discrete solver incumbents with the assignment binaries fixed, and independently validates the complete returned schedule. Integer objective bounds use integer values; fractional bounds include a small numerical tolerance.

- **Optimal:** the reported optimization stages were proved and the returned assignment was verified.
- **Bounded:** a stage reached its limit or a later stage failed; a verified feasible incumbent is retained. The diagnostic names the affected stage. Feasibility is established, but complete optimality is not claimed. Adjacent-pair optimality is reported conservatively when earlier fairness stages are bounded.
- **Failed:** no acceptable verified result exists, or input/policy validation fails. The operation returns an explicit error and preserves the saved allocation. It does not silently switch to a weaker greedy schedule.

## Explaining unavoidable differences

Compare AFP normal hours, AFP placeholder burden, and General workload separately. Report full-category totals and spread alongside any comparable subgroup; availability-limited people must not disappear from the full-category view.

Standard deviation is a diagnostic, not a sufficient fairness guarantee. A forced high workload can enlarge the measured SD; even two extremely unequal observations lie within one population SD of their mean. Assess targets, shortfalls, minimum/maximum, range, SD, and the actual availability constraints together.

An unexplained shortfall is a defect. An explained incompatibility is different: three-hour availability cannot make exactly ten hours; three sole-available shifts on one day cannot all be staffed under the two-shift rule; shared availability can make individually attainable targets jointly impossible. These situations require a visible reason or a changed input/policy, rather than an unavailable assignment, silent cap breach, or false claim of perfect fairness.

