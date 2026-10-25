// The only place that knows which AI provider is in use.
// AI_PROVIDER=mock | gemini | azure (from the repo-root .env). Every call carries a
// `fallback` text, returned whenever the provider is off, slow, rate-limited or failing,
// so the live demo never stalls on the network.

export type AskOptions = {
  /** Text to use if the AI is unavailable. Always required: the show must go on. */
  fallback: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Identical prompts with the same cache key are answered once. */
  cacheKey?: string;
  /** Low-priority calls give way when the queue is busy. */
  priority?: 'high' | 'low';
};

export type AskResult = { text: string; source: 'gemini' | 'azure' | 'template' };

type Provider = 'mock' | 'gemini' | 'azure';

const env = (k: string) => (process.env[k] ?? '').split('#')[0]!.trim();

export function aiProvider(): Provider {
  const p = env('AI_PROVIDER');
  if (p === 'gemini' && env('GEMINI_API_KEY')) return 'gemini';
  if (p === 'azure' && env('AZURE_OPENAI_ENDPOINT') && env('AZURE_OPENAI_API_KEY') && env('AZURE_OPENAI_DEPLOYMENT')) return 'azure';
  return 'mock';
}

// ---- pacing: free tiers allow ~15 requests/minute, so space calls out and drop excess ----
const MIN_GAP_MS = 2500;
const MAX_QUEUE = 4;
const LOW_PRIORITY_QUEUE = 2;
let nextSlot = 0;
let queued = 0;
const cache = new Map<string, Promise<AskResult>>();

export async function askAI(prompt: string, opts: AskOptions): Promise<AskResult> {
  const provider = aiProvider();
  if (provider === 'mock') return { text: opts.fallback, source: 'template' };
  if (opts.cacheKey && cache.has(opts.cacheKey)) return cache.get(opts.cacheKey)!;
  if (queued >= (opts.priority === 'low' ? LOW_PRIORITY_QUEUE : MAX_QUEUE)) return { text: opts.fallback, source: 'template' };

  const wait = Math.max(0, nextSlot - Date.now());
  nextSlot = Math.max(nextSlot, Date.now()) + MIN_GAP_MS;
  const run = (async (): Promise<AskResult> => {
    queued += 1;
    try {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      const text = provider === 'gemini' ? await callGemini(prompt, opts) : await callAzure(prompt, opts);
      const clean = text?.trim();
      return clean ? { text: clean, source: provider } : { text: opts.fallback, source: 'template' };
    } catch (err) {
      console.warn(`[askAI] ${provider} failed, using template: ${(err as Error).message}`);
      return { text: opts.fallback, source: 'template' };
    } finally {
      queued -= 1;
    }
  })();

  // Belt and braces: whatever happens on the network, answer within a hard deadline.
  const deadline = wait + (opts.timeoutMs ?? 8000) * 2 + 1000;
  let timer: NodeJS.Timeout | undefined;
  const guarded = Promise.race([
    run,
    new Promise<AskResult>((resolve) => {
      timer = setTimeout(() => {
        console.warn(`[askAI] ${provider} took over ${Math.round(deadline / 1000)} s, using template`);
        resolve({ text: opts.fallback, source: 'template' });
      }, deadline);
    }),
  ]).finally(() => clearTimeout(timer));

  if (opts.cacheKey) {
    const key = opts.cacheKey;
    cache.set(key, guarded);
    // Only keep real answers; a failure or timeout should be retried next time.
    guarded.then((r) => {
      if (r.source === 'template' && cache.get(key) === guarded) cache.delete(key);
    });
  }
  return guarded;
}

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${json.error?.message ?? res.statusText}`), { status: res.status });
  return json;
}

/** Models tried in order: the configured one, then fast fallbacks (free-tier models get busy). */
const GEMINI_FALLBACKS = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest'];

/** Model names that returned 404 — skipped for the rest of the session instead of failing every call. */
const unknownModels = new Set<string>();

async function callGemini(prompt: string, opts: AskOptions): Promise<string> {
  const models = [...new Set([env('GEMINI_MODEL'), ...GEMINI_FALLBACKS].filter((m) => m && !unknownModels.has(m)))];
  let lastErr: unknown;
  for (const model of models) {
    try {
      const json = await post(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { 'x-goog-api-key': env('GEMINI_API_KEY') },
        {
          ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: opts.maxTokens ?? 400, temperature: opts.temperature ?? 0.7 },
        },
        opts.timeoutMs ?? 8000,
      );
      return (json.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      if (status === 404) {
        unknownModels.add(model);
        console.warn(`[askAI] Gemini model "${model}" not found — using ${GEMINI_FALLBACKS[0]} instead. Fix GEMINI_MODEL in .env.`);
      }
      // Unknown model or overloaded: try the next one. Anything else (bad key, quota): give up.
      if (status !== 404 && status !== 503 && status !== 500) break;
    }
  }
  throw lastErr;
}

async function callAzure(prompt: string, opts: AskOptions): Promise<string> {
  const endpoint = env('AZURE_OPENAI_ENDPOINT').replace(/\/+$/, '');
  const json = await post(
    `${endpoint}/openai/deployments/${encodeURIComponent(env('AZURE_OPENAI_DEPLOYMENT'))}/chat/completions?api-version=2024-10-21`,
    { 'api-key': env('AZURE_OPENAI_API_KEY') },
    {
      messages: [...(opts.system ? [{ role: 'system', content: opts.system }] : []), { role: 'user', content: prompt }],
      max_completion_tokens: opts.maxTokens ?? 400,
      temperature: opts.temperature ?? 0.7,
    },
    opts.timeoutMs ?? 8000,
  );
  return json.choices?.[0]?.message?.content ?? '';
}
