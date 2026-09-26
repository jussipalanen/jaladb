# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report them privately through GitHub: on the repository's **Security** tab,
choose **Report a vulnerability**. Only the maintainer can see the report.

Include what you found, how to reproduce it, and its impact. You'll get a reply
as soon as possible.

## Scope

JalaDB is a portfolio and demonstration project meant to run **locally**. All
Docker ports are bound to `127.0.0.1`, and the credentials in `.env.example`,
`docker-compose.yml` and the CI workflow are placeholders for local or
throwaway databases, not secrets.

Relevant reports include, for example:

- SQL injection or other ways to run arbitrary SQL through the API or console
- ways around the database's integrity rules (e.g. overselling stock)
- vulnerable dependencies not yet covered by Dependabot

## Supported versions

Only the latest release and `main` receive fixes.
