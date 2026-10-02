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

### Repeatable local restore and rollback drill

Install `mongodump` and `mongorestore` from the [official MongoDB Database Tools archive](https://www.mongodb.com/try/download/database-tools/releases/archive), then run `npm run test:restore`. Set `MONGODUMP_BIN` and `MONGORESTORE_BIN` to their absolute paths if they are not on PATH. This command creates two disposable replica sets; it never accepts an existing deployment URI. It seeds invoices and a settled payment, imports a provider statement, backs up the data, exercises the legacy configuration promotion, and restores the earlier snapshot into the second database. It compares every document and index and checks ledger balances. The output includes the retained archive path.

On Windows with limited system-drive space, set `TEMP`, `TMP`, and `MONGOMS_DOWNLOAD_DIR` to task-specific directories on a drive with sufficient space. These are process-scoped overrides; do not relocate a live database.

### Deployment rollback

Before deployment, pause financial writers and scheduled jobs, record the running application commit and encryption-key IDs, and take a consistent backup. Keep the corresponding encryption keys outside the database archive. Verify the archive by restoring it into an isolated database before resuming writes.

If a migration must be rolled back, pause writers again. Restore the pre-migration snapshot into a separate database, verify tenant records, payment/invoice allocations, ledger account balances and indexes, and deploy the matching earlier application commit against that verified database. Reconcile any provider events received after the snapshot before reopening collection flows. Do not switch to stale legacy M-Pesa settings while retaining newer canonical records; that is not a consistent rollback.

The local drill proves the procedure for a small, quiescent dataset. It does not establish production recovery time, backup consistency under concurrent production writes, or production recovery-point objectives.

- Store production backups outside the repository and outside the app host when possible.
- Encrypt archives at rest when moving them to external storage.
- Test restore into a non-production database at least monthly.
- Keep at least one known-good backup before running migrations or bulk billing operations.
