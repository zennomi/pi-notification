## Pi SDK 1.2.0 compatibility

`pi-notification` is verified against these exact development SDK pins:

- `@earendil-works/pi-agent-core`: `1.2.0`
- `@earendil-works/pi-ai`: `1.2.0`
- `@earendil-works/pi-coding-agent`: `1.2.0`
- `@earendil-works/pi-tui`: `1.2.0`

They are test pins; the public peer dependency ranges remain `*`. The extension uses `registerTool`, TypeBox schemas, `ctx.modelRegistry.streamSimple`, `sessionManager.getEntries`, `ctx.ui.input/notify`, and the `agent_settled` lifecycle event.

### Runtime verification

Run `npm run smoke:pi` to load the extension in the locally pinned Pi host. `npm run ci` runs this harness as part of CI. The committed result is `docs/verification/pi-sdk-smoke.json` and uses `verification_contract=pi-sdk-behavior-v3`.

The harness checks extension loading, the offline `/notify-test` setup-hint path, malformed RPC handling, a second process and clean shutdown, and the native host-shell boundary. It uses an isolated temporary agent directory and makes no network or model requests.
