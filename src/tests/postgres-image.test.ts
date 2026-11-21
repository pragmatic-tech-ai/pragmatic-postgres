import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ReleaseApp, ReleaseApps } from '@pragmatic-tech-ai/pragmatic-release-toolkit'

/** The pragmatic-postgres image: its Dockerfile, scripts, its bake target and the workflows that bake it. */
class PostgresImage
{
    public static readonly RepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
    public static readonly Entrypoint = 'pragmatic-postgres-entrypoint.sh'
    public static readonly Reconcile = 'pragmatic-postgres-reconcile.sh'
    public static readonly ReconcileTests = join('tests', 'reconcile.test.sh')
    public static readonly Harness = join('tests', 'harness.sh')
    public static readonly ImageTests = join('tests', 'image.test.sh')
    public static readonly Dockerfile = 'Dockerfile'
    public static readonly Shebang = '#!/usr/bin/env bash\n'
    public static readonly Bash = 'bash'
    public static readonly Windows = 'win32'
    /** The TAP plan line of tests/reconcile.test.sh: its 18 cases, none dropped on the way. */
    public static readonly ReconcilePlan = /^1\.\.18$/m
    public static readonly NoBashReason = 'bash runs the reconcile tests on Linux (CI) and the hive laptop WSL; Windows has none'
    public static readonly BakeFile = 'docker-bake.hcl'
    public static readonly CiWorkflow = join('.github', 'workflows', 'ci.yml')
    public static readonly ReleaseWorkflow = join('.github', 'workflows', 'release.yml')
    public static readonly PackageJson = 'package.json'
    public static readonly ClosureCheckField = 'pragmaticClosureCheck'
    public static readonly DefaultGroup = 'default'
    public static readonly Arm64Input = 'arm64'
    public static readonly ClosureCheckInput = 'closure-check'
    public static readonly ImageTestInput = 'image-test'
    public static readonly True = 'true'
    public static readonly False = 'false'
    private static readonly Utf8 = 'utf8'
    private static readonly Continuation = /\\\n/g
    public static readonly Space = ' '

    public static Text(...path: string[]): string
    {
        return readFileSync(join(PostgresImage.RepoRoot, ...path), PostgresImage.Utf8)
    }

    /** The Dockerfile's instructions, continuation lines joined, comments dropped. */
    public static Instructions(): string[]
    {
        const text = PostgresImage.Text(PostgresImage.Dockerfile).replace(PostgresImage.Continuation, PostgresImage.Space)
        return text.split('\n').map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('#'))
    }

    public static Instruction(keyword: string): string[]
    {
        return PostgresImage.Instructions().filter(line => line.startsWith(keyword + PostgresImage.Space))
    }

    /** The quoted names in a bake group's targets list. */
    public static GroupMembers(group: string): string[]
    {
        const match = new RegExp('group "' + group + '" ' + /\{\s*targets = \[([^\]]*)\]/.source).exec(PostgresImage.Text(PostgresImage.BakeFile))
        assert.ok(match !== null, group)
        return (match[1].match(/"[^"]+"/g) ?? []).map(member => member.slice(1, -1))
    }

    /** A `with:` input of a caller workflow (the line `<name>: <value>`). */
    public static WorkflowInput(workflow: string, name: string): string | undefined
    {
        const match = new RegExp('^\\s+' + name + ': (.*)$', 'm').exec(PostgresImage.Text(workflow))
        return match === null ? undefined : match[1].trim()
    }
}

describe('pragmatic-postgres image', () =>
{
    it('builds on the official Postgres 17, pinned by a multi-arch digest', () =>
    {
        const from = PostgresImage.Instruction('FROM')
        assert.equal(from.length, 2, 'the component check stage and the image, on the same base')
        assert.match(from[0], /^FROM postgres:17\.\d+-[a-z]+@sha256:[0-9a-f]{64} AS component$/)
        assert.equal(from[0], from[1] + ' AS component')
        assert.match(from[1], /^FROM postgres:17\.\d+-[a-z]+@sha256:[0-9a-f]{64}$/)
    })

    it('carries its component descriptor, checked at build against the label digest', () =>
    {
        const run = PostgresImage.Instruction('RUN').find(line => line.includes('sha256sum /component/component.json'))
        assert.ok(run !== undefined && run.includes('"$COMPONENT_DIGEST"'), 'the build refuses a descriptor that is not the labelled one')
        assert.ok(PostgresImage.Instruction('COPY').includes('COPY --from=components pragmatic-postgres/component.json /component/component.json'))
        assert.ok(PostgresImage.Instruction('LABEL').includes('LABEL ai.pragmatic-tech.component.digest=$COMPONENT_DIGEST'))
    })

    it('runs as the postgres user by number, so runAsNonRoot can check it', () =>
    {
        assert.deepEqual(PostgresImage.Instruction('USER'), ['USER 999:999'])
        assert.ok(PostgresImage.Instruction('RUN').some(line => line.includes('"999:999"')), 'the build asserts postgres is 999:999')
    })

    it('reconciles on every start through its own entrypoint, the server as the command', () =>
    {
        assert.deepEqual(PostgresImage.Instruction('ENTRYPOINT'), ['ENTRYPOINT ["' + PostgresImage.Entrypoint + '"]'])
        assert.deepEqual(PostgresImage.Instruction('CMD'), ['CMD ["postgres"]'])
        const copy = PostgresImage.Instruction('COPY').join(PostgresImage.Space)
        assert.ok(copy.includes(PostgresImage.Entrypoint) && copy.includes(PostgresImage.Reconcile), copy)
        assert.match(copy, /--chmod=0755/)
    })

    it('takes every password from a file: the environment names paths, never a password', () =>
    {
        const env = PostgresImage.Instruction('ENV').join(PostgresImage.Space)
        assert.match(env, /POSTGRES_PASSWORD_FILE=\/run\/secrets\/pragmatic-postgres\/superuser/)
        assert.match(env, /PRAGMATIC_POSTGRES_SECRETS_DIR=\/run\/secrets\/pragmatic-postgres\/applications/)
        assert.match(env, /PRAGMATIC_POSTGRES_APPLICATIONS=\/etc\/pragmatic-postgres\/applications\.conf/)
        assert.doesNotMatch(env, /PASSWORD=/)
    })

    it('needs a password on every TCP connection, loopback included, and peer auth on the socket', () =>
    {
        const env = PostgresImage.Instruction('ENV').join(PostgresImage.Space)
        assert.match(env, /POSTGRES_INITDB_ARGS="--auth-host=scram-sha-256 --auth-local=peer"/)
    })

    it('reads healthy only once the real server listens on TCP (pg_isready on loopback)', () =>
    {
        const health = PostgresImage.Instruction('HEALTHCHECK')
        assert.equal(health.length, 1)
        assert.match(health[0], /CMD \["pg_isready", "--host=127\.0\.0\.1", "--quiet"\]$/)
    })

    it('keeps its scripts and Dockerfile LF-only, the scripts on bash', () =>
    {
        for (const name of [PostgresImage.Entrypoint, PostgresImage.Reconcile, PostgresImage.ReconcileTests, PostgresImage.Harness, PostgresImage.ImageTests, PostgresImage.Dockerfile])
        {
            assert.ok(!PostgresImage.Text(name).includes('\r'), name)
        }
        for (const name of [PostgresImage.Entrypoint, PostgresImage.Reconcile, PostgresImage.ReconcileTests, PostgresImage.Harness, PostgresImage.ImageTests])
        {
            assert.ok(PostgresImage.Text(name).startsWith(PostgresImage.Shebang), name)
        }
    })

    it('is a multi-arch image: its own bake target, baked for arm64 too by CI and the release', () =>
    {
        const bake = PostgresImage.Text(PostgresImage.BakeFile)
        assert.match(bake, /target "pragmatic-postgres" \{\s*context\s*= "\."\s*dockerfile = "Dockerfile"\s*platforms\s*= split\(",", PLATFORMS\)/)
        assert.ok(PostgresImage.GroupMembers(PostgresImage.DefaultGroup).includes(ReleaseApp.Postgres))
        assert.equal(PostgresImage.WorkflowInput(PostgresImage.CiWorkflow, PostgresImage.Arm64Input), PostgresImage.True)
        assert.equal(PostgresImage.WorkflowInput(PostgresImage.ReleaseWorkflow, PostgresImage.Arm64Input), PostgresImage.True)
        assert.equal(PostgresImage.WorkflowInput(PostgresImage.CiWorkflow, PostgresImage.ImageTestInput), PostgresImage.True)
    })

    it('is a release app but not a Node app: no closure check describes it', () =>
    {
        assert.ok(ReleaseApps.All.includes(ReleaseApp.Postgres))
        assert.ok(!ReleaseApps.NodeApps.includes(ReleaseApp.Postgres))
        const manifest = JSON.parse(PostgresImage.Text(PostgresImage.PackageJson)) as Record<string, unknown>
        assert.ok(!(PostgresImage.ClosureCheckField in manifest))
        assert.equal(PostgresImage.WorkflowInput(PostgresImage.CiWorkflow, PostgresImage.ClosureCheckInput), PostgresImage.False)
    })

    it('passes its reconcile tests (tests/reconcile.test.sh)', { skip: process.platform === PostgresImage.Windows ? PostgresImage.NoBashReason : false }, () =>
    {
        const result = spawnSync(PostgresImage.Bash, [join(PostgresImage.RepoRoot, PostgresImage.ReconcileTests)], { encoding: 'utf8' })
        assert.equal(result.status, 0, result.stdout + result.stderr)
        assert.doesNotMatch(result.stdout, /^not ok/m)
        assert.match(result.stdout, PostgresImage.ReconcilePlan)
    })
})
