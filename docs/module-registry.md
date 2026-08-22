# Module registry and versioning

The module registry installs pluggable packages without adding them to the core
application module graph. It validates manifests, checks compatibility with the
running API version, stores one current version per module name, and isolates
enablement and configuration by tenant.

## Author a module

Create a `module.manifest.json` next to the module entry point:

```json
{
  "name": "portfolio-exporter",
  "version": "1.0.0",
  "core": ">=0.1.0 <1.0.0",
  "hooks": {
    "onInstall": true,
    "onUpgrade": true,
    "onUninstall": false
  },
  "entryPoint": "@organization/portfolio-exporter"
}
```

The schema requires:

- `name`: lowercase module identifier.
- `version`: valid semantic version.
- `core`: semantic-version range supported by the module.
- `hooks`: booleans declaring `onInstall`, `onUpgrade`, and `onUninstall`.
- `entryPoint`: installed package reference or a runtime JavaScript entry point
  inside the root `modules/` directory. Local entry points outside that directory
  are rejected so manifests cannot load core source files.

The machine-readable schema is in
`src/modules/registry/module-manifest.schema.json`. Runtime validation uses the
equivalent class-validator DTO plus `semver`, so invalid versions and ranges are
rejected even when a client does not use the JSON Schema.

Local modules must expose JavaScript that Node can load without `ts-node`.
TypeScript authors should compile their package before registration and ship
declarations that implement `ModuleLifecycle`. Published npm package entry points
are resolved normally from `node_modules`.

The entry point must default-export a lifecycle class or object implementing:

```ts
interface ModuleLifecycle {
  onInstall?(): Promise<void>;
  onUpgrade?(fromVersion: string, toVersion: string): Promise<void>;
  onUninstall?(): Promise<void>;
}
```

A hook marked `true` must be implemented. Hooks execute inside the registry's
database transaction where possible. A thrown error rolls back the registry
version and status. Because external services cannot participate in the database
transaction, hooks must be idempotent and compensate for external side effects.

## Register and upgrade

Registry endpoints require an authenticated administrator. Registry management
bypasses the general user KYC guard because it is an administrative control-plane
operation; the global authentication and role guards still apply.

POST the manifest and its metadata to `POST /api/v1/modules`:

```json
{
  "manifest": {
    "name": "portfolio-exporter",
    "version": "1.0.0",
    "core": ">=0.1.0 <1.0.0",
    "hooks": {
      "onInstall": true,
      "onUpgrade": true,
      "onUninstall": false
    },
    "entryPoint": "@organization/portfolio-exporter"
  },
  "description": "Exports tenant portfolios",
  "author": "Organization"
}
```

The API reads the core version from the root `package.json`. Registration and
enablement fail with a message containing the required range and actual version
when the module is incompatible.

Posting a new name runs `onInstall`. Posting the same name with a strictly newer
version runs `onUpgrade` and updates the existing registry row. Equal versions and
downgrades are rejected.

## Tenant and global enablement

Enable a module with `POST /api/v1/modules/:id/enable` and disable it with
`POST /api/v1/modules/:id/disable`:

```json
{
  "tenantId": "tenant-123",
  "config": { "format": "csv" }
}
```

Each operation changes only that tenant's `TenantModuleState`. The project has no
canonical tenant entity, so `tenantId` is an opaque identifier supplied by the
caller. Omitting `tenantId` creates or updates the nullable global-default state;
it does not alter any explicit tenant row. An explicit tenant state therefore
remains isolated from the default.

Resolve the effective state for a tenant with:

```text
GET /api/v1/modules/:id/state?tenantId=tenant-123
```

Resolution uses the explicit tenant row first, then the global-default row. When
neither exists the result is an implicit disabled state. A disabled explicit row
therefore overrides an enabled global default.

A module can be removed with `DELETE /api/v1/modules/:id` only when every tenant
and global-default state is disabled. Deregistration runs `onUninstall` when it is
declared.

## Run the example locally

The working example is in `modules/example-grant-module`. Its CommonJS entry
point is loadable by the development server, the bundled application, and the
production Docker image; `index.d.ts` declares the lifecycle TypeScript contract.

```bash
npm install
npm run migration:run
npm run start:dev
MODULE_REGISTRY_TOKEN=<admin-token> npm run module:example:register
```

`MODULE_REGISTRY_TOKEN` must contain an administrator bearer token. Set
`MODULE_REGISTRY_URL` to use a non-default API URL. Inspect the registered module
with `GET /api/v1/modules`, then use its returned UUID in the enable, disable, and
state-resolution endpoints.
