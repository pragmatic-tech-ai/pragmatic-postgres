import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ReleaseApp } from '@pragmatic-tech-ai/pragmatic-release-toolkit'
import { Components } from '../release-components.js'
import { PragmaticPostgresComponent } from '../pragmatic-postgres-component.js'

/**
 * The descriptor this repository's image carries (the module the first bake step emits it from) against the pin
 * pragmatic-server held for pragmatic-postgres (admin/control-plane/descriptors/digests.json at the split): the split
 * changed no byte of it.
 */
class DescriptorGolden
{
    public static readonly ServerDigest = 'sha256:b7f5b0d2ded8135d805d4c30e0f257ae0c6f3eb50511c4e4e4c0024903729ae0'
    public static readonly PackageJson = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json')
    private static readonly Utf8 = 'utf8'

    public static PackageVersion(): string
    {
        const manifest = JSON.parse(readFileSync(DescriptorGolden.PackageJson, DescriptorGolden.Utf8)) as { version: string }
        return manifest.version
    }
}

describe('pragmatic-postgres descriptor golden', () =>
{
    it('the descriptor digest equals the pragmatic-server pin', () =>
    {
        assert.equal(Components.Of(ReleaseApp.Postgres).ContentDigest(), DescriptorGolden.ServerDigest)
    })

    it('is the one component of this repository, named for its release image', () =>
    {
        const all = Components.All()
        assert.equal(all.length, 1)
        assert.equal(all[0][0], ReleaseApp.Postgres)
        assert.equal(all[0][1].ContentDigest(), DescriptorGolden.ServerDigest)
    })

    it('declares the package version (descriptor version = package version)', () =>
    {
        assert.equal(PragmaticPostgresComponent.Version, DescriptorGolden.PackageVersion())
    })
})
