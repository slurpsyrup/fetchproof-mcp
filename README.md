# @fetchproof/mcp

[![Fetchproof MCP server](https://glama.ai/mcp/servers/slurpsyrup/fetchproof-mcp/badges/score.svg)](https://glama.ai/mcp/servers/slurpsyrup/fetchproof-mcp)

stdio [Model Context Protocol](https://modelcontextprotocol.io) server for the [Fetchproof](https://fetchproof.com) public-data API. Each published operation is one tool — TikTok, Instagram, Facebook (including the Ad Library), YouTube transcripts, official race results by bib, and the rest of the catalog.

You bring your own Fetchproof API key (`FETCHPROOF_API_KEY`). No key is embedded in this package. `initialize` and `tools/list` work without a key so clients and directories can inspect the tool list.

Docs: [docs.fetchproof.com/mcp](https://docs.fetchproof.com/mcp) · Free tools: [fetchproof.com/tools](https://fetchproof.com/tools) · Sign up: [app.fetchproof.com](https://app.fetchproof.com)

## Install

Node 20 or newer. No install is required if you use `npx`:

```bash
FETCHPROOF_API_KEY=fp_your_key npx -y @fetchproof/mcp
```

Or install the CLI:

```bash
npm install -g @fetchproof/mcp
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "fetchproof": {
      "command": "npx",
      "args": ["-y", "@fetchproof/mcp"],
      "env": {
        "FETCHPROOF_API_KEY": "fp_your_key"
      }
    }
  }
}
```

### Cursor (`.cursor/mcp.json` or a stdio MCP entry)

```json
{
  "mcpServers": {
    "fetchproof": {
      "command": "npx",
      "args": ["-y", "@fetchproof/mcp"],
      "env": {
        "FETCHPROOF_API_KEY": "fp_your_key"
      }
    }
  }
}
```

A hosted Streamable HTTP endpoint also exists at `https://api.fetchproof.com/mcp` (send the key as `Authorization: Bearer` or `x-api-key`). This package is the local stdio server: it maps tools from the published OpenAPI operations and calls the REST API directly.

## Environment

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `FETCHPROOF_API_KEY` | For `tools/call` | — | Your key from [app.fetchproof.com](https://app.fetchproof.com) |
| `FETCHPROOF_BASE_URL` | No | `https://api.fetchproof.com` | API host |
| `FETCHPROOF_TIMEOUT_MS` | No | `60000` | Per-request timeout |

## Billing

Prepaid, one-time credit packs. 1 credit per call by default. Credits never expire. There is no subscription.

- Freelance: $27 for 25,000 credits
- Business: $297 for 500,000 credits

Errors, blocked or timed-out requests, invalid requests and cache hits cost nothing. A not-found or empty result is charged only where that operation's published cost says so.

Each tool description includes that operation's published credit cost, including any empty-result or outcome rules.

## What this server can do

One tool per published operation. Priority surfaces include:

- TikTok profiles, profile videos, individual videos, comments, transcripts, search
- Instagram profiles, grid posts, reels, individual posts
- Facebook pages, posts, and the Meta Ad Library
- YouTube channels, videos, comments, and transcripts
- Official race results by bib (RunSignup, Athlinks/ChronoTrack, Race Roster)

The tool list stays in sync with the published OpenAPI file in this repository. Held-back or unpublished routes are not tools.

## Development

```bash
node mcp/scripts/sync-spec.mjs   # regenerate openapi/tools.json from the published spec
node mcp/test/mcp-package.test.js
npm pack --dry-run --prefix mcp
```

This package has no runtime dependencies. Logs go to stderr; stdout is JSON-RPC only (newline-delimited; Content-Length framing is also accepted).

## License

MIT
