const OPENAI_BASE_URL = (
	process.env.OPENAI_BASE_URL ??
	process.env.OLLAMA_BASE_URL ??
	'http://localhost:11434/v1'
)
	.replace(/\/$/, '')
	.replace(/\/chat\/completions$/, '')
	.replace(/\/api$/, '');

const BASE_URL = /\/v1$/.test(OPENAI_BASE_URL)
	? OPENAI_BASE_URL
	: `${OPENAI_BASE_URL}/v1`;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
const QWEN_MODEL =
	process.env.OPENAI_MODEL ?? process.env.OLLAMA_MODEL ?? 'qwen3.5:latest';
const REQUEST_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS ?? 180000);

function parseToolCalls(message) {
	return (message?.tool_calls ?? []).map((call) => {
		let args = call.function?.arguments ?? {};
		if (typeof args === 'string') {
			try {
				args = args.trim() ? JSON.parse(args) : {};
			} catch {
				args = {};
			}
		}
		return { id: call.id, name: call.function?.name, arguments: args };
	});
}

function normalizeMessages(messages = []) {
	let counter = 0;
	const pendingIds = [];

	return messages.map((m) => {
		if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
			return {
				...m,
				content: m.content ?? '',
				tool_calls: m.tool_calls.map((tc) => {
					const id = tc.id ?? `call_${Date.now()}_${counter++}`;
					pendingIds.push(id);
					const args = tc.function?.arguments;
					return {
						id,
						type: 'function',
						function: {
							name: tc.function?.name,
							arguments:
								typeof args === 'string'
									? args
									: JSON.stringify(args ?? {}),
						},
					};
				}),
			};
		}

		if (m.role === 'tool') {
			const { tool_name, name, ...rest } = m;
			return {
				...rest,
				tool_call_id:
					m.tool_call_id ?? pendingIds.shift() ?? `call_${counter++}`,
				content:
					typeof m.content === 'string'
						? m.content
						: JSON.stringify(m.content),
			};
		}

		return m;
	});
}

module.exports = {
	QWEN_MODEL,
	parseToolCalls,

	async qwenClient({
		messages,
		tools,
		tool_choice: toolChoice,
		temperature = 0.2,
		max_tokens,
		response_format,
	}) {
		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(),
			REQUEST_TIMEOUT_MS,
		);

		try {
			const headers = { 'Content-Type': 'application/json' };
			if (OPENAI_API_KEY)
				headers.Authorization = `Bearer ${OPENAI_API_KEY}`;

			const response = await fetch(`${BASE_URL}/chat/completions`, {
				method: 'POST',
				headers,
				body: JSON.stringify({
					model: QWEN_MODEL,
					messages: normalizeMessages(messages),
					temperature,
					stream: false,
					...(max_tokens ? { max_tokens } : {}),
					...(response_format ? { response_format } : {}),
					...(tools?.length ? { tools } : {}),
					...(tools?.length && toolChoice
						? { tool_choice: toolChoice }
						: {}),
				}),
				signal: controller.signal,
			});

			if (!response.ok) {
				const details = await response.text();
				throw new Error(
					`OpenAI-compatible endpoint mengembalikan ${response.status}: ${details}`,
				);
			}

			const result = await response.json();

			const message = result?.choices?.[0]?.message ?? null;
			Object.defineProperty(result, 'message', {
				value: message,
				enumerable: false,
			});

			return result;
		} catch (error) {
			if (error.name === 'AbortError') {
				throw new Error(
					`Request ke endpoint OpenAI-compatible timeout setelah ${REQUEST_TIMEOUT_MS} ms`,
				);
			}
			throw error;
		} finally {
			clearTimeout(timeout);
		}
	},
};
