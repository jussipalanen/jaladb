# Agent Instructions

This repository is a PostgreSQL-focused database engineering portfolio project.

Read `CLAUDE.md` completely before making changes.

## Priorities

Use this priority order:

1. PostgreSQL correctness
2. Data integrity
3. Automated testing
4. Clear SQL and PL/pgSQL
5. Backend integration
6. Documentation
7. Development workflow quality
8. Frontend
9. Optional AI functionality

PostgreSQL must remain the primary technical focus.

---

# Mandatory GitHub Workflow

All meaningful development must follow:

```text
Issue
  ↓
Feature branch
  ↓
Implementation
  ↓
Tests
  ↓
Pull Request
  ↓
Human review
  ↓
Merge
  ↓
Release when appropriate
```

Do not skip this workflow unless explicitly instructed by the human maintainer.

---

# Issues

Every feature, bug fix, database improvement, or meaningful technical change should be associated with a GitHub Issue.

Before implementation:

1. Read the Issue.
2. Understand its requirements.
3. Check its acceptance criteria.
4. Identify the database impact.
5. Identify required tests.

Do not silently expand the scope beyond the Issue.

If additional work is discovered, prefer creating or proposing a separate Issue rather than adding unrelated work to the current feature.

---

# One Feature at a Time

Work on one logical feature at a time.

Do not implement several roadmap items in a single change.

For example:

```text
Issue #4
Implement get_customer_orders()
```

should not also implement:

```text
reserve_stock()
create_order()
semantic search
frontend reports
```

unless the Issue explicitly requires them.

---

# Branches

Never work directly on `main`.

Use a branch associated with the Issue.

Preferred naming:

```text
feature/4-customer-orders
feature/6-stock-reservation
fix/18-order-rollback
test/21-inventory-tests
docs/24-readme
```

Use the GitHub Issue number when available.

---

# Implementation Workflow

For each Issue:

1. Read `CLAUDE.md`.
2. Read the Issue.
3. Check the current implementation.
4. Create or use the Issue branch.
5. Implement the smallest complete change.
6. Add or update automated tests.
7. Run relevant tests.
8. Run linting and formatting.
9. Verify migrations when database changes exist.
10. Update documentation if necessary.
11. Prepare a focused Pull Request.
12. Stop and wait for human review.

Do not automatically begin the next feature.

---

# PostgreSQL Changes

For database changes:

* use migrations
* preserve data integrity
* use appropriate constraints
* keep PL/pgSQL functions readable
* use parameterized SQL from application code
* add meaningful tests
* document non-obvious decisions
* consider query performance

Do not duplicate PostgreSQL business logic in Node.js without a clear reason.

---

# Testing

Every meaningful database feature should have automated tests.

Always consider:

* successful behavior
* validation
* failure cases
* constraints
* transaction rollback
* trigger behavior
* concurrent or inventory-sensitive behavior where relevant

Prefer testing against real PostgreSQL.

Do not mock PostgreSQL when a practical integration test can verify the real behavior.

---

# Pull Requests

Each Pull Request should normally address one GitHub Issue.

PR title example:

```text
feat(db): add customer order query function
```

PR description should include:

## Summary

Explain what was implemented.

## Related Issue

Example:

```text
Closes #4
```

## Database Changes

Describe:

* migrations
* functions
* triggers
* views
* indexes

when applicable.

## Tests

Explain which tests were added or changed.

## How to Test

Provide exact commands or reproduction steps.

## Notes

Explain important technical decisions or tradeoffs.

---

# Human Review Is Mandatory

Human approval is required before merging a Pull Request.

Agents must never:

* approve their own Pull Request
* merge their own Pull Request
* merge directly into `main`
* bypass branch protections
* bypass failed tests
* disable CI checks to make a PR pass
* create a production-style release without explicit human approval

Agents may:

* create a feature branch
* implement an Issue
* write tests
* run tests
* prepare a Pull Request
* update a Pull Request after review feedback
* explain implementation decisions

The human maintainer makes the final merge decision.

---

# Review Feedback

When a human reviewer requests changes:

1. Read all review comments.
2. Make only the requested or necessary related changes.
3. Add or update tests where appropriate.
4. rerun relevant checks.
5. update the same Pull Request.

Do not open a replacement PR unless explicitly requested.

Do not resolve review comments by merely changing documentation when the underlying implementation is incorrect.

---

# Commits

Prefer Conventional Commit messages.

Examples:

```text
feat(db): add stock reservation function

feat(api): expose inventory availability endpoint

fix(db): rollback failed order creation

test(db): cover insufficient inventory

docs: add local development instructions
```

Keep commits logical and understandable.

---

# CI

Before marking a Pull Request ready for review, run all relevant checks.

Expected checks may include:

```text
lint
typecheck
backend tests
PostgreSQL integration tests
migration validation
build
```

A feature is not complete while required checks are failing.

Do not alter tests simply to make incorrect behavior pass.

---

# Main Branch

Treat `main` as stable.

Do not intentionally merge:

* failing tests
* broken migrations
* incomplete features
* experimental code
* temporary debugging output
* secrets

---

# Versioning

Use Semantic Versioning:

```text
MAJOR.MINOR.PATCH
```

Examples:

```text
v0.1.0
v0.2.0
v0.2.1
v1.0.0
```

Do not increment versions automatically for every PR.

A version should represent a meaningful project state.

Before `v1.0.0`, prefer `0.x.y` versions.

---

# Releases

GitHub Releases should correspond to version tags.

Example:

```text
v0.3.0
```

Release notes should summarize:

* major features
* database changes
* API additions
* performance improvements
* relevant fixes

An agent may prepare release notes when requested.

An agent must not publish a release unless explicitly instructed by the human maintainer.

---

# Scope

Do not turn this project into a complete e-commerce application.

Keep the backend and frontend intentionally lightweight.

Do not introduce new technologies unless they solve a clear requirement.

Avoid unnecessary abstraction.

Do not add unrelated functionality while completing an Issue.

---

# Optional AI

AI functionality is optional.

Do not implement AI before the core PostgreSQL demo works and is tested.

Preferred optional implementation:

```text
PostgreSQL + pgvector semantic product search
```

Do not add:

* autonomous agents
* unrestricted text-to-SQL
* large RAG systems
* chatbot functionality

unless explicitly requested.

---

# Definition of Done

An Issue is ready for human review when:

* the requested feature is implemented
* acceptance criteria are satisfied
* database migrations work
* relevant tests exist
* tests pass
* lint/type checks pass
* no unrelated changes were introduced
* documentation is updated where necessary
* the branch is ready for a focused Pull Request

The Issue is not considered fully completed until the Pull Request has been reviewed and merged by a human.
