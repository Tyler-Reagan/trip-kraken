# ADR-0000: Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-06-23
- **Supersedes:** —
- **Superseded by:** —

## Context

Trip Kraken is being refactored top-down. The explicit direction is that the stack
and current architecture are secondary to the product goal, and every part of the
app is eligible for change. In that situation the most dangerous failure mode is
re-deriving or polishing decisions that were never written down — auditing code
against an unstated standard. We need a durable, reviewable record of *why* the
architecture is the way it is, captured before (or alongside) the code that
implements it.

## Decision

We will keep Architecture Decision Records as Markdown files in `docs/adr/`,
numbered sequentially (`NNNN-kebab-title.md`), following Michael Nygard's format
(Context / Decision / Consequences) plus an explicit **Alternatives considered**
section so the reasoning survives.

- ADRs are immutable once **Accepted**. A decision changes by writing a new ADR
  that supersedes the old one, not by editing history.
- `0001` defines the north star; lower numbers constrain higher numbers.
- The README table is the index of record.
- Code reviews and audits cite the ADR they enforce or violate.

## Alternatives considered

- **No formal record (status quo).** Decisions live in commit messages, PR threads,
  and memory. Rejected: not discoverable, and exactly the failure mode this refactor
  is trying to avoid.
- **A single living ARCHITECTURE.md.** One mutable document. Rejected: loses the
  history of *why a decision changed*, which is the most valuable part when revisiting
  a wrong call.
- **Issues/wiki.** Rejected: decisions belong next to the code, versioned with it.

## Consequences

- Every significant architectural choice gets a small writing cost up front.
- Audits and PRs gain a stable target ("conforms to ADR-N") instead of subjective
  review.
- The `docs/adr/` index must be kept current; a superseded ADR must be marked, not
  deleted.
