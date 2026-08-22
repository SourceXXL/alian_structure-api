# Module review checklist

Use this checklist when GrantFox, Stella, or a SourceXXL maintainer reviews a new
module pull request.

## Manifest and compatibility

- [ ] `module.manifest.json` is present and passes registry validation.
- [ ] `name` is stable and unique, and `version` is valid semver.
- [ ] The declared core compatibility range is accurate and tested.
- [ ] Every lifecycle hook marked `true` is implemented by the entry point.
- [ ] The published/runtime entry point is compiled JavaScript and loads without
      development-only TypeScript hooks.

## Scope and architecture

- [ ] The module does not directly modify or couple itself to core files.
- [ ] Public behavior is exposed through documented module boundaries.
- [ ] Database changes include safe, reversible migration hooks.
- [ ] Lifecycle hooks are idempotent and fail without leaving partial state.

## Quality and isolation

- [ ] Unit and integration tests are included and passing.
- [ ] Per-tenant enablement, disablement, and configuration isolation are tested.
- [ ] Global-default behavior is documented and does not overwrite tenant states.
- [ ] Effective-state tests cover tenant override, global fallback, and implicit
      disabled behavior.
- [ ] Logs and errors provide enough context without exposing sensitive data.
- [ ] No API keys, credentials, private URLs, or other secrets are hardcoded.
- [ ] Registry installation and upgrade operations remain restricted to
      administrators.

## Governance and documentation

- [ ] Dependency and source licenses are compatible with Apache-2.0.
- [ ] The module's purpose, setup, configuration, and operational limits are documented.
- [ ] Upgrade, rollback, and uninstall expectations are documented.
- [ ] User-facing API or configuration changes include examples.
- [ ] The PR is limited to the module and necessary registry integration.
