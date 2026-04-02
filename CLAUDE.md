# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenClaw channel plugin that receives meeting transcriptions from Vibe Dot devices via Server-Sent Events (SSE). This is a **one-way inbound channel** — transcriptions flow into OpenClaw but agent replies are not sent back to the device (they can optionally be forwarded to a Slack webhook).

## Commands

- `bun install` — install dependencies
- `bun run check` — run formatting check + type check (this is the main CI-style validation)
- `bun run format` — auto-format with prettier
- `bun run format:check` — check formatting without writing
- `tsc --noEmit` — type-check only

There is no build step (noEmit is set); OpenClaw loads the TypeScript source directly. There are no tests.

## Architecture

This is an OpenClaw channel plugin using the `openclaw` plugin SDK. The plugin registers a channel called `vibedot`.

- **`index.ts`** — Plugin entry point. Registers the channel via `defineChannelPluginEntry` with the plugin, runtime setter, and metadata.
- **`setup-entry.ts`** — Separate setup entry point used by the OpenClaw CLI for interactive channel configuration (`openclaw channels add`).
- **`src/channel.ts`** — Plugin definition. Configures account resolution, setup adapter, config adapter, and the gateway. The gateway's `startAccount` launches the SSE monitor via `runPassiveAccountLifecycle`.
- **`src/monitor.ts`** — Core SSE logic. Connects to the relay endpoint (`https://demo-dot-relay.vibeus.workers.dev/dot-messages`), parses the SSE stream manually, extracts `transcription` from each message, and dispatches it as an inbound DM via `dispatchInboundDirectDmWithRuntime`. Implements auto-reconnect with exponential backoff (1s–30s). Optionally forwards agent replies to a Slack webhook.
- **`src/runtime.ts`** — Thin wrapper around `createPluginRuntimeStore` to hold the plugin runtime singleton.
- **`openclaw.plugin.json`** — Plugin manifest declaring the `vibedot` channel.

## Configuration

The channel reads from `channels.vibedot` in the OpenClaw config:

- `token` (required) — Bearer token for the SSE relay endpoint
- `slack_webhook` (optional) — Slack incoming webhook URL for forwarding agent replies
- `enabled` — defaults to true

## Code Style

- Prettier with: semicolons, trailing commas (`all`), 100 char print width
- ESM (`"type": "module"` in package.json, `verbatimModuleSyntax` in tsconfig)
- Imports from `openclaw/plugin-sdk/*` subpaths — these are the SDK surface area
- Local `.js` extensions in import paths (required by NodeNext module resolution even for `.ts` files)
