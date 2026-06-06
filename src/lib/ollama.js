// Ollama API wrapper with streaming + cloud model support
// Cloud models (e.g. minimax-m3:cloud) route via Ollama Pro subscription

const OLLAMA_BASE = "http://localhost:11434";

/**
 * Check if the Ollama server is reachable.
 * Uses /api/version which returns 200 regardless of whether any
 * models are pulled locally — /api/tags returns an empty list in
 * that case, which used to cause a false "offline" status.
 */
export async function isOllamaReachable() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/version`);
    return res.ok;
  } catch {
    return false;
  }
}

// Convert File to base64 for vision models
export async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Check if model supports vision
export function isVisionModel(modelName) {
  const visionModels = [
    "minimax",
    "qwen2.5vl",
    "qwen2-vl",
    "llava",
    "llava-phi3",
    "moondream",
    "bakllava",
    "minicpm-v",
    "cogvlm",
    "internvl",
    "gemma3",
    "phi3.5-vision",
    "pixtral",
  ];
  const lower = modelName.toLowerCase();
  return visionModels.some((v) => lower.includes(v));
}

/**
 * Stream a chat completion from Ollama
 * @param {object} params
 * @param {string} params.model
 * @param {Array} params.messages  - [{role, content, images?}]
 * @param {function} params.onToken - called with each text chunk
 * @param {function} params.onDone  - called when stream ends
 * @param {AbortSignal} params.signal
 */
export async function streamChat({ model, messages, onToken, onDone, signal }) {
  const body = {
    model,
    messages,
    stream: true,
    options: {
      temperature: 0.7,
    },
  };

  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama error: ${err}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        if (json.message?.content) {
          fullText += json.message.content;
          onToken(json.message.content, fullText);
        }
        if (json.done) {
          onDone(fullText);
          return;
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  onDone(fullText);
}
