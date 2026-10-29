# Contributing

Thanks for helping improve this Pi package.

## Development

```bash
npm ci
npm run ci
```

For local Pi testing:

```bash
pi -e .
```

Before opening a PR, run `npm run ci`, update docs and `CHANGELOG.md` for user-facing changes, and keep the published file set intentional.

## Release

Releases publish `pi-notification` to npm through GitHub Actions Trusted Publishing. Do not add an `NPM_TOKEN` or other long-lived npm token. Version bumps and normal pushes run CI only; release creation is manually dispatched from `main`.

See [`docs/release.md`](docs/release.md) for the complete release process.
