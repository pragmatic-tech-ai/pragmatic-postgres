# pragmatic-postgres

The `pragmatic-postgres` container image (released as `ghcr.io/pragmatic-tech-ai/pragmatic-postgres`, linux/amd64 +
linux/arm64): the official Postgres 17 image, pinned by digest, plus a reconcile that runs on every start. One
instance per hive (and one on the platform host); one database and one role per application. Split out of
pragmatic-server (dev-kit A3); the image, its environment, its mounts and its component descriptor are unchanged.

Mounts:

- `/etc/pragmatic-postgres/applications.conf` (`PRAGMATIC_POSTGRES_APPLICATIONS`): one application per line,
  `<application> <database> <role>`, `#` comments. Names: application `[a-z][a-z0-9-]*`, database and role
  `[a-z_][a-z0-9_]*` (at most 63 characters); `postgres`, `template0/1`, `public` and `pg_*` are reserved, and so is
  the superuser's name. No application, database or role may appear twice.
- `/run/secrets/pragmatic-postgres/applications/<application>` (`PRAGMATIC_POSTGRES_SECRETS_DIR`): each role's
  password, one file per application (trailing line breaks ignored).
- `/run/secrets/pragmatic-postgres/superuser` (`POSTGRES_PASSWORD_FILE`): the superuser `postgres`'s password.
- `/var/lib/postgresql/data`: the data volume.

Every start: the configuration is validated in full (a fault refuses the start, exit 1, nothing changed); the server
is started socket-only; each listed role is created if missing, made a plain login (no superuser, createdb, createrole,
replication, bypassrls) and given its file's password; each database is created if missing, owned by its role
(an existing one owned by another role refuses the start), closed to `PUBLIC` and open to its role; `PUBLIC` loses
`CONNECT` on `postgres` and `template1`; the superuser's password follows its file. Then the real server starts. An
application removed from the file keeps its database and role. Passwords reach the server only by file (read with
`pg_read_file` inside the container), never argv, environment values or logs. Every TCP connection, loopback too,
needs its password (scram-sha-256); the socket admits only the matching OS user (peer).

Run it non-root with a read-only root filesystem:

    docker run -d --read-only --tmpfs /var/run/postgresql --tmpfs /tmp \
        -v pg-data:/var/lib/postgresql/data \
        -v /path/to/etc:/etc/pragmatic-postgres:ro -v /path/to/secrets:/run/secrets/pragmatic-postgres:ro \
        ghcr.io/pragmatic-tech-ai/pragmatic-postgres:<version>

The files must be readable by uid 999. The health check is `pg_isready` on loopback TCP, so the start-up reconcile
(socket only) never reads as healthy.

## Layout

- `Dockerfile`, `pragmatic-postgres-entrypoint.sh`, `pragmatic-postgres-reconcile.sh`: the image (its build context is
  the repository root).
- `src/pragmatic-postgres-component.ts`: the component descriptor class (what the entrypoint and the reconcile read);
  `src/release-components.ts` exports it as `Components` for `pragmatic-component-descriptors`.
- `components.Dockerfile`, `docker-bake.hcl`, `.github/workflows/`, the tsconfigs and the dotfiles: rendered by
  `pragmatic-container-template render --app pragmatic-postgres --entry Dockerfile --out .`
  (`@pragmatic-tech-ai/pragmatic-release-toolkit`).
- `tests/`: the shell suites, `reconcile.test.sh` (no database) and `image.test.sh <image>` (a docker host).
- `src/tests/`: the Node tests (descriptor golden and readers, the Dockerfile's shape, the reconcile suite under bash).

## Build and test

    npm ci
    npm run build
    npm test
    bash tests/reconcile.test.sh

The image is baked in two steps (the label value, the descriptor digest, must be known when the build starts):

    NPMRC_FILE=$HOME/.npmrc docker buildx bake -f docker-bake.hcl --allow=fs.read=$HOME/.npmrc components
    VERSION=0.1.0 GIT_SHA=$(git rev-parse HEAD) docker buildx bake -f docker-bake.hcl \
        -f .components/docker-bake.components.json pragmatic-postgres
    bash node_modules/@pragmatic-tech-ai/pragmatic-release-toolkit/scripts/check-component-label.sh \
        ghcr.io/pragmatic-tech-ai/pragmatic-postgres:0.1.0
    bash tests/image.test.sh ghcr.io/pragmatic-tech-ai/pragmatic-postgres:0.1.0

`NPMRC_FILE` names an `.npmrc` able to read `@pragmatic-tech-ai` packages from GitHub Packages; it reaches the
descriptor build only as the BuildKit secret `npmrc`. The image itself installs no package. CI (pragmatic-shared's
reusable `container-ci.yml`) runs the build, the tests, both bake steps, the label check and the image test, on amd64
and on a native arm64 runner; a `v<semver>` tag equal to `package.json`'s version releases the image
(`container-release.yml`).

To build the image on its own (outside bake), hand it the descriptor the first bake step exported and its digest:

    docker build --build-context components=.components \
        --build-arg COMPONENT_DIGEST="$(jq -r '."pragmatic-postgres"' .components/digests.json)" \
        -t pragmatic-postgres:local .
