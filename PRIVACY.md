# Privacy Policy

**Last updated: 2026-04-21**

## Overview

obsidian-mcp-bundle is a **local connector**. It runs entirely on your machine and communicates only with the Obsidian CLI binary that is already installed locally. No data ever leaves your computer via this connector.

## Data access

- This connector reads and writes files inside Obsidian vaults on your local filesystem.
- Access is limited to the vault(s) you choose to target via the `vault` parameter, or the vault currently open in Obsidian.
- No vault content, file metadata, or usage telemetry is transmitted to any external server, cloud service, or third party.

## Data storage

- This connector stores no data itself. It is a pass-through to the Obsidian CLI.
- All persistent state (notes, properties, tasks, etc.) lives in your local Obsidian vault files, under your full control.

## Network activity

- This connector makes no outbound network requests.
- The Obsidian CLI may contact Obsidian's servers if you explicitly invoke sync or publish commands via the `run` tool — that network activity is governed by [Obsidian's own Privacy Policy](https://obsidian.md/privacy).

## Permissions

- The connector inherits the filesystem permissions of the process running your MCP client (Claude Desktop, VS Code, etc.).
- It can read and write any file accessible to that user account, scoped to the paths the Obsidian CLI itself accepts.

## Contact

For questions or concerns, open an issue at <https://github.com/davideme/obsidian-mcp-bundle/issues>.
