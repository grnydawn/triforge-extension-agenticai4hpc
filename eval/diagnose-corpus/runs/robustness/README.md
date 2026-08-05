# Multi-judge robustness of the ±tool ablation

Does the with-vs-without result depend on the strength (or family) of the LLM judge? We re-graded
**all 248 saved agent answers** — the exact same `transcripts/*.answer.txt` files, with the exact
same blind rubrics from `scripts/eval/judge-results.sh` — under two additional judges. Only the
judge model changes.

| Judge | Model | Relationship to primary judge |
|-------|-------|-------------------------------|
| **primary** | `claude-sonnet-5` | the judge used throughout the paper |
| **opus** | Claude Opus | stronger, **same** family as the primary judge |
| **codex** | `gpt-5.6-sol` (OpenAI) | **different** family — cannot share the Claude agent's self-preference; ≥ the Codex agent |

## Headline: localization gap (`+tool − bare`, deck-fault `right_stage %`)

| Judge | Claude gap | Codex gap |
|-------|-----------:|----------:|
| primary (`sonnet`) | 98 − 80 = **+18** | 98 − 78 = **+20** |
| opus | 100 − 78 = **+22** | 100 − 80 = **+20** |
| codex (`gpt-5.6-sol`) | 98 − 64 = **+33** | 100 − 78 = **+22** |

The `+tool` arm is stable at 98–100% localization under every judge; all movement is in the *bare*
arm, which the stronger judges credit **less**, not more. So the primary judge is, if anything,
**conservative** — a stronger or cross-family judge only widens the advantage. Clean-precision is
judge-invariant (92% / 75% / 100% identical across all three judges).

## Cell-level agreement with the primary judge

| Judge | `found_fault` | `right_stage` (both non-na) | full-cell |
|-------|--------------:|----------------------------:|----------:|
| opus | 244/248 (98.4%) | 181/190 (95.3%) | 236/248 (95.2%) |
| codex | 247/248 (99.6%) | 179/193 (92.7%) | 234/248 (94.4%) |

## Reproduce

```bash
# re-grade (writes runs/robustness/<judge>/results-<client>-judged.csv + .judge sidecars)
for judge in opus codex; do
  for client in claude codex; do
    scripts/eval/judge-multi.sh "$client" "$judge"
  done
done

# recompute the ablation rows under each judge
node scripts/eval/tabulate-ablation.mjs eval/diagnose-corpus/runs/robustness/opus
node scripts/eval/tabulate-ablation.mjs eval/diagnose-corpus/runs/robustness/codex
```

The per-judge `results-<client>-judged.csv` files are **not** tracked — they fall under the
`runs/.gitignore` `results-*.csv` rule, like the primary judge's own graded CSVs. A clone carries
this README and the tables above, but re-deriving them means re-running the two re-grades, which
costs four judged passes over 248 saved answers. The per-cell `*.judge.txt` rationale sidecars are
likewise regenerable and not tracked.
