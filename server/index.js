#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
import { existsSync } from "fs";
import { homedir } from "os";

// stderr-only log for pre-connection startup messages (stdio transport: stderr is captured by host)
function startupLog(level, data) {
  process.stderr.write(`[obsidian-mcp] ${level} ${typeof data === "string" ? data : JSON.stringify(data)}\n`);
}

// Try well-known install locations so the binary is found even when
// /usr/local/bin is absent from the PATH inherited by the MCP process.
function findObsidianBin() {
  if (process.platform === "win32") return "obsidian.exe";
  const candidates = [
    "/usr/local/bin/obsidian",                                // macOS symlink (default)
    `${homedir()}/.local/bin/obsidian`,                       // Linux
    "/Applications/Obsidian.app/Contents/MacOS/obsidian-cli", // macOS app bundle fallback
  ];
  for (const c of candidates) {
    const found = existsSync(c);
    startupLog("debug", { event: "candidate_check", path: c, found });
    if (found) return c;
  }
  startupLog("debug", { event: "candidate_check", fallback: "obsidian", reason: "no candidate found" });
  return "obsidian"; // last resort: rely on PATH
}

const OBSIDIAN_BIN = findObsidianBin();
startupLog("info", { event: "startup", binary: OBSIDIAN_BIN, platform: process.platform });

async function runObsidian(args) {
  const start = Date.now();
  await server.sendLoggingMessage({ level: "debug", data: { event: "exec", binary: OBSIDIAN_BIN, args } });
  try {
    const { stdout } = await execFileAsync(OBSIDIAN_BIN, args, {
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    });
    await server.sendLoggingMessage({ level: "debug", data: { event: "exec_ok", args, bytes: stdout.length, ms: Date.now() - start } });
    return stdout.trim();
  } catch (err) {
    await server.sendLoggingMessage({ level: "error", data: { event: "exec_error", args, code: err.code, message: err.message, ms: Date.now() - start } });
    if (err.code === "ENOENT" || err.message?.includes("ENOENT")) {
      throw new Error(
        `Obsidian CLI not found (tried: ${OBSIDIAN_BIN}). ` +
        "Enable it in Obsidian → Settings → General → Enable CLI, " +
        "then ensure the binary is on your PATH (macOS: /usr/local/bin/obsidian, Linux: ~/.local/bin/obsidian)."
      );
    }
    if (err.code === "ETIMEDOUT") {
      throw new Error("Obsidian CLI timed out. Make sure Obsidian is running and the vault is open.");
    }
    // Some CLI commands exit non-zero but still write useful stdout
    const out = err.stdout?.trim();
    if (out) return out;
    throw new Error(err.stderr?.trim() || err.message || `obsidian ${args.join(" ")} failed`);
  }
}

// Build the flat args array the CLI expects:
//   obsidian [vault=<v>] <command> [key=value ...] [flag ...]
function args(command, params = {}, flags = [], vault) {
  const a = [];
  if (vault) a.push(`vault=${vault}`);
  a.push(command);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      a.push(`${k}=${v}`);
    }
  }
  for (const f of flags) {
    if (f) a.push(String(f));
  }
  return a;
}

// ─── Tool definitions ────────────────────────────────────────────────────────

// Annotation shorthands
const RO  = { readOnlyHint: true,  openWorldHint: true };                          // safe read
const MUT = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };  // write, non-destructive
const DEL = { readOnlyHint: false, destructiveHint: true,  openWorldHint: true };  // destructive
const UNK = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };    // arbitrary/unknown side-effects

const TOOLS = [
  // ── Files ──
  {
    name: "read",
    description: "Read the contents of a note (defaults to active file).",
    annotations: { title: "Read Note", ...RO },
    inputSchema: {
      type: "object",
      properties: {
        vault: { type: "string", description: "Target vault name or ID" },
        file:  { type: "string", description: "File name (wikilink resolution)" },
        path:  { type: "string", description: "Exact path from vault root" },
      },
    },
  },
  {
    name: "create",
    description: "Create or overwrite a note.",
    annotations: { title: "Create Note", ...MUT },
    inputSchema: {
      type: "object",
      properties: {
        vault:     { type: "string" },
        name:      { type: "string", description: "New file name" },
        path:      { type: "string", description: "New file path from vault root" },
        content:   { type: "string", description: "Initial content (use \\n for newlines)" },
        template:  { type: "string", description: "Template name to use" },
        overwrite: { type: "boolean", description: "Overwrite if file exists" },
        open:      { type: "boolean", description: "Open after creating" },
      },
    },
  },
  {
    name: "append",
    description: "Append content to a note (defaults to active file).",
    annotations: { title: "Append to Note", ...MUT },
    inputSchema: {
      type: "object",
      required: ["content"],
      properties: {
        vault:   { type: "string" },
        file:    { type: "string" },
        path:    { type: "string" },
        content: { type: "string", description: "Text to append" },
        inline:  { type: "boolean", description: "Append without leading newline" },
      },
    },
  },
  {
    name: "prepend",
    description: "Prepend content after frontmatter (defaults to active file).",
    annotations: { title: "Prepend to Note", ...MUT },
    inputSchema: {
      type: "object",
      required: ["content"],
      properties: {
        vault:   { type: "string" },
        file:    { type: "string" },
        path:    { type: "string" },
        content: { type: "string" },
        inline:  { type: "boolean" },
      },
    },
  },
  {
    name: "move",
    description: "Move or rename a note, updating internal links automatically.",
    annotations: { title: "Move Note", ...DEL },
    inputSchema: {
      type: "object",
      required: ["to"],
      properties: {
        vault: { type: "string" },
        file:  { type: "string" },
        path:  { type: "string" },
        to:    { type: "string", description: "Destination folder or full path" },
      },
    },
  },
  {
    name: "rename",
    description: "Rename a note in place (extension preserved if omitted).",
    annotations: { title: "Rename Note", ...DEL },
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        vault: { type: "string" },
        file:  { type: "string" },
        path:  { type: "string" },
        name:  { type: "string", description: "New file name" },
      },
    },
  },
  {
    name: "delete",
    description: "Delete a note (moves to trash by default).",
    annotations: { title: "Delete Note", ...DEL, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        vault:     { type: "string" },
        file:      { type: "string" },
        path:      { type: "string" },
        permanent: { type: "boolean", description: "Skip trash and delete permanently" },
      },
    },
  },
  {
    name: "file_info",
    description: "Get metadata for a file: path, size, created/modified timestamps.",
    annotations: { title: "File Info", ...RO },
    inputSchema: {
      type: "object",
      properties: {
        vault: { type: "string" },
        file:  { type: "string" },
        path:  { type: "string" },
      },
    },
  },
  {
    name: "files_list",
    description: "List files in the vault, optionally filtered by folder or extension. Use the folder or ext parameters to narrow results; use total:true to get a count without listing every file.",
    annotations: { title: "List Files", ...RO },
    inputSchema: {
      type: "object",
      properties: {
        vault:  { type: "string" },
        folder: { type: "string", description: "Filter by folder path" },
        ext:    { type: "string", description: "Filter by extension (e.g. md)" },
        total:  { type: "boolean", description: "Return count only" },
      },
    },
  },
  {
    name: "folders_list",
    description: "List folders in the vault.",
    annotations: { title: "List Folders", ...RO },
    inputSchema: {
      type: "object",
      properties: {
        vault:  { type: "string" },
        folder: { type: "string", description: "Filter by parent folder" },
        total:  { type: "boolean" },
      },
    },
  },
  {
    name: "open",
    description: "Open a file in Obsidian.",
    annotations: { title: "Open File", ...MUT },
    inputSchema: {
      type: "object",
      properties: {
        vault:  { type: "string" },
        file:   { type: "string" },
        path:   { type: "string" },
        newtab: { type: "boolean" },
      },
    },
  },
  // ── Search ──
  {
    name: "search",
    description: "Search the vault for text; returns matching file paths.",
    annotations: { title: "Search Vault", ...RO },
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        vault:  { type: "string" },
        query:  { type: "string", description: "Search query" },
        path:   { type: "string", description: "Limit search to folder" },
        limit:  { type: "number", description: "Max files to return" },
        format: { type: "string", enum: ["text", "json"], default: "text" },
        total:  { type: "boolean" },
        case:   { type: "boolean", description: "Case sensitive" },
      },
    },
  },
  {
    name: "search_context",
    description: "Search vault with matching line context (grep-style path:line:text output). Prefer setting a limit to avoid large responses on big vaults.",
    annotations: { title: "Search with Context", ...RO },
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        vault:  { type: "string" },
        query:  { type: "string" },
        path:   { type: "string" },
        limit:  { type: "number" },
        format: { type: "string", enum: ["text", "json"] },
        case:   { type: "boolean" },
      },
    },
  },
  // ── Outline / Links ──
  {
    name: "outline",
    description: "Show heading outline for a file.",
    annotations: { title: "File Outline", ...RO },
    inputSchema: {
      type: "object",
      properties: {
        vault:  { type: "string" },
        file:   { type: "string" },
        path:   { type: "string" },
        format: { type: "string", enum: ["tree", "md", "json"] },
        total:  { type: "boolean" },
      },
    },
  },
  {
    name: "backlinks",
    description: "List files that link to a note (defaults to active file).",
    annotations: { title: "Backlinks", ...RO },
    inputSchema: {
      type: "object",
      properties: {
        vault:  { type: "string" },
        file:   { type: "string" },
        path:   { type: "string" },
        counts: { type: "boolean" },
        total:  { type: "boolean" },
        format: { type: "string", enum: ["json", "tsv", "csv"] },
      },
    },
  },
  {
    name: "links",
    description: "List outgoing links from a note (defaults to active file).",
    annotations: { title: "Outgoing Links", ...RO },
    inputSchema: {
      type: "object",
      properties: {
        vault: { type: "string" },
        file:  { type: "string" },
        path:  { type: "string" },
        total: { type: "boolean" },
      },
    },
  },
  {
    name: "orphans",
    description: "List files with no incoming links.",
    annotations: { title: "Orphan Notes", ...RO },
    inputSchema: {
      type: "object",
      properties: {
        vault: { type: "string" },
        total: { type: "boolean" },
      },
    },
  },
  // ── Daily notes ──
  {
    name: "daily_read",
    description: "Read today's daily note.",
    annotations: { title: "Read Daily Note", ...RO },
    inputSchema: {
      type: "object",
      properties: {
        vault: { type: "string" },
      },
    },
  },
  {
    name: "daily_append",
    description: "Append content to today's daily note.",
    annotations: { title: "Append to Daily Note", ...MUT },
    inputSchema: {
      type: "object",
      required: ["content"],
      properties: {
        vault:   { type: "string" },
        content: { type: "string" },
        inline:  { type: "boolean" },
        open:    { type: "boolean" },
      },
    },
  },
  {
    name: "daily_prepend",
    description: "Prepend content to today's daily note.",
    annotations: { title: "Prepend to Daily Note", ...MUT },
    inputSchema: {
      type: "object",
      required: ["content"],
      properties: {
        vault:   { type: "string" },
        content: { type: "string" },
        inline:  { type: "boolean" },
        open:    { type: "boolean" },
      },
    },
  },
  // ── Tasks ──
  {
    name: "tasks_list",
    description: "List tasks in the vault or a specific file. Scope to a file or use total:true to get a count when the full list is not needed.",
    annotations: { title: "List Tasks", ...RO },
    inputSchema: {
      type: "object",
      properties: {
        vault:   { type: "string" },
        file:    { type: "string" },
        path:    { type: "string" },
        done:    { type: "boolean", description: "Show only completed tasks" },
        todo:    { type: "boolean", description: "Show only incomplete tasks" },
        daily:   { type: "boolean", description: "Show tasks from daily note" },
        verbose: { type: "boolean", description: "Group by file with line numbers" },
        total:   { type: "boolean" },
        format:  { type: "string", enum: ["json", "tsv", "csv", "text"] },
        status:  { type: "string", description: "Filter by status character" },
      },
    },
  },
  {
    name: "task_update",
    description: "Toggle or set the status of a task by file and line number.",
    annotations: { title: "Update Task", ...MUT, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        vault:  { type: "string" },
        file:   { type: "string" },
        path:   { type: "string" },
        line:   { type: "number", description: "Line number of the task" },
        ref:    { type: "string", description: "Task reference as path:line" },
        toggle: { type: "boolean", description: "Toggle done/undone" },
        done:   { type: "boolean", description: "Mark as done [x]" },
        todo:   { type: "boolean", description: "Mark as todo [ ]" },
        status: { type: "string", description: "Set custom status character" },
        daily:  { type: "boolean", description: "Target daily note" },
      },
    },
  },
  // ── Tags ──
  {
    name: "tags_list",
    description: "List tags in the vault or a specific file.",
    annotations: { title: "List Tags", ...RO },
    inputSchema: {
      type: "object",
      properties: {
        vault:  { type: "string" },
        file:   { type: "string" },
        path:   { type: "string" },
        counts: { type: "boolean" },
        total:  { type: "boolean" },
        format: { type: "string", enum: ["json", "tsv", "csv"] },
        active: { type: "boolean", description: "Show tags for active file" },
      },
    },
  },
  // ── Properties ──
  {
    name: "properties_list",
    description: "List frontmatter properties in the vault or a specific file.",
    annotations: { title: "List Properties", ...RO },
    inputSchema: {
      type: "object",
      properties: {
        vault:  { type: "string" },
        file:   { type: "string" },
        path:   { type: "string" },
        counts: { type: "boolean" },
        total:  { type: "boolean" },
        format: { type: "string", enum: ["yaml", "json", "tsv"] },
        active: { type: "boolean" },
      },
    },
  },
  {
    name: "property_read",
    description: "Read a specific frontmatter property from a file.",
    annotations: { title: "Read Property", ...RO },
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        vault: { type: "string" },
        name:  { type: "string", description: "Property name" },
        file:  { type: "string" },
        path:  { type: "string" },
      },
    },
  },
  {
    name: "property_set",
    description: "Set a frontmatter property on a file.",
    annotations: { title: "Set Property", ...MUT, idempotentHint: true },
    inputSchema: {
      type: "object",
      required: ["name", "value"],
      properties: {
        vault: { type: "string" },
        name:  { type: "string" },
        value: { type: "string" },
        type:  { type: "string", enum: ["text", "list", "number", "checkbox", "date", "datetime"] },
        file:  { type: "string" },
        path:  { type: "string" },
      },
    },
  },
  {
    name: "property_remove",
    description: "Remove a frontmatter property from a file.",
    annotations: { title: "Remove Property", ...DEL, idempotentHint: true },
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        vault: { type: "string" },
        name:  { type: "string" },
        file:  { type: "string" },
        path:  { type: "string" },
      },
    },
  },
  // ── Command palette ──
  {
    name: "commands_list",
    description: "List available Obsidian command palette commands.",
    annotations: { title: "List Commands", ...RO },
    inputSchema: {
      type: "object",
      properties: {
        vault:  { type: "string" },
        filter: { type: "string", description: "Filter by ID prefix" },
      },
    },
  },
  {
    name: "command_execute",
    description: "Execute an Obsidian command palette command by ID.",
    annotations: { title: "Execute Command", ...UNK },
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        vault: { type: "string" },
        id:    { type: "string", description: "Command ID" },
      },
    },
  },
  // ── Vault / plugins ──
  {
    name: "vault_info",
    description: "Show vault name, path, file count, and size.",
    annotations: { title: "Vault Info", ...RO },
    inputSchema: {
      type: "object",
      properties: {
        vault: { type: "string" },
        info:  { type: "string", enum: ["name", "path", "files", "folders", "size"] },
      },
    },
  },
  {
    name: "vaults_list",
    description: "List all known Obsidian vaults.",
    annotations: { title: "List Vaults", ...RO },
    inputSchema: {
      type: "object",
      properties: {
        verbose: { type: "boolean", description: "Include vault paths" },
        total:   { type: "boolean" },
      },
    },
  },
  {
    name: "plugins_list",
    description: "List installed plugins.",
    annotations: { title: "List Plugins", ...RO },
    inputSchema: {
      type: "object",
      properties: {
        vault:    { type: "string" },
        filter:   { type: "string", enum: ["core", "community"] },
        versions: { type: "boolean" },
        format:   { type: "string", enum: ["json", "tsv", "csv"] },
      },
    },
  },
  // ── Wordcount / templates ──
  {
    name: "wordcount",
    description: "Count words and characters in a file (defaults to active file).",
    annotations: { title: "Word Count", ...RO },
    inputSchema: {
      type: "object",
      properties: {
        vault:      { type: "string" },
        file:       { type: "string" },
        path:       { type: "string" },
        words:      { type: "boolean", description: "Return word count only" },
        characters: { type: "boolean", description: "Return character count only" },
      },
    },
  },
  {
    name: "templates_list",
    description: "List available templates.",
    annotations: { title: "List Templates", ...RO },
    inputSchema: {
      type: "object",
      properties: {
        vault: { type: "string" },
        total: { type: "boolean" },
      },
    },
  },
  // ── Generic escape hatch ──
  {
    name: "run",
    description: "Run any Obsidian CLI command directly. Use for commands not covered by dedicated tools (e.g. eval, devtools, diff, sync, publish).",
    annotations: { title: "Run CLI Command", ...UNK },
    inputSchema: {
      type: "object",
      required: ["command"],
      properties: {
        vault:   { type: "string" },
        command: { type: "string", description: "CLI subcommand (e.g. 'eval', 'diff', 'sync:status')" },
        params:  {
          type: "object",
          description: "Key/value parameters (e.g. {\"code\": \"app.vault.getFiles().length\"})",
          additionalProperties: { type: "string" },
        },
        flags: {
          type: "array",
          description: "Boolean flags to pass (e.g. [\"total\", \"verbose\"])",
          items: { type: "string" },
        },
      },
    },
  },
];

// ─── Handler ─────────────────────────────────────────────────────────────────

async function handleTool(name, input) {
  const { vault, ...rest } = input ?? {};

  switch (name) {
    // Files
    case "read":
      return runObsidian(args("read", pick(rest, ["file", "path"]), [], vault));
    case "create": {
      const flags = boolFlags(rest, ["overwrite", "open"]);
      return runObsidian(args("create", pick(rest, ["name", "path", "content", "template"]), flags, vault));
    }
    case "append": {
      const flags = boolFlags(rest, ["inline"]);
      return runObsidian(args("append", pick(rest, ["file", "path", "content"]), flags, vault));
    }
    case "prepend": {
      const flags = boolFlags(rest, ["inline"]);
      return runObsidian(args("prepend", pick(rest, ["file", "path", "content"]), flags, vault));
    }
    case "move":
      return runObsidian(args("move", pick(rest, ["file", "path", "to"]), [], vault));
    case "rename":
      return runObsidian(args("rename", pick(rest, ["file", "path", "name"]), [], vault));
    case "delete": {
      const flags = boolFlags(rest, ["permanent"]);
      return runObsidian(args("delete", pick(rest, ["file", "path"]), flags, vault));
    }
    case "file_info":
      return runObsidian(args("file", pick(rest, ["file", "path"]), [], vault));
    case "files_list": {
      const flags = boolFlags(rest, ["total"]);
      return runObsidian(args("files", pick(rest, ["folder", "ext"]), flags, vault));
    }
    case "folders_list": {
      const flags = boolFlags(rest, ["total"]);
      return runObsidian(args("folders", pick(rest, ["folder"]), flags, vault));
    }
    case "open": {
      const flags = boolFlags(rest, ["newtab"]);
      return runObsidian(args("open", pick(rest, ["file", "path"]), flags, vault));
    }

    // Search
    case "search": {
      const flags = boolFlags(rest, ["total", "case"]);
      return runObsidian(args("search", pick(rest, ["query", "path", "limit", "format"]), flags, vault));
    }
    case "search_context": {
      const flags = boolFlags(rest, ["case"]);
      return runObsidian(args("search:context", pick(rest, ["query", "path", "limit", "format"]), flags, vault));
    }

    // Outline / links
    case "outline": {
      const flags = boolFlags(rest, ["total"]);
      return runObsidian(args("outline", pick(rest, ["file", "path", "format"]), flags, vault));
    }
    case "backlinks": {
      const flags = boolFlags(rest, ["counts", "total"]);
      return runObsidian(args("backlinks", pick(rest, ["file", "path", "format"]), flags, vault));
    }
    case "links": {
      const flags = boolFlags(rest, ["total"]);
      return runObsidian(args("links", pick(rest, ["file", "path"]), flags, vault));
    }
    case "orphans": {
      const flags = boolFlags(rest, ["total"]);
      return runObsidian(args("orphans", {}, flags, vault));
    }

    // Daily
    case "daily_read":
      return runObsidian(args("daily:read", {}, [], vault));
    case "daily_append": {
      const flags = boolFlags(rest, ["inline", "open"]);
      return runObsidian(args("daily:append", pick(rest, ["content"]), flags, vault));
    }
    case "daily_prepend": {
      const flags = boolFlags(rest, ["inline", "open"]);
      return runObsidian(args("daily:prepend", pick(rest, ["content"]), flags, vault));
    }

    // Tasks
    case "tasks_list": {
      const flags = boolFlags(rest, ["done", "todo", "daily", "verbose", "total"]);
      return runObsidian(args("tasks", pick(rest, ["file", "path", "status", "format"]), flags, vault));
    }
    case "task_update": {
      const flags = boolFlags(rest, ["toggle", "done", "todo", "daily"]);
      return runObsidian(args("task", pick(rest, ["file", "path", "line", "ref", "status"]), flags, vault));
    }

    // Tags
    case "tags_list": {
      const flags = boolFlags(rest, ["counts", "total", "active"]);
      return runObsidian(args("tags", pick(rest, ["file", "path", "format"]), flags, vault));
    }

    // Properties
    case "properties_list": {
      const flags = boolFlags(rest, ["counts", "total", "active"]);
      return runObsidian(args("properties", pick(rest, ["file", "path", "format"]), flags, vault));
    }
    case "property_read":
      return runObsidian(args("property:read", pick(rest, ["name", "file", "path"]), [], vault));
    case "property_set":
      return runObsidian(args("property:set", pick(rest, ["name", "value", "type", "file", "path"]), [], vault));
    case "property_remove":
      return runObsidian(args("property:remove", pick(rest, ["name", "file", "path"]), [], vault));

    // Commands
    case "commands_list":
      return runObsidian(args("commands", pick(rest, ["filter"]), [], vault));
    case "command_execute":
      return runObsidian(args("command", pick(rest, ["id"]), [], vault));

    // Vault / plugins
    case "vault_info":
      return runObsidian(args("vault", pick(rest, ["info"]), [], vault));
    case "vaults_list": {
      const flags = boolFlags(rest, ["verbose", "total"]);
      return runObsidian(args("vaults", {}, flags));
    }
    case "plugins_list": {
      const flags = boolFlags(rest, ["versions"]);
      return runObsidian(args("plugins", pick(rest, ["filter", "format"]), flags, vault));
    }

    // Misc
    case "wordcount": {
      const flags = boolFlags(rest, ["words", "characters"]);
      return runObsidian(args("wordcount", pick(rest, ["file", "path"]), flags, vault));
    }
    case "templates_list": {
      const flags = boolFlags(rest, ["total"]);
      return runObsidian(args("templates", {}, flags, vault));
    }

    // Generic
    case "run":
      return runObsidian(args(rest.command, rest.params ?? {}, rest.flags ?? [], vault));

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

function boolFlags(obj, keys) {
  return keys.filter(k => obj[k] === true);
}

// ─── Server bootstrap ────────────────────────────────────────────────────────

const server = new Server(
  { name: "obsidian-cli", version: "0.1.0" },
  { capabilities: { tools: {}, logging: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: input } = request.params;
  const start = Date.now();
  await server.sendLoggingMessage({ level: "info", data: { event: "tool_call", tool: name } });
  try {
    const output = await handleTool(name, input);
    await server.sendLoggingMessage({ level: "info", data: { event: "tool_ok", tool: name, ms: Date.now() - start } });
    return {
      content: [{ type: "text", text: output || "(no output)" }],
    };
  } catch (err) {
    await server.sendLoggingMessage({ level: "error", data: { event: "tool_error", tool: name, message: err.message, ms: Date.now() - start } });
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
await server.sendLoggingMessage({ level: "info", data: { event: "initialized", binary: OBSIDIAN_BIN, platform: process.platform } });
