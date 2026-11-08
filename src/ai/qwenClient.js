const OLLAMA_BASE_URL = (
  process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
).replace(/\/v1\/?$/, '').replace(/\/$/, '');
const QWEN_MODEL = process.env.OLLAMA_MODEL ?? 'qwen3.5:latest';
const REQUEST_TIMEOUT_MS = 180000;

module.exports = {
  QWEN_MODEL,
  async qwenClient({
    messages,
    tools,
    tool_choice: toolChoice,
    temperature = 0.2,
  }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: QWEN_MODEL,
          messages,
          stream: false,
          think: false,
          options: { temperature },
          ...(tools ? { tools } : {}),
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const details = await response.text();
        throw new Error(`Ollama mengembalikan ${response.status}: ${details}`);
      }

      const result = await response.json();
      return result;
    } finally {
      clearTimeout(timeout);
    }
  },
};