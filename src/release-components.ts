import { ContainerComponentSource, ReleaseApp } from '@pragmatic-tech-ai/pragmatic-release-toolkit'
import { PragmaticPostgresComponent } from './pragmatic-postgres-component.js'

/**
 * This repository's one component, as `pragmatic-component-descriptors --components dist/release-components.js` reads it
 * (components.Dockerfile, the first bake step): the toolkit's module contract is this one exported constant.
 */
export const Components = new ContainerComponentSource(ReleaseApp.Postgres, () => PragmaticPostgresComponent.Descriptor())
