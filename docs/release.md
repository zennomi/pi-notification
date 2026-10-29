# Release

`pi-notification` publishes to npm with GitHub Actions Trusted Publishing (OIDC). Do not add an `NPM_TOKEN` or other long-lived npm token.

## One-time npm setup

Configure the npm package `pi-notification` with:

- Publisher: GitHub Actions
- Repository: `zennomi/pi-notification`
- Workflow filename: `publish.yml`
- Permission: publish

## Release process

1. Update `version` in the root `package.json` and add release notes to `CHANGELOG.md`.
2. Run `npm run ci` locally.
3. Merge to `main`.
4. Manually dispatch `.github/workflows/auto-release.yml` on `main`.

The release workflow validates the root version, creates `v<version>` and a GitHub Release, then explicitly dispatches `publish.yml` for that tag. Ordinary pushes do not release or publish.

`publish.yml` checks the public npm registry before configuring OIDC. If the exact version is already published it logs `publish intentionally skipped`; otherwise it runs validation and publishes from the repository root.

## First publish troubleshooting

If npm returns `E404`, configure Trusted Publishing for `pi-notification` with repository `zennomi/pi-notification` and workflow `publish.yml`, then rerun the workflow. Do not add `NPM_TOKEN`.

## Local checks

```bash
npm ci
npm run ci
npm pack --dry-run
```

The tarball should contain only the extension, `lib/`, the notify skill, and the public root documentation listed in `package.json.files`.
