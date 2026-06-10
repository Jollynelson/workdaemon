// Extracted from the former 5,000-line src/pages/Dashboard.jsx (2026-06-10 split).
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { brainApi } from '../../lib/brainApi.js';
import { useC, mkPrimaryBtn, mkGhostBtn } from '../../lib/theme.jsx';

export const PROVIDERS = [
  {
    id: 'openrouter', name: 'OpenRouter', color: '#7c3aed',
    desc: '300+ models via one key', keyLabel: 'API Key',
    placeholder: 'sk-or-v1-…',
    keyPrefix: 'sk-or-',
    staticModels: [],
  },
  {
    id: 'anthropic', name: 'Anthropic', color: '#d97706',
    desc: 'Direct Claude access', keyLabel: 'API Key',
    placeholder: 'sk-ant-api03-…',
    keyPrefix: 'sk-ant-',
    staticModels: [
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', cost: 'best' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', cost: 'mid' },
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', cost: 'high' },
    ],
  },
  {
    id: 'openai', name: 'OpenAI', color: '#10b981',
    desc: 'GPT models + embeddings', keyLabel: 'API Key',
    placeholder: 'sk-proj-…',
    keyPrefix: 'sk-',
    staticModels: [
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', cost: 'best' },
      { id: 'gpt-4o', name: 'GPT-4o', cost: 'mid' },
      { id: 'gpt-4.1', name: 'GPT-4.1', cost: 'mid' },
      { id: 'o4-mini', name: 'o4-mini', cost: 'mid' },
      { id: 'o3', name: 'o3', cost: 'high' },
      { id: 'text-embedding-3-small', name: 'text-embedding-3-small', cost: 'best' },
      { id: 'text-embedding-3-large', name: 'text-embedding-3-large', cost: 'mid' },
    ],
  },
  {
    id: 'google', name: 'Google Gemini', color: '#3b6ef7',
    desc: 'Gemini Pro & Flash', keyLabel: 'API Key',
    placeholder: 'AIza…',
    keyPrefix: 'AIza',
    staticModels: [
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', cost: 'best' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', cost: 'best' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', cost: 'high' },
    ],
  },
  {
    id: 'mistral', name: 'Mistral', color: '#ec4899',
    desc: 'Mistral & Codestral', keyLabel: 'API Key',
    placeholder: 'your-mistral-key',
    staticModels: [
      { id: 'mistral-small-latest', name: 'Mistral Small', cost: 'best' },
      { id: 'mistral-large-latest', name: 'Mistral Large', cost: 'mid' },
      { id: 'codestral-latest', name: 'Codestral', cost: 'mid' },
      { id: 'mistral-embed', name: 'Mistral Embed', cost: 'best' },
    ],
  },
  {
    id: 'ollama', name: 'Ollama', color: '#64748b',
    desc: 'Self-hosted local models', keyLabel: null,
    isEndpoint: true, endpointPlaceholder: 'http://localhost:11434',
    staticModels: [],
  },
  {
    id: 'azure', name: 'Azure OpenAI', color: '#0078d4',
    desc: 'Enterprise deployments', keyLabel: 'API Key',
    placeholder: 'your-azure-key',
    isEndpoint: true, endpointPlaceholder: 'https://your-resource.openai.azure.com',
    staticModels: [],
  },
  {
    id: 'modal', name: 'Company Brain (Hermes-3)', color: '#16a34a',
    desc: 'Your fine-tuned model on Modal GPU', keyLabel: 'Serve Token',
    placeholder: 'serve token (SERVE_TOKEN)',
    isEndpoint: true, endpointPlaceholder: 'https://your-serving-url',
    modelLabel: 'Company ID', modelPlaceholder: 'company_id to route to',
    staticModels: [],
  },
];

export const COST_LABELS = {
  best: { label: 'Fast & cheap', color: '#10b981' },
  mid:  { label: 'Balanced',     color: '#f59e0b' },
  high: { label: 'Powerful',     color: '#ef4444' },
};

export function detectProviderFromKey(key) {
  if (!key) return null;
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('sk-or-'))  return 'openrouter';
  if (key.startsWith('AIza'))    return 'google';
  if (key.startsWith('sk-'))     return 'openai';
  return null;
}

export const USE_CASES = [
  { id: 'reasoning',  label: 'Daemon Chat',      desc: 'Main AI assistant for all users' },
  { id: 'embeddings', label: 'Embeddings',        desc: 'Vector search & knowledge base' },
  { id: 'sensitive',  label: 'Sensitive Queries', desc: 'Private data, stays local' },
  { id: 'fallback',   label: 'Fallback',          desc: 'Used if primary key fails' },
];

export function ProviderBadge({ provider, size = 'sm' }) {
  const cfg = PROVIDERS.find(p => p.id === provider);
  if (!cfg) return null;
  const pad = size === 'sm' ? '3px 8px' : '5px 12px';
  const fs = size === 'sm' ? 10 : 12;
  return (
    <span style={{
      display: 'inline-block', padding: pad, borderRadius: 20,
      background: `${cfg.color}18`, border: `1px solid ${cfg.color}40`,
      fontFamily: 'var(--dmsans)', fontSize: fs, fontWeight: 600,
      color: cfg.color, whiteSpace: 'nowrap',
    }}>{cfg.name}</span>
  );
}

export function UseCaseBadge({ useCase }) {
  const cfg = USE_CASES.find(u => u.id === useCase) ?? USE_CASES[0];
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 20,
      background: 'rgba(59,110,247,0.08)', border: '1px solid rgba(59,110,247,0.2)',
      fontFamily: 'var(--dmsans)', fontSize: 10, fontWeight: 600,
      color: '#3b6ef7', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>{cfg.label}</span>
  );
}

export function FocusedInput({ value, onChange, placeholder, inputSt, type = 'text', style: extraStyle = {} }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type={type} value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      autoComplete="off" spellCheck={false}
      style={{ ...inputSt(focused), ...extraStyle }}
    />
  );
}


export function AddProviderForm({ token, onSaved, onCancel, editKey, c }) {
  const [step, setStep]         = useState(editKey ? 2 : 1);
  const [provider, setProvider] = useState(editKey?.provider || '');
  const [apiKey, setApiKey]     = useState('');
  const [endpoint, setEndpoint] = useState(editKey?.endpoint || '');
  const [model, setModel]       = useState(editKey?.model || '');
  const [useCase, setUseCase]   = useState(editKey?.use_case || 'reasoning');
  const [label, setLabel]       = useState(editKey?.label || '');
  const [showKey, setShowKey]   = useState(false);
  const [models, setModels]     = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState('');
  const cfg = PROVIDERS.find(p => p.id === provider);

  const handleKeyChange = (val) => {
    setApiKey(val);
    if (!provider) {
      const detected = detectProviderFromKey(val);
      if (detected) setProvider(detected);
    }
  };

  const inputSt = (focused) => ({
    width: '100%', padding: '10px 14px', boxSizing: 'border-box',
    background: focused ? (c.d ? 'rgba(255,255,255,0.07)' : '#fff') : c.inputBg,
    border: `1px solid ${focused ? 'rgba(59,110,247,0.5)' : c.inputBorder}`,
    borderRadius: 7, color: c.text, fontSize: 14, fontFamily: 'var(--dmsans)',
    outline: 'none', transition: 'all 0.15s',
    boxShadow: focused ? '0 0 0 2px rgba(59,110,247,0.15)' : 'none',
  });

  const validateAndFetch = useCallback(async () => {
    if (!cfg) return;
    setLoadingModels(true);
    setErr('');
    try {
      const r = await fetch('/api/workspace/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'validate', provider, key: apiKey, endpoint }),
      });
      const d = await r.json();
      const live = d.models || [];
      const merged = live.length ? live : cfg.staticModels;
      setModels(merged);
      if (!model && merged[0]) setModel(merged[0].id);
    } catch {
      setModels(cfg.staticModels || []);
      if (!model && cfg.staticModels?.[0]) setModel(cfg.staticModels[0].id);
    }
    setLoadingModels(false);
  }, [cfg, token, provider, apiKey, endpoint, model]);

  const advanceToModels = () => {
    const base = cfg?.staticModels || [];
    setModels(base);
    if (!model && base[0]) setModel(base[0].id);
    setStep(3);
    if (apiKey || provider === 'ollama') validateAndFetch();
  };

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const r = await fetch('/api/workspace/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          id: editKey?.id, provider,
          key: apiKey || undefined, endpoint: endpoint || undefined,
          model, use_case: useCase, label: label || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Save failed'); return; }
      onSaved();
    } catch { setErr('Network error'); }
    setSaving(false);
  };

  return (
    <div style={{ background: c.card, border: '1px solid rgba(59,110,247,0.25)', borderRadius: 12, padding: '20px 24px', marginBottom: 16 }}>
      {/* Steps */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, alignItems: 'center' }}>
        {['Provider', 'Credentials', 'Model & Use'].map((s, i) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: step > i + 1 ? '#10b981' : step === i + 1 ? '#3b6ef7' : c.subtle,
              border: `1px solid ${step > i + 1 ? '#10b981' : step === i + 1 ? '#3b6ef7' : c.subtleBorder}`,
              fontFamily: 'var(--dmsans)', fontSize: 11, fontWeight: 700,
              color: step >= i + 1 ? '#fff' : c.text3,
            }}>{step > i + 1 ? '✓' : i + 1}</div>
            <span style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: step === i + 1 ? c.text : c.text3 }}>{s}</span>
            {i < 2 && <span style={{ color: c.text4, fontSize: 14, marginLeft: 2 }}>›</span>}
          </div>
        ))}
        <button type="button" onClick={onCancel} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: c.text3, cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 0 }}>×</button>
      </div>

      {/* Step 1: Provider picker */}
      {step === 1 && (
        <div>
          <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text2, marginBottom: 8 }}>Choose a provider, or paste your API key below to auto-detect.</p>
          <div style={{ marginBottom: 14, position: 'relative' }}>
            <input
              type="text" placeholder="Paste API key to auto-detect provider (sk-ant-…, AIza…, sk-or-…, sk-…)"
              style={{
                width: '100%', padding: '9px 14px', boxSizing: 'border-box',
                background: c.inputBg, border: `1px solid ${c.inputBorder}`,
                borderRadius: 7, color: c.text, fontSize: 13, fontFamily: 'var(--dmsans)', outline: 'none',
              }}
              onChange={e => {
                const val = e.target.value;
                const detected = detectProviderFromKey(val);
                if (detected) { setApiKey(val); setProvider(detected); setStep(2); }
              }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: 8 }}>
            {PROVIDERS.map(p => (
              <button key={p.id} type="button" onClick={() => { setProvider(p.id); setStep(2); }}
                style={{
                  padding: '12px 14px', textAlign: 'left', cursor: 'pointer',
                  background: c.subtle, border: `1px solid ${c.subtleBorder}`,
                  borderRadius: 9, transition: 'all 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = p.color + '55'; e.currentTarget.style.background = `${p.color}0e`; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.background = ''; }}
              >
                <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 700, color: p.color, marginBottom: 3 }}>{p.name}</div>
                <div style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text3 }}>{p.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Key / endpoint */}
      {step === 2 && cfg && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <ProviderBadge provider={provider} size="md" />
            <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text2 }}>{cfg.desc}</span>
          </div>
          {cfg.isEndpoint && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text3, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Endpoint URL</label>
              <FocusedInput value={endpoint} onChange={setEndpoint} placeholder={cfg.endpointPlaceholder} inputSt={inputSt} />
            </div>
          )}
          {cfg.keyLabel && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 10, padding: '10px 12px', borderRadius: 8, background: 'rgba(59,110,247,0.06)', border: '1px solid rgba(59,110,247,0.15)' }}>
                <p style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text2, margin: 0, lineHeight: 1.5 }}>
                  <strong style={{ color: '#3b6ef7' }}>API key required.</strong> Claude Pro, ChatGPT Plus, and Gemini subscriptions don't include API access — they're separate products. Get an API key from the provider's developer console, then add credit separately.
                </p>
              </div>
              <label style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text3, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{cfg.keyLabel}</label>
              <div style={{ position: 'relative' }}>
                <FocusedInput type={showKey ? 'text' : 'password'} value={apiKey} onChange={handleKeyChange}
                  placeholder={editKey ? `Leave blank to keep existing key ${editKey.keyHint || ''}` : cfg.placeholder}
                  inputSt={inputSt} extraStyle={{ paddingRight: 52 }} />
                <button type="button" onClick={() => setShowKey(s => !s)}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: c.text3, fontSize: 12, fontFamily: 'var(--dmsans)' }}>
                  {showKey ? 'hide' : 'show'}
                </button>
              </div>
            </div>
          )}
          {err && <p style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: '#ef4444', marginBottom: 10 }}>{err}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            {!editKey && <button type="button" onClick={() => setStep(1)} style={mkGhostBtn(c)}>← Back</button>}
            <button type="button" onClick={advanceToModels}
              disabled={!!(cfg.keyLabel && !apiKey && !editKey)}
              style={mkPrimaryBtn(cfg.color, !cfg.keyLabel || !!apiKey || !!editKey)}>
              Next: Choose model →
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Model + use case */}
      {step === 3 && cfg && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <ProviderBadge provider={provider} size="md" />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text3, display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{cfg.modelLabel || 'Model'}</label>
            {loadingModels && <p style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3, marginBottom: 8 }}>Fetching live model list…</p>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {models.slice(0, 20).map(m => {
                const costInfo = m.cost ? COST_LABELS[m.cost] : null;
                const isSelected = model === m.id;
                return (
                  <button key={m.id} type="button" onClick={() => setModel(m.id)}
                    style={{
                      padding: '6px 12px', borderRadius: 6, cursor: 'pointer', transition: 'all 0.1s',
                      background: isSelected ? `${cfg.color}18` : c.subtle,
                      border: `1px solid ${isSelected ? cfg.color + '55' : c.subtleBorder}`,
                      fontFamily: 'var(--dmsans)', fontSize: 12, textAlign: 'left',
                      fontWeight: isSelected ? 600 : 400,
                      color: isSelected ? cfg.color : c.text2,
                      display: 'flex', flexDirection: 'column', gap: 2,
                    }}>
                    <span>{m.name || m.id}</span>
                    {costInfo && (
                      <span style={{ fontSize: 10, fontWeight: 500, color: costInfo.color, opacity: 0.85 }}>{costInfo.label}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <FocusedInput value={model} onChange={setModel} placeholder={cfg.modelPlaceholder || 'Or type any model ID…'} inputSt={inputSt} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text3, display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Use Case</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {USE_CASES.map(u => (
                <button key={u.id} type="button" onClick={() => setUseCase(u.id)}
                  style={{
                    padding: '10px 12px', textAlign: 'left', cursor: 'pointer', transition: 'all 0.1s',
                    background: useCase === u.id ? 'rgba(59,110,247,0.1)' : c.subtle,
                    border: `1px solid ${useCase === u.id ? 'rgba(59,110,247,0.45)' : c.subtleBorder}`,
                    borderRadius: 8,
                  }}>
                  <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, fontWeight: 600, color: useCase === u.id ? '#3b6ef7' : c.text }}>{u.label}</div>
                  <div style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text3, marginTop: 2 }}>{u.desc}</div>
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text3, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Label <span style={{ color: c.text4, fontWeight: 400 }}>(optional)</span></label>
            <FocusedInput value={label} onChange={setLabel} placeholder="e.g. Internal Llama, Embeddings key…" inputSt={inputSt} />
          </div>
          {err && <p style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: '#ef4444', marginBottom: 10 }}>{err}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setStep(2)} style={mkGhostBtn(c)}>← Back</button>
            <button type="button" onClick={save} disabled={saving || !model}
              style={mkPrimaryBtn('#3b6ef7', !!model && !saving)}>
              {saving ? 'Saving…' : editKey ? 'Save Changes' : 'Add Provider'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Quick-fill personality vibes; the textarea (freeform) is the source of truth.
export const PERSONA_PRESETS = [
  { key: 'witty',      label: 'Sharp & witty',      text: 'Sharp and a little witty — concise, candid, with a dash of dry humour. Never fawning or robotic.' },
  { key: 'warm',       label: 'Warm & encouraging', text: 'Warm and encouraging — supportive, positive, and personable, while still direct.' },
  { key: 'precise',    label: 'Calm & precise',     text: 'Calm and precise — measured, exact, detail-oriented, and unflappable.' },
  { key: 'nononsense', label: 'No-nonsense',        text: 'No-nonsense and direct — brief, blunt, zero filler. Gets straight to the point.' },
];

export function DaemonSettings({ c, token }) {
  const [daemonName, setDaemonName]       = useState('');
  const [preferredName, setPreferredName] = useState('');
  const [persona, setPersona]             = useState('');
  const [loading, setLoading]             = useState(true);
  const [saving, setSaving]               = useState(false);
  const [saved, setSaved]                 = useState(false);

  useEffect(() => {
    if (!token) return;
    brainApi.getDaemon({ token })
      .then(d => {
        setDaemonName(d.daemon_name || '');
        setPreferredName(d.preferred_name || '');
        setPersona(d.persona || '');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const save = async () => {
    setSaving(true); setSaved(false);
    try {
      await brainApi.updateDaemon({ token, daemonName, preferredName, persona });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {}
    setSaving(false);
  };

  const field = {
    width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8,
    background: c.bg, border: `1px solid ${c.cardBorder}`, color: c.text,
    fontFamily: 'var(--dmsans)', fontSize: 14, outline: 'none',
  };
  const lbl = { fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em', color: c.text3, marginBottom: 6, display: 'block' };

  return (
    <div style={{ marginTop: 44 }}>
      <div style={{ marginBottom: 18 }}>
        <p className="wd-label-blue" style={{ marginBottom: 6 }}>YOUR DAEMON</p>
        <h2 style={{ fontFamily: 'var(--inter)', fontSize: 19, fontWeight: 700, color: c.text, margin: 0, letterSpacing: '-0.02em' }}>Name & personality</h2>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3, marginTop: 6, lineHeight: 1.6 }}>
          Give your daemon a name and a personality. You can also just tell it in chat —
          “call yourself Atlas, call me Boss, and be more concise.”
        </p>
      </div>

      <div style={{ background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: 20 }}>
        {loading ? (
          <p style={{ fontFamily: 'var(--dmsans)', fontSize: 14, color: c.text3, margin: 0 }}>Loading…</p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={lbl}>DAEMON’S NAME</label>
                <input style={field} value={daemonName} maxLength={40}
                  onChange={e => setDaemonName(e.target.value)} placeholder="e.g. Atlas (leave blank to stay “your Daemon”)" />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={lbl}>WHAT SHOULD IT CALL YOU?</label>
                <input style={field} value={preferredName} maxLength={40}
                  onChange={e => setPreferredName(e.target.value)} placeholder="e.g. Boss (defaults to your name)" />
              </div>
            </div>

            <label style={lbl}>PERSONALITY</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {PERSONA_PRESETS.map(p => (
                <button key={p.key} type="button" onClick={() => setPersona(p.text)}
                  style={{
                    padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                    fontFamily: 'var(--dmsans)', fontSize: 12, fontWeight: 600,
                    background: persona === p.text ? 'rgba(59,110,247,0.14)' : c.subtle,
                    border: `1px solid ${persona === p.text ? 'rgba(59,110,247,0.4)' : c.subtleBorder}`,
                    color: persona === p.text ? '#3b6ef7' : c.text2,
                  }}>{p.label}</button>
              ))}
            </div>
            <textarea style={{ ...field, minHeight: 84, resize: 'vertical', lineHeight: 1.5 }}
              value={persona} maxLength={1000}
              onChange={e => setPersona(e.target.value)}
              placeholder="Pick a vibe above, then tweak — or write your own. e.g. “Sharp and witty, but careful with numbers.”" />

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
              <button type="button" onClick={save} disabled={saving}
                style={{
                  padding: '9px 20px', borderRadius: 8, cursor: saving ? 'default' : 'pointer',
                  background: 'rgba(59,110,247,0.1)', border: '1px solid rgba(59,110,247,0.3)',
                  fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: '#3b6ef7',
                  opacity: saving ? 0.6 : 1,
                }}>
                {saving ? 'Saving…' : 'Save daemon'}
              </button>
              {saved && <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: '#10b981' }}>✓ Saved — it takes effect next message.</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export const SETTINGS_TABS = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'billing',   label: 'Billing & Plan' },
  { id: 'ai',        label: 'AI & Model' },
  { id: 'security',  label: 'Security' },
  { id: 'notifs',    label: 'Notifications' },
  { id: 'data',      label: 'Data' },
  { id: 'danger',    label: 'Danger Zone' },
];

export function SettingsPage() {
  const c = useC();
  const { token } = useAuth();
  const [tab, setTab]         = useState('workspace');
  const [keys, setKeys]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding]   = useState(false);
  const [editKey, setEditKey] = useState(null);
  const [syncing, setSyncing] = useState(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch('/api/workspace/settings', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setKeys(d.keys || []);
    } catch {}
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const remove = async (id) => {
    if (!window.confirm('Remove this provider key? This cannot be undone.')) return;
    await fetch('/api/workspace/settings', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id }),
    });
    load();
  };

  const syncModels = async (key) => {
    setSyncing(key.id);
    const r = await fetch(`/api/workspace/settings?models=true&keyId=${key.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await r.json();
    setSyncing(null);
    if (d.models?.length) {
      alert(`${d.models.length} models available for this key. Edit the provider to update your selection.`);
    }
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 32px 80px' }}>

        <div style={{ marginBottom: 22 }}>
          <p className="wd-label-blue" style={{ marginBottom: 6 }}>SETTINGS</p>
          <h1 style={{ fontFamily: 'var(--inter)', fontSize: 24, fontWeight: 700, color: c.text, margin: 0, letterSpacing: '-0.03em' }}>Settings</h1>
        </div>

        {/* Tab bar (IA §8) */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: `1px solid ${c.cardBorder}`, marginBottom: 28 }}>
          {SETTINGS_TABS.map(t => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              style={{ padding: '9px 13px', background: 'none', border: 'none', borderBottom: `2px solid ${tab === t.id ? '#3b6ef7' : 'transparent'}`, marginBottom: -1, cursor: 'pointer', fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: tab === t.id ? '#3b6ef7' : c.text3 }}>{t.label}</button>
          ))}
        </div>

        {tab === 'workspace' && <WorkspaceSettings c={c} token={token} />}
        {tab === 'billing'   && <BillingSettings c={c} />}
        {tab === 'security'  && <SecuritySettings c={c} />}
        {tab === 'notifs'    && <WorkspaceNotifSettings c={c} token={token} />}
        {tab === 'data'      && <DataSettings c={c} />}
        {tab === 'danger'    && <DangerZoneSettings c={c} token={token} />}

        {tab === 'ai' && <>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 14, color: c.text3, margin: '0 0 22px', lineHeight: 1.6 }}>
          Connect any AI provider. Your whole team shares these keys — no per-user setup.
        </p>

        {(adding || editKey) && (
          <AddProviderForm
            token={token} editKey={editKey} c={c}
            onCancel={() => { setAdding(false); setEditKey(null); }}
            onSaved={() => { setAdding(false); setEditKey(null); load(); }}
          />
        )}

        {loading ? (
          <p style={{ fontFamily: 'var(--dmsans)', fontSize: 14, color: c.text3 }}>Loading…</p>
        ) : keys.length === 0 ? (
          <div style={{ background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: '32px 24px', textAlign: 'center', marginBottom: 16 }}>
            <p style={{ fontFamily: 'var(--dmsans)', fontSize: 15, fontWeight: 600, color: c.text, marginBottom: 6 }}>No providers connected</p>
            <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3 }}>Add a provider key to enable the Daemon for your workspace.</p>
          </div>
        ) : (
          <div style={{ marginBottom: 16 }}>
            {keys.map(k => (
              <div key={k.id} style={{
                background: c.card, border: `1px solid ${c.cardBorder}`,
                borderRadius: 10, padding: '14px 18px', marginBottom: 8,
                display: 'flex', alignItems: 'center', gap: 14,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                    <ProviderBadge provider={k.provider} />
                    <UseCaseBadge useCase={k.use_case} />
                    {k.label && <span style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text3 }}>· {k.label}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                    {k.model && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: c.text2 }}>{k.model}</span>}
                    {k.endpoint && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: c.text3 }}>{k.endpoint}</span>}
                    {k.keyHint && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: c.text4 }}>key: {k.keyHint}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button type="button" onClick={() => syncModels(k)}
                    title="Refresh available models"
                    style={{ ...mkGhostBtn(c), padding: '5px 10px', fontSize: 13 }}>
                    {syncing === k.id ? '…' : '↻'}
                  </button>
                  <button type="button" onClick={() => { setEditKey(k); setAdding(false); }}
                    style={{ ...mkGhostBtn(c), padding: '5px 12px', fontSize: 12 }}>Edit</button>
                  <button type="button" onClick={() => remove(k.id)}
                    style={{ ...mkGhostBtn(c, { color: '#ef4444', borderColor: 'rgba(239,68,68,0.25)' }), padding: '5px 12px', fontSize: 12 }}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {!adding && !editKey && (
          <button type="button" onClick={() => { setAdding(true); setEditKey(null); }}
            style={{
              padding: '10px 20px', borderRadius: 8, cursor: 'pointer',
              background: 'rgba(59,110,247,0.08)', border: '1px solid rgba(59,110,247,0.25)',
              fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: '#3b6ef7',
            }}>
            + Add Provider
          </button>
        )}

        <div style={{ marginTop: 32, padding: '14px 18px', background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 10 }}>
          <p style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3, lineHeight: 1.65, margin: 0 }}>
            <strong style={{ color: c.text2 }}>Daemon Chat</strong> uses the reasoning key.{' '}
            <strong style={{ color: c.text2 }}>Embeddings</strong> powers knowledge base search.{' '}
            <strong style={{ color: c.text2 }}>Sensitive</strong> keeps queries on your own infra (Ollama).{' '}
            Switching embedding providers requires re-indexing — runs as a background job.
          </p>
        </div>

        <DaemonSettings c={c} token={token} />
        <PublishingSettings c={c} token={token} />
        </>}
      </div>
    </div>
  );
}

// ── Settings tab bodies (IA §8) ───────────────────────────────────────────────
export function SettingsCard({ c, children }) {
  return <div style={{ background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>;
}
export function SettingsRow({ c, label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontFamily: 'var(--dmsans)', fontSize: 12, fontWeight: 600, color: c.text3 }}>{label}</label>
      {children}
    </div>
  );
}
export function settingsInput(c) {
  return { padding: '10px 12px', borderRadius: 8, background: c.subtle, border: `1px solid ${c.subtleBorder}`, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' };
}
export function SaveBtn({ c, busy, onClick, label = 'Save changes' }) {
  return <button type="button" onClick={onClick} disabled={busy} style={{ padding: '9px 20px', borderRadius: 8, cursor: busy ? 'default' : 'pointer', background: '#3b6ef7', border: '1px solid #3b6ef7', color: '#fff', fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, opacity: busy ? 0.6 : 1, alignSelf: 'flex-start' }}>{busy ? 'Saving…' : label}</button>;
}
export function InfoBanner({ c, text }) {
  return <div style={{ padding: '12px 14px', borderRadius: 9, background: 'rgba(59,110,247,0.07)', border: '1px solid rgba(59,110,247,0.2)', fontFamily: 'var(--dmsans)', fontSize: 12.5, color: c.text3, lineHeight: 1.55 }}>{text}</div>;
}

export const TIMEZONES = ['UTC', 'Africa/Lagos', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore'];

export function WorkspaceSettings({ c, token }) {
  const [f, setF] = useState({ name: '', timezone: '', email_domain: '', default_member_level: 1 });
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    fetch('/api/workspace/settings?workspace=true', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setF({ name: d.name || '', timezone: d.timezone || 'UTC', email_domain: d.email_domain || '', default_member_level: d.default_member_level ?? 1 })).catch(() => {});
  }, [token]);
  const save = async () => {
    setBusy(true); setOk(false);
    const r = await fetch('/api/workspace/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'update_workspace', ...f }) }).catch(() => null);
    setBusy(false); if (r?.ok) setOk(true);
  };
  const ip = settingsInput(c);
  return (
    <SettingsCard c={c}>
      {ok && <InfoBanner c={c} text="✓ Workspace settings saved." />}
      <SettingsRow c={c} label="Company name"><input value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} style={ip} /></SettingsRow>
      <SettingsRow c={c} label="Work email domain — auto-approves invite links from the same domain"><input value={f.email_domain} onChange={e => setF(s => ({ ...s, email_domain: e.target.value }))} placeholder="acmecorp.com" style={ip} /></SettingsRow>
      <SettingsRow c={c} label="Timezone — used for scheduling daemons & calendar"><select value={f.timezone} onChange={e => setF(s => ({ ...s, timezone: e.target.value }))} style={{ ...ip, cursor: 'pointer' }}>{TIMEZONES.map(t => <option key={t} value={t}>{t}</option>)}</select></SettingsRow>
      <SettingsRow c={c} label="Default daemon level for new members"><select value={f.default_member_level} onChange={e => setF(s => ({ ...s, default_member_level: Number(e.target.value) }))} style={{ ...ip, cursor: 'pointer' }}><option value={1}>Level 1 — Copilot (recommended)</option><option value={2}>Level 2 — Assistant</option><option value={3}>Level 3 — Autonomous</option></select></SettingsRow>
      <SaveBtn c={c} busy={busy} onClick={save} />
    </SettingsCard>
  );
}

export function BillingSettings({ c }) {
  const PLANS = [
    ['Free', 'WorkDaemon-hosted · 50k tokens/mo · 1 integration · read-only (L1)'],
    ['Pro', 'BYOK · all integrations · L1 + L2'],
    ['Enterprise', 'BYOK/BYOS · L1–L3 · SSO · custom integrations'],
  ];
  return (
    <SettingsCard c={c}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontFamily: 'var(--dmsans)', fontSize: 14, fontWeight: 700, color: c.text }}>Current plan</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.06em', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 6, padding: '3px 9px' }}>FREE</span>
      </div>
      {PLANS.map(([n, d]) => (
        <div key={n} style={{ padding: '12px 14px', background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 9 }}>
          <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13.5, fontWeight: 600, color: c.text }}>{n}</div>
          <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12.5, color: c.text3, marginTop: 3 }}>{d}</div>
        </div>
      ))}
      <InfoBanner c={c} text="In-app checkout & invoices arrive when billing goes live (Stripe). For now, all tiers run on your own provider keys (BYOK) configured in the AI & Model tab." />
    </SettingsCard>
  );
}

export function SecuritySettings({ c }) {
  return (
    <SettingsCard c={c}>
      <SettingsRow c={c} label="Single sign-on (SSO)"><InfoBanner c={c} text="Enterprise tier. Provider metadata + callback URL configured here once your IdP (Okta / Azure AD / Google) is connected." /></SettingsRow>
      <SettingsRow c={c} label="Bring your own store (BYOS)"><InfoBanner c={c} text="Point the Company Brain at your own vector DB (Qdrant / Weaviate / Pinecone / pgvector) with a connection string. Available on Enterprise." /></SettingsRow>
      <SettingsRow c={c} label="Enforce 2FA"><InfoBanner c={c} text="Require two-factor auth for all workspace members. Coming with the auth hardening release." /></SettingsRow>
    </SettingsCard>
  );
}

export function WorkspaceNotifSettings({ c, token }) {
  const [f, setF] = useState({ broadcast_perms: 'admins', digest: 'off' });
  const ip = settingsInput(c);
  return (
    <SettingsCard c={c}>
      <SettingsRow c={c} label="Who can send company-wide broadcasts"><select value={f.broadcast_perms} onChange={e => setF(s => ({ ...s, broadcast_perms: e.target.value }))} style={{ ...ip, cursor: 'pointer' }}><option value="admins">Admins only</option><option value="all">All members</option></select></SettingsRow>
      <SettingsRow c={c} label="Digest mode — batch alerts instead of real-time"><select value={f.digest} onChange={e => setF(s => ({ ...s, digest: e.target.value }))} style={{ ...ip, cursor: 'pointer' }}><option value="off">Off (real-time)</option><option value="hourly">Hourly</option><option value="daily">Daily</option></select></SettingsRow>
      <InfoBanner c={c} text="Per-member alert toggles & quiet hours live on each member's Profile. Workspace-wide channels & digest scheduling apply on top." />
    </SettingsCard>
  );
}

export function DataSettings({ c }) {
  return (
    <SettingsCard c={c}>
      <SettingsRow c={c} label="Data retention"><InfoBanner c={c} text="Indexed Brain content and audit logs are retained while your workspace is active. On cancellation a 90-day grace period applies before deletion." /></SettingsRow>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" disabled title="Available on paid tiers" style={{ ...mkGhostBtn(c), padding: '9px 14px', fontSize: 13, opacity: 0.55, cursor: 'not-allowed' }}>Export company data</button>
        <button type="button" disabled title="Requires typed confirmation; enabled with billing" style={{ ...mkGhostBtn(c, { color: '#ef4444', borderColor: 'rgba(239,68,68,0.25)' }), padding: '9px 14px', fontSize: 13, opacity: 0.55, cursor: 'not-allowed' }}>Purge Brain data</button>
      </div>
    </SettingsCard>
  );
}

export function DangerZoneSettings({ c }) {
  return (
    <div style={{ background: c.card, border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <InfoBanner c={c} text="These actions are irreversible. Workspace transfer and deletion require typed confirmation and are gated behind admin auth — wired up with the billing/ownership release so they can't be triggered by accident." />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" disabled style={{ ...mkGhostBtn(c), padding: '9px 14px', fontSize: 13, opacity: 0.55, cursor: 'not-allowed' }}>Transfer ownership</button>
        <button type="button" disabled style={{ padding: '9px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, opacity: 0.55, cursor: 'not-allowed' }}>Delete workspace</button>
      </div>
    </div>
  );
}

export function PublishingSettings({ c, token }) {
  const [autoPublish, setAutoPublish] = useState(false);
  const [webhook, setWebhook]         = useState('');
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);
  const [err, setErr]                 = useState('');

  useEffect(() => {
    if (!token) return;
    fetch('/api/workspace/settings?publishing=true', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setAutoPublish(!!d.auto_publish); setWebhook(d.publish_webhook_url || ''); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const save = async () => {
    setSaving(true); setSaved(false); setErr('');
    try {
      const r = await fetch('/api/workspace/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'update_publishing', auto_publish: autoPublish, publish_webhook_url: webhook }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || 'Could not save.'); if (d.error?.includes('webhook')) setAutoPublish(false); }
      else { setSaved(true); setTimeout(() => setSaved(false), 2500); }
    } catch { setErr('Network error.'); }
    setSaving(false);
  };

  const field = {
    width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8,
    background: c.bg, border: `1px solid ${c.cardBorder}`, color: c.text,
    fontFamily: 'var(--mono)', fontSize: 13, outline: 'none',
  };
  const lbl = { fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em', color: c.text3, marginBottom: 6, display: 'block' };

  return (
    <div style={{ marginTop: 44 }}>
      <div style={{ marginBottom: 18 }}>
        <p className="wd-label-blue" style={{ marginBottom: 6 }}>AUTONOMOUS PUBLISHING · LEVEL 3</p>
        <h2 style={{ fontFamily: 'var(--inter)', fontSize: 19, fontWeight: 700, color: c.text, margin: 0, letterSpacing: '-0.02em' }}>Let the brain post for you</h2>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3, marginTop: 6, lineHeight: 1.6 }}>
          When on, the brain auto-publishes content drafts it generates from market findings — no confirmation —
          and reports each post to the affected team’s inbox. It POSTs to your webhook (Zapier, Make, n8n or a Slack
          incoming webhook → your socials). Leave off to keep the default: drafts wait for you to confirm.
        </p>
      </div>

      <div style={{ background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: 20 }}>
        {loading ? (
          <p style={{ fontFamily: 'var(--dmsans)', fontSize: 14, color: c.text3, margin: 0 }}>Loading…</p>
        ) : (
          <>
            <label style={lbl}>PUBLISH WEBHOOK URL</label>
            <input style={field} value={webhook} maxLength={2000}
              onChange={e => setWebhook(e.target.value)} placeholder="https://hooks.zapier.com/…  (receives {company, finding, text})" />

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, cursor: 'pointer' }}>
              <input type="checkbox" checked={autoPublish} onChange={e => setAutoPublish(e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
              <span style={{ fontFamily: 'var(--dmsans)', fontSize: 14, color: c.text, fontWeight: 500 }}>
                Enable autonomous publishing (Level 3 — execute &amp; report)
              </span>
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
              <button type="button" onClick={save} disabled={saving}
                style={{
                  padding: '9px 20px', borderRadius: 8, cursor: saving ? 'default' : 'pointer',
                  background: 'rgba(59,110,247,0.1)', border: '1px solid rgba(59,110,247,0.3)',
                  fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: '#3b6ef7',
                  opacity: saving ? 0.6 : 1,
                }}>
                {saving ? 'Saving…' : 'Save publishing'}
              </button>
              {saved && <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: '#10b981' }}>✓ Saved.</span>}
              {err && <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: '#ef4444' }}>{err}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATIONS
// ─────────────────────────────────────────────────────────────────────────────


export default SettingsPage;
