# Changelog — co-op fork of `opencourier-demo-registry`

This fork adapts [Princeton-HCI/opencourier-demo-registry](https://github.com/Princeton-HCI/opencourier-demo-registry),
the instance discovery registry, for a Greek workers' cooperative.

Everything below sits on top of upstream `main` on the branch `fix/postgis-and-metadata`
(3 commits, 26 July 2026). Each entry names its commit.

---

## Fixed — `354cf60`

- **`npm run db:setup` failed outright.** The `instances` table declared
  `GEOMETRY(FeatureCollection,4326)`, but `FeatureCollection` is a GeoJSON container, not a
  PostGIS geometry type. The column is now `GEOMETRY(Geometry,4326)`, filled via
  `ST_GeomFromGeoJSON`.
- **A registration without a `details` object returned a 500.** `getRegistryData` now
  treats a missing `details` as an empty object.

## Added — `e6b8c75`

- **Test runner**: Node's built-in `node --test` with no new dependencies. Run it with
  `npm test`; tests live in `test/*.test.js`.
- `server.js` now exports `{ app, getRegistryData, fetchAndValidateInstanceMetadata }` and
  only calls `listen` when run directly, so tests can import it without opening a port.
- The first tests cover `getRegistryData`, including the missing-`details` crash and how
  nullable fields default.

## Housekeeping — `c0f7169`

- Ignored pipeline artifacts (`.aiflow/`, `plan.md`).

## AI context files

- `AGENTS.md`, context for AI coding tools that points at the co-op workspace rulebook, and a
  `CLAUDE.md` that imports it.
