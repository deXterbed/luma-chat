// Tool definitions in Ollama format.
// Each tool is { type: 'function', function: { name, description, parameters } }.
// The `parameters` is a JSON Schema object that tells the model what args
// to provide.
//
// Local tools (get_current_time) run in the renderer. Web tools
// (web_search, web_fetch) run in the Electron main process via the
// `window.webTools` bridge exposed by preload.js — this avoids CORS
// in the renderer and keeps network/parsing code in one auditable place.

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
];

/**
 * Executes a tool by name. Returns a string result (which is appended
 * to the conversation as a `role: "tool"` message). On error, returns
 * a human-readable error string so the model can adapt its response.
 *
 * @param {string} name - tool name
 * @param {object} args - arguments from the model's tool_call
 * @returns {Promise<string>}
 */
export async function executeTool(name, args) {
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
      if (!window.webTools) {
        return "Error: web tools are not available in this environment";
      }
      return await window.webTools.search(
        args?.query || "",
        args?.max_results || 5,
      );
    }
    case "web_fetch": {
      if (!window.webTools) {
        return "Error: web tools are not available in this environment";
      }
      return await window.webTools.fetch(args?.url || "");
    }
    default:
      return `Error: unknown tool "${name}"`;
  }
}
