// Attachment classification and text reading for the composer.
//
// Two lanes, two destinations. Images go to Ollama as base64 in the `images`
// field (vision models only). Everything else is read here in the renderer and
// stored on the message as `{name, content}`, because Ollama's API has no
// generic file channel — a PDF or a CSV only reaches the model as text, and the
// extracted text is the only copy there is (a file picker never exposes a path).
//
// `buildAttachmentBlock` is what turns that stored text into the block the model
// sees, appended to the message by `getApiMessages`.

export const IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

// Matched by extension rather than MIME: most source files have no registered
// type, so `file.type` is empty for `.rs`, `.go` or `.py` and a MIME-only test
// would refuse exactly the files this is meant to accept.
const TEXT_EXTENSIONS = new Set([
  // prose
  "txt", "text", "md", "markdown", "mdx", "rst", "adoc", "org", "log",
  // data and config
  "csv", "tsv", "json", "jsonl", "ndjson", "yaml", "yml", "toml", "ini",
  "cfg", "conf", "env", "properties", "xml", "plist", "lock",
  // markup and style
  "html", "htm", "css", "scss", "sass", "less", "vue", "svelte", "astro",
  // code
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "py", "pyi", "rb", "rs", "go",
  "java", "kt", "kts", "scala", "swift", "m", "mm", "c", "h", "cc", "cpp",
  "cxx", "hpp", "hh", "cs", "fs", "php", "pl", "pm", "lua", "r", "jl", "dart",
  "ex", "exs", "erl", "hrl", "hs", "clj", "cljs", "cljc", "edn", "elm", "nim",
  "zig", "v", "groovy", "gradle", "sbt", "sql", "graphql", "gql", "proto",
  "tf", "hcl", "nix", "gitignore", "gitattributes", "dockerignore",
  "editorconfig", "npmrc", "prettierrc", "eslintrc", "babelrc",
  // shell
  "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd",
]);

// Names with no extension at all.
const SPECIAL_FILENAMES = new Set([
  "dockerfile",
  "makefile",
  "rakefile",
  "gemfile",
  "procfile",
  "justfile",
  "brewfile",
  "cmakelists.txt",
]);

// Per file and per message. A 100 KB text file is already ~25k tokens, so this
// is generous for a chat turn; the caps exist because the contents stay in the
// model's context for the rest of the conversation.
export const MAX_FILE_BYTES = 100_000;
export const MAX_TOTAL_BYTES = 200_000;

export const SUPPORTED_SUMMARY =
  "images, and text, code, CSV, JSON or Markdown files";

/** The `accept` attribute. Kept in step with the filter below by construction. */
export const ACCEPT_ATTRIBUTE = [
  ...IMAGE_TYPES,
  ...[...TEXT_EXTENSIONS].map((ext) => `.${ext}`),
].join(",");

const humanSize = (bytes) =>
  bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.round(bytes / 1000)} KB`;

function extensionOf(name) {
  const lower = String(name || "").toLowerCase();
  const dot = lower.lastIndexOf(".");
  // `.env`, `.gitignore` and `.env.local` are dotfiles, not extension-less
  // names, so they are read as `env`, `gitignore`, `env`.
  if (lower.startsWith(".")) return lower.slice(1).split(".")[0];
  return dot > 0 ? lower.slice(dot + 1) : "";
}

export function isTextFile(file) {
  const name = String(file?.name || "").toLowerCase();
  if (SPECIAL_FILENAMES.has(name)) return true;
  if (TEXT_EXTENSIONS.has(extensionOf(name))) return true;
  // A registered text MIME catches the odd extension not listed above.
  const type = file?.type || "";
  return (
    type.startsWith("text/") ||
    type === "application/json" ||
    type === "application/xml" ||
    type === "application/x-yaml"
  );
}

/** @returns {"image" | "text" | null} `null` means unsupported. */
export function attachmentKind(file) {
  if (!file) return null;
  if (IMAGE_TYPES.includes(file.type)) return "image";
  if (isTextFile(file)) return "text";
  return null;
}

export function unsupportedNotice(name) {
  return `Can't attach ${name || "that file"}: only ${SUPPORTED_SUMMARY} are supported.`;
}

/**
 * Why a file can't be attached, or `null` if it can. The size cap applies to
 * text only — images are already bounded by what a vision model can take.
 */
export function attachProblem(file) {
  const kind = attachmentKind(file);
  if (!kind) return unsupportedNotice(file?.name);
  if (kind === "text" && file.size > MAX_FILE_BYTES) {
    return `Can't attach ${file.name} (${humanSize(file.size)}): files over ${humanSize(MAX_FILE_BYTES)} aren't supported.`;
  }
  return null;
}

export function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(file);
  });
}

/** The per-turn system block for the files attached to one message. */
export function buildAttachmentBlock(files) {
  const parts = files.map((f) => `--- ${f.name} ---\n${f.content}`);
  return [
    "The user attached the following files to their message. Their contents are included below; use them to answer and do not say you cannot see them.",
    "",
    parts.join("\n\n"),
  ].join("\n");
}
