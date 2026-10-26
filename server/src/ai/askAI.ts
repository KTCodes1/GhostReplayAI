// The only place that knows which AI provider is in use: Azure OpenAI through Microsoft Foundry.
// AI_PROVIDER=azure | mock (from the repo-root .env). Every call carries a `fallback` text,
// returned whenever the AI is off, slow, rate-limited or failing, so the live demo never stalls.

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

export type AskResult = { text: string; source: 'azure' | 'template' };

type Provider = 'mock' | 'azure';

const env = (k: string) => (process.env[k] ?? '').split('#')[0]!.trim();

export function aiProvider(): Provider {
  if (env('AI_PROVIDER') === 'azure' && env('AZURE_OPENAI_ENDPOINT') && env('AZURE_OPENAI_API_KEY') && env('AZURE_OPENAI_DEPLOYMENT')) return 'azure';
  return 'mock';
}

// ---- pacing: space calls out and drop excess, so a busy moment never floods the deployment ----
const MIN_GAP_MS = 1200;
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
      const text = await callAzure(prompt, opts);
      const clean = text?.trim();
      return clean ? { text: clean, source: provider } : { text: opts.fallback, source: 'template' };
    } catch (err) {
      console.warn(`[askAI] Azure OpenAI failed, using template: ${(err as Error).message}`);
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
        console.warn(`[askAI] Azure OpenAI took over ${Math.round(deadline / 1000)} s, using template`);
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

/** Deployments whose model only accepts the default temperature (some newer models): remembered for the session. */
let fixedTemperature = false;

async function callAzure(prompt: string, opts: AskOptions): Promise<string> {
  // Accept the resource URL or a pasted Foundry project / full deployment URL: keep only scheme + host.
  const endpoint = new URL(env('AZURE_OPENAI_ENDPOINT')).origin;
  const url = `${endpoint}/openai/deployments/${encodeURIComponent(env('AZURE_OPENAI_DEPLOYMENT'))}/chat/completions?api-version=2024-10-21`;
  const body = (withTemperature: boolean) => ({
    messages: [...(opts.system ? [{ role: 'system', content: opts.system }] : []), { role: 'user', content: prompt }],
    max_completion_tokens: opts.maxTokens ?? 400,
    ...(withTemperature ? { temperature: opts.temperature ?? 0.7 } : {}),
  });
  try {
    const json = await post(url, { 'api-key': env('AZURE_OPENAI_API_KEY') }, body(!fixedTemperature), opts.timeoutMs ?? 8000);
    return json.choices?.[0]?.message?.content ?? '';
  } catch (err) {
    // Some models reject a custom temperature: retry once without it, and stop sending it.
    if ((err as { status?: number }).status === 400 && /temperature/i.test((err as Error).message) && !fixedTemperature) {
      fixedTemperature = true;
      const json = await post(url, { 'api-key': env('AZURE_OPENAI_API_KEY') }, body(false), opts.timeoutMs ?? 8000);
      return json.choices?.[0]?.message?.content ?? '';
    }
    throw err;
  }
}
