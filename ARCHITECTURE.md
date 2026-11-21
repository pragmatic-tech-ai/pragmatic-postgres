# pragmatic-postgres — Architecture Index

> Navigational map. **Maintenance rule:** when a change moves or renames a seam below, update this file in the same
> commit.

**Container:** `pragmatic-postgres`, a release app (A5 Postgres storage design): the Postgres the tenant IdP and the
admin consoles store in. Not a Node app: the image is the official Postgres 17 base plus two shell scripts; Node only
builds and tests its component descriptor. Split out of pragmatic-server's `docker/postgres/` (dev-kit A3).

## Image

- `Dockerfile`: stage `component` copies `pragmatic-postgres/component.json` from the `components` build context and
  refuses it unless it hashes to `COMPONENT_DIGEST`; the runtime stage asserts the postgres user is 999:999, copies the
  two scripts, sets path-only environment (`POSTGRES_INITDB_ARGS`, `POSTGRES_PASSWORD_FILE`,
  `PRAGMATIC_POSTGRES_APPLICATIONS`, `PRAGMATIC_POSTGRES_SECRETS_DIR`), writes `/pragmatic/component.json`, labels
  `ai.pragmatic-tech.component.digest`, runs as `999:999`, health check `pg_isready` on 127.0.0.1.
- `pragmatic-postgres-entrypoint.sh`: the composition root. Sources the official entrypoint's functions, validates
  (`pragmatic-postgres-reconcile.sh plan`) before the data directory is touched, starts the server socket-only, applies
  the plan, stops it and execs the real server.
- `pragmatic-postgres-reconcile.sh`: `plan` validates the applications file and the password files and prints the SQL;
  passwords are read by `pg_read_file` inside the server, never passed on argv or in the environment.

## Descriptor

- `PragmaticPostgresComponent` (`src/pragmatic-postgres-component.ts`): option `core` (applications file, secrets
  folder, superuser, superuser password file), no roles, no Postgres storage of its own, port 5432; `Version` = the
  package.json version.
- `src/release-components.ts`: `Components = new ContainerComponentSource(ReleaseApp.Postgres, ...)`, read by
  `pragmatic-component-descriptors --components dist/release-components.js emit-all` in `components.Dockerfile`.
- Pins: `src/tests/descriptor-golden.test.ts` (the digest = pragmatic-server's
  `admin/control-plane/descriptors/digests.json` at the split; version = package.json) and
  `src/tests/pragmatic-postgres-component.test.ts` (golden JSON `src/tests/fixtures/pragmatic-postgres.component.json`,
  readers coverage over the Dockerfile and the two scripts, with `component-golden.ts` / `component-sources.ts`).

## Build and CI

- `docker-bake.hcl` (rendered): target `components` (descriptor, `digests.json`, `docker-bake.components.json` into
  `.components`), target `pragmatic-postgres` (context `.`, the `components` named context, multi-arch via `PLATFORMS`).
- `.github/workflows/ci.yml` / `release.yml` (rendered): pragmatic-shared's `container-ci.yml` (`closure-check: false`,
  `image-test: true`, `arm64: true`) and `container-release.yml`.

## Tests

- `tests/reconcile.test.sh` (18 cases, no database), `tests/image.test.sh` (8 cases, a docker host; CI runs it on the
  baked image per arch), `tests/harness.sh` (the TAP harness both source).
- `src/tests/postgres-image.test.ts`: the Dockerfile's shape, LF and shebangs, the bake target and workflow inputs, and
  the reconcile suite under bash (skipped on Windows).
