import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

// Feynman retains its agent, tools and /model UI. omp owns inference and OAuth.
export default async function (pi) {
  const managed = JSON.parse(readFileSync(process.env.EIGHTSYNC_FEYNMAN_BRIDGE
    ?? new URL('../.8sync-omp.json', import.meta.url), 'utf8'));
  const resolveAi = () => {
    const req = createRequire(process.env.FEYNMAN_BIN_PATH);
    let err;
    for (const spec of ['@earendil-works/pi-ai', '@mariozechner/pi-ai']) {
      try { return req.resolve(spec); } catch (e) { err ??= e; }
    }
    throw err;
  };
  const aiEntry = process.env.EIGHTSYNC_FEYNMAN_AI ?? resolveAi();
  const { createAssistantMessageEventStream } = await import(pathToFileURL(aiEntry).href);
  const ompBin = process.env.EIGHTSYNC_OMP_BIN ?? managed.ompBin;
  let worker;
  let nextId = 0;
  let sessionId = `feynman:${randomUUID()}`;
  const pending = new Map();

  function stop(error = new Error('omp gateway stopped')) {
    const old = worker;
    worker = undefined;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    if (old) {
      old.input.destroy();
      old.process.kill();
    }
  }

  function start() {
    if (worker) return worker;
    // Feynman overwrites Pi's directory variable. omp must use its original vault.
    const env = { ...process.env };
    delete env.PI_CODING_AGENT_DIR;
    if (typeof managed.ompPiAgentDir === 'string') {
      env.PI_CODING_AGENT_DIR = managed.ompPiAgentDir;
    }
    const child = spawn(ompBin, ['auth-gateway', 'stdio'], {
      env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    let readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const current = { process: child, input: child.stdin, ready };
    worker = current;
    const timeout = setTimeout(() => {
      const error = new Error('omp auth-gateway did not become ready within 30 seconds');
      readyReject(error);
      if (worker === current) stop(error);
    }, 30000);
    child.stderr.resume();
    createInterface({ input: child.stdout }).on('line', line => {
      let frame;
      try { frame = JSON.parse(line); } catch {
        const error = new Error('omp auth-gateway returned invalid JSON');
        readyReject(error);
        if (worker === current) stop(error);
        return;
      }
      if (frame.ready) { clearTimeout(timeout); readyResolve(); return; }
      const request = pending.get(frame.id);
      if (request) { pending.delete(frame.id); request.resolve(frame); }
    });
    const failed = error => {
      clearTimeout(timeout);
      readyReject(error);
      if (worker === current) stop(error);
    };
    child.on('error', failed);
    child.on('exit', code => failed(new Error(`omp auth-gateway exited (${code})`)));
    child.stdin.on('error', failed);
    return current;
  }

  function streamSimple(model, context, options = {}) {
    const stream = createAssistantMessageEventStream();
    const empty = {
      role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'error', timestamp: Date.now(),
    };
    void (async () => {
      const abort = () => stop(new Error('Request aborted'));
      let current;
      try {
        if (options.signal?.aborted) throw new Error('Request aborted');
        current = start();
        options.signal?.addEventListener('abort', abort, { once: true });
        await current.ready;
        if (options.signal?.aborted) throw new Error('Request aborted');
        const id = ++nextId;
        const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
        const { apiKey, signal, ...wireOptions } = options;
        wireOptions.sessionId ??= sessionId;
        const nativeContext = { ...context, systemPrompt: typeof context.systemPrompt === 'string'
          ? [context.systemPrompt] : context.systemPrompt };
        current.input.write(JSON.stringify({ id, path: '/v1/pi/stream', body: {
          model: `${model.provider}/${model.id}`, context: nativeContext, options: wireOptions, stream: true,
        } }) + '\n');
        const frame = await response;
        if (frame.status !== 200) throw new Error(frame.body?.error?.message ?? `omp gateway HTTP ${frame.status}`);
        if (typeof frame.body !== 'string') throw new Error('omp gateway did not return a native event stream');
        let terminal = false;
        // stdio returns a buffered SSE body. Preserve canonical tool calls, usage,
        // thinking signatures and provider metadata; do not translate through OpenAI.
        for (const line of frame.body.split('\n')) {
          if (!line.startsWith('data: ') || line.slice(6) === '[DONE]') continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === 'error' && !event.error) {
            throw new Error(event.errorMessage ?? 'omp gateway stream failed');
          }
          stream.push(event);
          if (event.type === 'done' || event.type === 'error') { terminal = true; break; }
        }
        if (!terminal) throw new Error('omp gateway closed without a terminal event');
        stream.end();
      } catch (error) {
        const message = { ...empty, stopReason: options.signal?.aborted ? 'aborted' : 'error',
          errorMessage: error instanceof Error ? error.message : String(error) };
        stream.push({ type: 'error', reason: message.stopReason, error: message });
        stream.end();
      } finally {
        options.signal?.removeEventListener('abort', abort);
      }
    })();
    return stream;
  }

  for (const provider of managed.providers) {
    pi.registerProvider(provider, { api: '8sync-omp', streamSimple });
  }
  pi.on('session_start', async (_event, ctx) => {
    sessionId = `feynman:${ctx.sessionManager.getSessionId()}`;
  });
  pi.on('session_shutdown', async () => stop());
}
