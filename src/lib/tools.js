// Tool definitions in Ollama format.
// Each tool is { type: 'function', function: { name, description, parameters } }.
// The `parameters` is a JSON Schema object that tells the model what args
// to provide.
//
// For Phase 1a, we ship ONE tool: get_current_time. It's the canonical
// "hello world" for tool calling \u2014 trivial to verify, no network needed,
// proves the round-trip works end-to-end. Phase 1b will add web_search
// and web_fetch (the real research tools).

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
];

/**
 * Executes a tool by name. Returns a string result (which is appended
 * to the conversation as a `role: "tool"` message). On error, returns
 * a human-readable error string so the model can adapt.
 *
 * @param {string} name - tool name
 * @param {object} args - arguments from the model's tool_call
 * @returns {Promise<string>}
 */
export async function executeTool(name, args) {
  switch (name) {
    case "get_current_time": {
      const tz = args?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      const now = new Date();
      const iso = now.toISOString();
      const local = now.toLocaleString("en-US", { timeZone: tz });
      return JSON.stringify({
        timezone: tz,
        iso_utc: iso,
        local_time: local,
      });
    }
    default:
      return `Error: unknown tool "${name}"`;
  }
}
