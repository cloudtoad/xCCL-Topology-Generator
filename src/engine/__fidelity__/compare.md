# Fidelity Check — AI Source Comparison Prompt

> Run this prompt with Claude Code to perform a source-level fidelity comparison
> between our engine and the NCCL reference. Output goes to `REPORT.md`.

## Instructions

Read the fidelity manifest at `src/engine/__fidelity__/manifest.yaml`.

For each module listed in the manifest:

1. **Read our implementation file** (the `our_file` path)
2. **Read the NCCL reference file** at `~/xCCL-Book/ref/nccl/src/{ref_file}`
3. **For each function mapping**, verify:
   - Same algorithmic logic (semantically equivalent, not line-for-line)
   - Same decision branches and conditions
   - Same constant values used
   - Same env var defaults and behavior
   - Note any divergences with severity: `critical` (wrong behavior), `moderate` (missing optimization), or `minor` (cosmetic/ordering difference)
4. **For each constant**, verify our value matches the NCCL reference value exactly
5. **For each env var**, check:
   - Is it defined in our `env.ts`?
   - Does our default match NCCL's default?
   - Is there a UI knob for it?
   - Is it actually read/used in our engine code?

## Output Format

Write the report to `src/engine/__fidelity__/REPORT.md` using this format:

```markdown
# Fidelity Report — {YYYY-MM-DD}

## Summary
- Modules checked: N
- Functions compared: N
- Constants verified: N
- Env vars audited: N
- Divergences found: N (critical: N, moderate: N, minor: N)
- Missing features: N

## Divergences

| Module | Item | Ours | NCCL | Severity | Notes |
|--------|------|------|------|----------|-------|
| ...    | ...  | ...  | ...  | ...      | ...   |

## Missing Features

| NCCL Feature | Source Location | Priority | Notes |
|-------------|----------------|----------|-------|
| ...         | ...            | ...      | ...   |

## Constants Verification

| Constant | Our Value | NCCL Value | Match |
|----------|-----------|------------|-------|
| ...      | ...       | ...        | ...   |

## Env Var Coverage

| Var | Default OK | Implemented | UI Knob | Notes |
|-----|-----------|-------------|---------|-------|
| ... | ...       | ...         | ...     | ...   |

## Module-by-Module Analysis

### paths (paths.ts ↔ paths.cc)
- classifyHop: [PASS/DIVERGENCE] ...
- spfaFromSource: [PASS/DIVERGENCE] ...
- applyPxnPaths: [PASS/DIVERGENCE] ...
...

### topo (topo.ts ↔ topo.cc)
...

### search (search.ts ↔ search.cc)
...

### trees (trees.ts ↔ trees.cc)
...

### rings (rings.ts ↔ rings.cc)
...

### connect (connect.ts ↔ connect.cc)
...

### tuning (tuning.ts ↔ tuning.cc)
...

### init (init.ts ↔ init.cc)
...
```

## Severity Definitions

- **Critical**: Our code produces different results than NCCL for the same input. This means our simulator would show incorrect topology/paths/channels.
- **Moderate**: Missing optimization or feature that NCCL has but we skip. Results are still correct but suboptimal (e.g., missing GDR check, missing P2C path type).
- **Minor**: Cosmetic or ordering difference that doesn't affect results (e.g., different variable names, different iteration order that produces same output).

## Special Attention Areas

1. **classifyHop**: This is the core path classification logic. Every branch must match.
2. **SPFA domination check**: The "is this path better?" condition must use the same comparison logic as NCCL.
3. **PXN conditions**: The 4 conditions for PXN eligibility must match exactly.
4. **Speed arrays**: These must be identical — any difference means we search at wrong speeds.
5. **Intel P2P overhead**: The 6/5 factor and when it's applied must match.
6. **Ring search scoring**: The GPU candidate scoring criteria and sort order must match.
