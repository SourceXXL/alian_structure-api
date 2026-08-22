# Example grant module

This package is a minimal runtime-safe module that demonstrates the registry's
install and upgrade lifecycle. It lives outside `src/`, does not modify core
files, and exports a CommonJS entry point that works in development, the bundled
Nest build, and the production Docker image.

`index.d.ts` declares that the runtime class implements `ModuleLifecycle`.
`index.cjs` records lifecycle calls in memory so the e2e test can verify them.

Start the API, provide an admin bearer token, and register the module:

```bash
npm run start:dev
MODULE_REGISTRY_TOKEN=<admin-token> npm run module:example:register
```

Override the endpoint with `MODULE_REGISTRY_URL` when the API is not available at
`http://localhost:3001/api/v1/modules`.

Submitting the same manifest with a version newer than `0.1.0` calls
`onUpgrade(fromVersion, toVersion)`.
