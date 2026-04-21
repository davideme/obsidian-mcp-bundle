# obsidian-mcp-bundle

A Claude Desktop Extension that exposes the full [Obsidian CLI](https://obsidian.md) as MCP tools, letting Claude read and write notes, manage tasks, search your vault, work with tags, properties, backlinks, daily notes, and execute any Obsidian command.

## Requirements

- [Claude Desktop](https://claude.ai/download) with Desktop Extensions support
- [Obsidian](https://obsidian.md) **1.12 or later**
- Obsidian CLI enabled: **Settings → General → Enable CLI**
- [Node.js](https://nodejs.org) **18 or later**

### Enable the Obsidian CLI

1. Open Obsidian → **Settings** → **General**
2. Toggle **Enable CLI** on
3. Confirm the binary is reachable (macOS/Linux: `obsidian --version` in a terminal)

On macOS, Obsidian places the CLI at `/usr/local/bin/obsidian`. On Linux it lands in `~/.local/bin/obsidian`.

## Installation

### From the Claude Desktop Extension marketplace

1. Open Claude Desktop
2. Go to **Extensions** (or **Settings → Extensions**)
3. Search for **Obsidian CLI** and click **Install**

### From a `.mcpb` file

1. Download the latest `.mcpb` release from the [Releases](https://github.com/davideme/obsidian-mcp-bundle/releases) page
2. Double-click the `.mcpb` file — Claude Desktop opens an install prompt
3. Confirm the installation

That's it. No JSON config editing required.

## Usage

Once installed, Claude can access your Obsidian vault directly. All tools accept an optional `vault` parameter to target a specific vault by name or ID; when omitted the active vault in Obsidian is used.

**Example prompts:**
- *"Read my note on project planning"*
- *"Append today's meeting notes to my Daily Note"*
- *"List all tasks that are still open in my work vault"*
- *"Search my vault for anything about authentication"*

## Tools

35 tools across 9 categories:

### File operations

| Tool | Title | Effect |
|------|-------|--------|
| `read` | Read Note | Read note contents |
| `create` | Create Note | Create or overwrite a note |
| `append` | Append to Note | Append content to a note |
| `prepend` | Prepend to Note | Prepend content after frontmatter |
| `move` | Move Note | Move a note, updating internal links |
| `rename` | Rename Note | Rename a note in place |
| `delete` | Delete Note | Move to trash (or delete permanently) |
| `file_info` | File Info | Path, size, and timestamps |
| `files_list` | List Files | List files, filter by folder/extension |
| `folders_list` | List Folders | List folders |
| `open` | Open File | Open a file in Obsidian |

### Search

| Tool | Title | Effect |
|------|-------|--------|
| `search` | Search Vault | Full-text search, returns file paths |
| `search_context` | Search with Context | Grep-style search with matching lines |

### Navigation

| Tool | Title | Effect |
|------|-------|--------|
| `outline` | File Outline | Heading outline |
| `backlinks` | Backlinks | Files that link to a note |
| `links` | Outgoing Links | Links from a note |
| `orphans` | Orphan Notes | Files with no incoming links |

### Daily notes

| Tool | Title | Effect |
|------|-------|--------|
| `daily_read` | Read Daily Note | Read today's daily note |
| `daily_append` | Append to Daily Note | Append to today's daily note |
| `daily_prepend` | Prepend to Daily Note | Prepend to today's daily note |

### Tasks

| Tool | Title | Effect |
|------|-------|--------|
| `tasks_list` | List Tasks | List tasks vault-wide or in a file |
| `task_update` | Update Task | Toggle or set task status by line number |

### Tags & properties

| Tool | Title | Effect |
|------|-------|--------|
| `tags_list` | List Tags | Tags in vault or file |
| `properties_list` | List Properties | Frontmatter properties |
| `property_read` | Read Property | Read one frontmatter property |
| `property_set` | Set Property | Set a frontmatter property |
| `property_remove` | Remove Property | Remove a frontmatter property |

### Commands & vault info

| Tool | Title | Effect |
|------|-------|--------|
| `commands_list` | List Commands | Command palette entries |
| `command_execute` | Execute Command | Run a command palette command by ID |
| `vault_info` | Vault Info | Name, path, file count, size |
| `vaults_list` | List Vaults | All known vaults |
| `plugins_list` | List Plugins | Installed core and community plugins |

### Misc

| Tool | Title | Effect |
|------|-------|--------|
| `wordcount` | Word Count | Word and character count |
| `templates_list` | List Templates | Available templates |

### Escape hatch

| Tool | Title | Effect |
|------|-------|--------|
| `run` | Run CLI Command | Pass-through for any Obsidian CLI subcommand |

> `command_execute` and `run` carry `destructiveHint: true` because their side effects depend on which command is invoked.

## Authentication

This extension is **local-only** — no API keys, tokens, or OAuth flows are needed. It delegates entirely to the Obsidian CLI, which runs under your local user account.

## Privacy

All processing happens on your machine. No vault data is sent to any external server. See [PRIVACY.md](PRIVACY.md) for details.

## License

MIT — see [LICENSE](LICENSE).
