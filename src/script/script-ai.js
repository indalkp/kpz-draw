// src/script/script-ai.js
// Multi-provider AI Engine for KPZ Draw Script Mode:
// - Groq Cloud API (fast OpenAI-compatible cloud completions)
// - Ollama Local (http://localhost:11434 fully offline)
// - Host / window.claude bridge where available

const STORAGE_KEY = 'kpz_ai_config_v1';

export const AIConfig = {
  provider: 'groq', // 'groq' | 'ollama' | 'host'
  groqKey: '',
  groqModel: 'llama-3.3-70b-versatile',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.1',
  temperature: 0.7,
  connected: false,

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) Object.assign(this, JSON.parse(raw));
    } catch (_) {}
    return this;
  },

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        provider: this.provider,
        groqKey: this.groqKey,
        groqModel: this.groqModel,
        ollamaUrl: this.ollamaUrl,
        ollamaModel: this.ollamaModel,
        temperature: this.temperature
      }));
    } catch (_) {}
  }
};

AIConfig.load();

/**
 * Universal AI Completion function
 */
export async function aiComplete(prompt, opts = {}) {
  const cfg = AIConfig;
  const provider = opts.provider || cfg.provider;

  if (provider === 'groq') {
    return await groqComplete(prompt, opts);
  } else if (provider === 'ollama') {
    return await ollamaComplete(prompt, opts);
  } else if (provider === 'host' && window.claude && typeof window.claude.complete === 'function') {
    return await window.claude.complete(prompt, opts);
  }

  // Fallback to groq if available
  if (cfg.groqKey) {
    return await groqComplete(prompt, opts);
  }
  throw new Error('No AI provider configured. Set up Groq or Ollama in AI Settings.');
}

/**
 * Groq Cloud Completion
 */
async function groqComplete(prompt, opts = {}) {
  const cfg = AIConfig;
  if (!cfg.groqKey) throw new Error('Groq API Key is missing. Add your key in AI Settings.');

  const messages = [];
  if (opts.system) messages.push({ role: 'system', content: String(opts.system) });
  messages.push({ role: 'user', content: String(prompt || '') });

  const body = {
    model: opts.model || cfg.groqModel || 'llama-3.3-70b-versatile',
    messages,
    temperature: (opts.temperature != null) ? opts.temperature : cfg.temperature,
  };
  if (opts.json) body.response_format = { type: 'json_object' };

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.groqKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    let errDetail = `Groq HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j.error && j.error.message) errDetail += ` — ${j.error.message}`;
    } catch (_) {}
    throw new Error(errDetail);
  }

  const data = await res.json();
  return ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
}

/**
 * Ollama Local Completion
 */
async function ollamaComplete(prompt, opts = {}) {
  const cfg = AIConfig;
  const base = (cfg.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');

  const body = {
    model: opts.model || cfg.ollamaModel || 'llama3.1',
    prompt: (opts.system ? `${opts.system}\n\n` : '') + String(prompt || ''),
    stream: false,
    options: {
      temperature: (opts.temperature != null) ? opts.temperature : cfg.temperature
    }
  };
  if (opts.json) body.format = 'json';

  const res = await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  return (data.response || '').trim();
}

/**
 * Test AI Connection
 */
export async function testConnection(provider = 'groq') {
  try {
    const res = await aiComplete('Respond with the word "READY".', {
      provider,
      system: 'You are a test ping.',
      temperature: 0.1
    });
    return { ok: true, text: res };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
