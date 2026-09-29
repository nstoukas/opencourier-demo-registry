# opencourier-demo-registry

## Overview

The instance discovery registry: a small Express server on port 3001. Instances register
here and the registry verifies each one through its `/metadata` endpoint.

**Read the workspace rulebook first: [`../AGENTS.md`](../AGENTS.md).** This repo sits inside the co-op workspace, and that file binds it: co-op values, locked decisions, domain language, boundaries, and the `aiflow.sh` pipeline every change goes through. Tools that stop at this repo's git root will not find it on their own. This file only adds what is specific to this component.

## Key files

| File | Owns |
|---|---|
| `server.js` | All routes; exports `{ app, getRegistryData, fetchAndValidateInstanceMetadata }` |
| `src/db.js` | The `pg` pool; queries are raw SQL with PostGIS |
| `scripts/setupDatabase.js` | Creates the schema (`npm run db:setup`) |
| `test/*.test.js` | Tests for Node's built-in runner |

## Commands

npm, with its own `package-lock.json`. `npm test` runs `node --test`. Bring-up steps are
in the workspace rulebook.

## Gotchas

- A `prisma/` folder exists, but the server does not use Prisma. Data access is raw `pg`.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
