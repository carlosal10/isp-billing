# Security Policy

## Supported Scope

Security fixes are currently expected to land on the latest state of `main`.

## Reporting a Vulnerability

Please report security issues privately to the maintainers instead of opening a public issue.

When reporting, include:

- affected endpoint, page, or workflow
- reproduction steps
- impact assessment
- any suggested mitigations

## Secret Handling

- Never commit real `.env` files or provider credentials
- Rotate any credential immediately if it is exposed in git history, logs, screenshots, or support messages
- Prefer tenant-scoped or environment-scoped secrets over shared credentials

## Operational Expectations

- Payment, auth, tenant, and router-control changes should be reviewed carefully before release
- Debug logging that could expose tokens, credentials, or sensitive customer data should be disabled outside controlled troubleshooting
