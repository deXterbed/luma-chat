// Tool definitions in Ollama format.
// Each tool is { type: 'function', function: { name, description, parameters } }.
// The `parameters` is a JSON Schema object that tells the model what args
// to provide.
//
// Local tools (get_current_time) run in the renderer. Web tools
// (web_search, web_fetch) and the Codebase file tools (read_file, search_code,
// list_dir) run in the Tauri Rust backend via `@tauri-apps/api/core` invoke —
// this avoids CORS in the renderer and keeps network/parsing/file-access code
// in one auditable place.

import { useSettingsStore } from "../store/settingsStore";
import { useUiStore } from "../store/uiStore";

/** Tools that need the network and an explicit user toggle. */
export const WEB_TOOL_NAMES = ["web_search", "web_fetch"];
/** Tools that need an attached project root. */
export const FILE_TOOL_NAMES = ["read_file", "search_code", "list_dir"];

export const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_current_time",
      description:
        "Returns the current date and time in ISO 8601 format, plus the user's local timezone. Use this when the user asks about the current time, today's date, or anything time-sensitive.",
      parameters: {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description:
              "Optional IANA timezone name (e.g. 'America/New_York'). If omitted, uses the user's local timezone.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web for a query and return a list of relevant results. Each result has a title, URL, and short snippet. Use this when the user asks about something that may have changed recently, when you need to verify a claim, or when your training data may be out of date. After searching, consider using web_fetch to read the most promising result in full.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "The search query. Be specific — include key terms, names, dates. Examples: 'Rails 8 release notes', 'effects of microplastics on marine life 2024', 'who won the 2024 F1 championship'.",
          },
          max_results: {
            type: "number",
            description:
              "Maximum number of results to return. Defaults to 5. Range: 1-10. Use a higher number for broad research, lower for narrow lookups.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description:
        "Fetch the contents of a specific URL and return the main readable text. Use this after a web_search to read the most relevant result in full, or whenever the user gives you a URL. The result includes the page title, content (extracted as readable text), and any links found on the page.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description:
              "The URL to fetch. Must be a full URL including protocol (http:// or https://).",
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read a text file from the attached project folder. Paths are relative to the project root (e.g. src/lib/db.rs) — never absolute, never containing '..'. Output lines are numbered like `12→text`, so cite those numbers and use them to continue reading. A long result ends with a notice naming the next offset: keep going with it rather than answering from the part you have. Read a file before making claims about what it contains.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "File path relative to the project root, e.g. src/lib/db.rs or tauri/src/main.rs.",
          },
          offset: {
            type: "number",
            description:
              "1-based line number to start from. Defaults to 1. Use the offset a previous notice gave you to read on.",
          },
          limit: {
            type: "number",
            description: "Maximum lines to return, up to 2000. Defaults to 2000.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_code",
      description:
        "Search the attached project's files for a string and return matches as path:line:text. Literal by default — 'user.name' matches exactly that text; set regex=true only when you mean a real regular expression. One good use of regex is to outline a file instead of reading it whole: an anchored pattern for the definitions you want — in Ruby, lines beginning with class, module, def, has_many or belongs_to — returns just those lines with their numbers, so you can read single ranges rather than the whole file. Use output=\"files\" to get just the matching file names, or output=\"count\" for a per-file tally — both are the cheap way to find where something lives before reading it. Files ignored by .gitignore are skipped unless no_ignore=true. Search instead of guessing at paths.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "What to look for. Treated as literal text unless regex=true.",
          },
          path: {
            type: "string",
            description:
              "Optional subdirectory or file to search inside, relative to the project root. Defaults to the whole project.",
          },
          glob: {
            type: "string",
            description: 'Optional file filter, e.g. "*.rs" or "src/**/*.ts".',
          },
          output: {
            type: "string",
            description:
              '"content" (default) returns matching lines, "files" returns which files matched, "count" returns a per-file match tally.',
          },
          regex: {
            type: "boolean",
            description:
              "Treat query as a regular expression. Default false (literal).",
          },
          no_ignore: {
            type: "boolean",
            description:
              "Also search files ignored by .gitignore — which means node_modules, build output and other large ignored trees. Only set this if an ordinary search found nothing you expected; a wide ignored search is slow and its results are dominated by dependencies. Default false.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description:
        "List what is in a directory of the attached project — directories first, then files, with symlinks marked '@'. Use it to orient yourself before reading, or to check a path the user mentioned. Paths are relative to the project root; omit path for the project root itself.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Directory path relative to the project root. Defaults to the project root.",
          },
        },
        required: [],
      },
    },
  },
];

/**
 * Executes a tool by name. Returns a string result (which is appended
 * to the conversation as a `role: "tool"` message). On error, returns
 * a human-readable error string so the model can adapt its response.
 *
 * @param {string} name - tool name
 * @param {object} args - arguments from the model's tool_call
 * @param {object} [context] - renderer-side context the model can't supply:
 *   `roots` (the attached project folders) for the Codebase file tools.
 * @returns {Promise<string>}
 */
export async function executeTool(name, args, context = {}) {
  switch (name) {
    case "get_current_time": {
      const tz =
        args?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      const now = new Date();
      const iso = now.toISOString();
      const local = now.toLocaleString("en-US", { timeZone: tz });
      return JSON.stringify({
        timezone: tz,
        iso_utc: iso,
        local_time: local,
      });
    }
    case "web_search": {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const { provider, apiKey } = getSearchConfig();
        const result = await invoke("web_search", {
          query: args?.query || "",
          maxResults: args?.max_results ?? 5,
          provider,
          apiKey,
        });
        raiseQuotaNoticeIfNeeded(result);
        return result;
      } catch {
        return "Error: web tools are not available in this environment";
      }
    }
    case "web_fetch": {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const { provider, apiKey } = getSearchConfig();
        const result = await invoke("web_fetch", {
          url: args?.url || "",
          provider,
          apiKey,
        });
        raiseQuotaNoticeIfNeeded(result);
        return result;
      } catch {
        return "Error: web tools are not available in this environment";
      }
    }
    case "read_file": {
      const path = toText(args?.path).trim();
      if (!path) {
        return "No path given — read_file needs a file path relative to the project root.";
      }
      return fileTool("read_file", {
        roots: context.roots,
        path,
        offset: toPositiveInt(args?.offset),
        limit: toPositiveInt(args?.limit),
      });
    }
    case "search_code": {
      const query = toText(args?.query);
      if (!query.trim()) {
        return "No query given — search_code needs a string to look for.";
      }
      const output = toText(args?.output).trim().toLowerCase();
      return fileTool("search_code", {
        roots: context.roots,
        query,
        path: toText(args?.path).trim() || undefined,
        glob: toText(args?.glob).trim() || undefined,
        output: ["content", "files", "count"].includes(output)
          ? output
          : undefined,
        regex: toBool(args?.regex),
        noIgnore: toBool(args?.no_ignore ?? args?.noIgnore),
      });
    }
    case "list_dir":
      return fileTool("list_dir", {
        roots: context.roots,
        path: toText(args?.path).trim() || undefined,
      });
    default:
      return `Error: unknown tool "${name}"`;
  }
}

// The file tools are read-only and root-bounded in Rust. An empty `roots` means
// no folder is attached — the tools shouldn't have been offered, so say so
// plainly rather than letting Rust report a missing root.
async function fileTool(command, payload) {
  if (!Array.isArray(payload.roots) || payload.roots.length === 0) {
    return "No project folder is attached to this chat, so file tools are unavailable. Ask the user to attach one.";
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke(command, payload);
  } catch (err) {
    // A transport/IPC failure is a real infrastructure error, so it keeps the
    // `Error:` prefix. Everything the model can fix comes back from Rust as a
    // plain observation instead — see `tools/fs.rs`, where that convention is
    // load-bearing for the loop's `allFailed` check.
    return `Error: file tools unavailable (${err?.message ?? err})`;
  }
}

// Weak models routinely send numbers as strings ("limit": "50") and booleans as
// strings ("regex": "true"). A type mismatch fails the whole invoke, and a
// failed call counts as a failed tool round in the loop policy — so coerce at
// this boundary rather than let a formatting slip end the session.
function toPositiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function toBool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return false;
}

function toText(value) {
  if (typeof value === "string") return value;
  return value == null ? "" : String(value);
}

// Read the current web-search backend + key from settings. The Rust side
// falls back to the OLLAMA_API_KEY env var when apiKey is blank.
function getSearchConfig() {
  const { searchProvider, ollamaApiKey } = useSettingsStore.getState();
  return { provider: searchProvider, apiKey: ollamaApiKey };
}

// Ollama web tools tag quota/auth failures with a leading "Error: QUOTA:".
// Surface those as a dismissible app-wide banner so the user can upgrade or
// switch back to DuckDuckGo, rather than the error hiding in a tool record.
function raiseQuotaNoticeIfNeeded(result) {
  if (typeof result !== "string" || !result.startsWith("Error: QUOTA:")) return;
  useUiStore
    .getState()
    .setWebSearchNotice(result.replace("Error: QUOTA:", "").trim());
}
