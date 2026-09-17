# CodeVenue Documentation — README

## Purpose

This directory is the **canonical product documentation** for CodeVenue. The repository's root `README.md` is currently a placeholder, so these files are the single source of truth for what the product is, what exists, and what is planned.

## Files

| File | What it is | Audience |
|---|---|---|
| `PRD.md` | **PRD v2.0** — the clean, human-readable Product Requirements Document (22 sections: WHY → WHO → PROBLEM → PRODUCT → WORKFLOW → REQUIREMENTS → VALIDATION). The editable source of truth. | Everyone — readable without touching the code |
| `CodeVenue-PRD.docx` | Professionally formatted Word rendering of `PRD.md` v2.0 (cover page, document control, static table of contents, page numbers, styled tables, requirement blocks). Generated artifact — do not hand-edit. | Academic evaluation, portfolio, client review |
| `prd-analysis.md` | The evidence base: repository inventory, workflow traces, UX findings, and — since v2.0 — the relocated NFR/Security/Open-Questions/Risk/Test registers plus the v1→v2 requirement ID cross-reference. | Contributors, reviewers verifying claims |
| `archive/PRD-v1.md`, `archive/CodeVenue-PRD-v1.docx` | Superseded v1.0 PRD (34 sections, engineering-audit depth). Kept for traceability of the original evidence labels and ID numbering. | Reference only |
| `_build_docx.py` / `_validate_docx.py` | Regeneration/validation tooling for the DOCX (Python 3 + `python-docx`). Kept so the Word version never drifts from the Markdown. | Maintainers |

## Evidence labels

Throughout the PRD, feature claims are classified with the simple v2 labels:

- **Implemented** — verified in repository source during analysis (September 2026).
- **Partial** — exists but incomplete (e.g., exam language inference).
- **Planned** — agreed direction, not built (e.g., code execution — §17 of the PRD).
- **Needs validation** — cannot be determined from the repository; tracked via the Open Questions register in `prd-analysis.md`.

Never promote an assumption to Implemented without source evidence in `src/`.

## How to update

1. Change behavior in code → update the relevant PRD section **and** its requirement's acceptance criteria in the same change.
2. Bump the version in the PRD's Change Log (§22) and the cover/Document Control pages.
3. Regenerate the Word version: `python3 docs/_build_docx.py` (update `SRC`/`OUT` paths if filenames change), then re-validate the archive and content spot-checks.
4. Keep `prd-analysis.md` current when the *evidence base* changes (new modules, removed features, ID renumbering); it is a point-in-time analysis otherwise.

## Versioning

- `MAJOR.MINOR` — MAJOR for scope/product-model changes, MINOR for requirement additions or clarifications.
- v1.0 (2026-09-17) — initial PRD from full repository analysis (34 sections; archived).
- v2.0 (2026-09-17) — readability restructure (22 sections). Requirement content preserved; registers relocated to `prd-analysis.md`; IDs remapped (cross-reference in the analysis file).

## Ownership

- **Owner:** project owner (see PRD Document Control).
- **Change process:** PR-based edits to `PRD.md`; reviewers should run the ten review passes from the PRD generation checklist (product, user, UX, engineering, QA, architecture, readability, consistency, evidence, scope).

## Generation notes (transparency)

- The PRD was generated after direct source inspection of `src/convex/*` (schema, `exams.ts`, `validation.ts`, `limits.ts`, `rateLimits.ts`, auth), all 9 route pages, the editor/dashboard components, `qa/visual-qa.mts`, `vite.config.ts`, `vercel.json`, and `package.json`.
- v2.0 (Sept 17, 2026) was a restructuring pass over the completed v1 content — no repository re-analysis, no new feature claims.
- Git branch/commit/push for these docs could not be executed from the generation environment (git CLI blocked by platform policy); the files were saved to the working tree instead. See `prd-analysis.md` → "Failure log".
