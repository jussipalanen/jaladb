# Contributing

Thanks for your interest in JalaDB. Issues and pull requests are welcome.

## How changes get in

- Every change to `main` goes through a **pull request**. Direct pushes are
  blocked for everyone, including the maintainer.
- A pull request needs a **review from the code owner** (see
  [CODEOWNERS](.github/CODEOWNERS)) and **all CI checks passing** before it can
  be merged. Only the maintainer merges.
- For pull requests from forks, CI runs after the maintainer approves the
  workflow run.

## Before opening a pull request

1. Open or find an **issue** describing the change, and link it in the PR
   (`Closes #123`).
2. Keep the PR focused on **one** change.
3. Add or update **tests**. Database behaviour is tested against real
   PostgreSQL, not mocks.
4. Run the checks locally:

   ```bash
   ./dev setup
   ./dev test        # database
   ./dev test-api    # API
   ./dev test-ui     # console
   ```

5. Add a line under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for notable
   changes.

The project's scope and conventions are described in [CLAUDE.md](CLAUDE.md)
and [AGENTS.md](AGENTS.md). In short: PostgreSQL stays the main focus, SQL and
PL/pgSQL stay visible (no ORM), and the API and console stay thin.

## Security issues

Please report them privately, as described in [SECURITY.md](SECURITY.md).
