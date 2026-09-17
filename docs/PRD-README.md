# CodeVenue Documentation — README

## Purpose

This directory is the **canonical product documentation** for CodeVenue. The repository's root `README.md` is currently a placeholder, so these files are the single source of truth for what the product is, what exists, and what is planned.

## Files

| File | What it is | Audience |
|---|---|---|
| `PRD.md` | The Product Requirements Document (v1.0) — Git-friendly Markdown. The **editable source of truth**. | Everyone |
| `CodeVenue-PRD.docx` | Professionally formatted Word rendering of `PRD.md` (cover page, document control, TOC field, page numbers, styled tables). Generated artifact — do not hand-edit; regenerate or update `PRD.md` first. | Academic evaluation, portfolio, client review |
| `prd-analysis.md` | The evidence base: repository inventory, workflow traces, UX findings, feature-state classification, and the failure/validation log from PRD generation. | Contributors, reviewers verifying claims |
| `_build_docx.py` / `_validate_docx.py` | Regeneration/validation tooling for the DOCX (Python 3 + `python-docx`). Kept so the Word version never drifts from the Markdown. | Maintainers |

## Evidence labels

Throughout the PRD, feature claims are classified:

- **IMPLEMENTED** — verified in repository source during analysis (September 2026).
- **PARTIALLY IMPLEMENTED** — exists but incomplete or inferred (e.g., exam language inference).
- **REQUIRED (future)** — planned behavior, not built (e.g., code execution — §18.2, §32).
- **UNKNOWN — needs validation** — cannot be determined from the repository; tracked in §29 Open Questions.

Never promote an assumption to IMPLEMENTED without source evidence in `src/`.

## How to update

1. Change behavior in code → update the relevant PRD section **and** its FR/NFR acceptance criteria in the same change.
2. Bump the version in `PRD.md` §34 (Change Log) and the cover/Document Control pages.
3. Regenerate the Word version: `python3 docs/_build_docx.py && python3 docs/_validate_docx.py`.
4. Keep `prd-analysis.md` current only when the *evidence base* changes (new modules, removed features); it is a point-in-time analysis otherwise.

## Versioning

- `MAJOR.MINOR` — MAJOR for scope/product-model changes, MINOR for requirement additions or clarifications.
- v1.0 (2026-09-17) — initial PRD from full repository analysis.

## Ownership

- **Owner:** project owner (see PRD Document Control).
- **Change process:** PR-based edits to `PRD.md`; reviewers should run the ten review passes from the PRD generation checklist (product, user, UX, engineering, QA, architecture, readability, consistency, evidence, scope).

## Generation notes (transparency)

- The PRD was generated after direct source inspection of `src/convex/*` (schema, `exams.ts`, `validation.ts`, `limits.ts`, `rateLimits.ts`, auth), all 9 route pages, the editor/dashboard components, `qa/visual-qa.mts`, `vite.config.ts`, `vercel.json`, and `package.json`.
- Git branch/commit/push for these docs could not be executed from the generation environment (git CLI blocked by platform policy); the files were saved to the working tree instead. See `prd-analysis.md` → "Failure log".
