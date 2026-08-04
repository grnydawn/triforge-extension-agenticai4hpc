# Arm A vs C session transcripts (AE provenance)

Save one transcript per session here, named:

```
<client>_<arm>_<fixture>_t<trial>.md      # e.g. claude_A_fault-grid-bin_t1.md
<client>_<arm>_<fixture>_t<trial>.jsonl   # Claude MCP: the append-only tool-call transcript
```

- `client` ∈ {`claude`, `copilot`} · `arm` ∈ {`A`, `C`} · `fixture` = a corpus fixture dir ·
  `trial` = 1-based.
- These are the reproducibility (Artifact Evaluation) evidence for the Layer-2 study.
- **Keep them generic.** The study runs on the synthetic corpus fixtures only — never on real
  operational data — so committed transcripts must not contain workflow-specific tokens (the
  corpus genericity guard scans this tree).
