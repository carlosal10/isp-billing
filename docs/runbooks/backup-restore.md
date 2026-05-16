# MongoDB Backup And Restore Runbook

This platform stores billing, ledger, router, tenant, and customer state in MongoDB. Treat backups as production financial records.

## Prerequisites

- `MONGO_URI` or `MONGODB_URI` must point at the target database.
- `mongodump` and `mongorestore` must be installed on the machine running the scripts.
- Backup archives are written under `backups/mongodb/` by default and are ignored by git.
- Use `MONGODUMP_BIN` or `MONGORESTORE_BIN` when the MongoDB tools are not on `PATH`.

## Backup

Preview the command without touching the database:

```powershell
npm run backup:mongo:plan -- --label nightly-prod
```

Create a backup and keep the newest 14 archives by default:

```powershell
npm run backup:mongo -- --label nightly-prod
```

Useful options:

- `--dir C:\secure\backups`: write archives outside the repository.
- `--keep 30`: retain the newest 30 archives after a successful backup.
- `--no-gzip`: create an uncompressed MongoDB archive.
- `BACKUP_RETENTION_COUNT=30`: set retention through the environment.

## Restore

Always run a restore plan first:

```powershell
npm run restore:mongo:plan -- --archive C:\secure\backups\isp-billing-nightly-prod.archive.gz
```

Execute restore only after confirming the target database and archive:

```powershell
npm run restore:mongo -- --archive C:\secure\backups\isp-billing-nightly-prod.archive.gz
```

Add `--drop` only for a full replacement restore. Without `--drop`, MongoDB restores into existing collections.

## Verification

After a restore:

- Run `npm run env:check`.
- Run `npm run migrate:status`.
- Run `npm run db:indexes:audit`.
- Open the admin UI and confirm tenants, invoices, payments, ledger entries, and router inventory.

## Operating Policy

- Store production backups outside the repository and outside the app host when possible.
- Encrypt archives at rest when moving them to external storage.
- Test restore into a non-production database at least monthly.
- Keep at least one known-good backup before running migrations or bulk billing operations.
