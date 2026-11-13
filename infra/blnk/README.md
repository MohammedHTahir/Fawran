# Local Blnk ledger

This stack runs the Blnk open-source Core alongside its own PostgreSQL database and Redis. It is deliberately isolated from Fawran's application database.

## Start

From the repository root:

```powershell
docker compose -f infra/blnk/docker-compose.yml up -d
docker compose -f infra/blnk/docker-compose.yml ps
docker compose -f infra/blnk/docker-compose.yml logs -f server worker
```

Blnk's API is bound to localhost at `http://localhost:5001`. Its PostgreSQL is bound to localhost port `5433`, leaving Fawran's existing PostgreSQL on `5432` untouched. Redis is internal to the Compose network.

To stop the services without deleting ledger data:

```powershell
docker compose -f infra/blnk/docker-compose.yml down
```

To delete the local Blnk database volume as well (destructive):

```powershell
docker compose -f infra/blnk/docker-compose.yml down -v
```

## Important

- This is a local development configuration only.
- The Blnk server is configured with secure mode disabled and must not be exposed to the internet.
- The database password is a disposable local-development credential.
- Do not use this stack for real customer funds or production.
- Do not write financial movements to both Blnk and the legacy Fawran ledger. Until the adapter and migration are implemented and tested, the existing Fawran ledger remains the application's active ledger.
- The Blnk image is pinned to `0.15.7` for repeatable local setup. Upgrade only after reviewing Blnk release notes and rerunning the integration tests.

See [Blnk's official open-source deployment guide](https://docs.blnkfinance.com/deploy/open-source) and [API documentation](https://docs.blnkfinance.com/).
