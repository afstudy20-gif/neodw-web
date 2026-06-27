import { useState, useEffect, type ReactNode, type FormEvent } from 'react';

// Casual entry password. NOT a security boundary — the JS bundle is
// public, anyone reading it can find this string. Real protection lives
// at the network layer (private Orthanc + obscure tunnel URL). This is
// just a "are you supposed to be here" speed bump.
const ACCESS_PASSWORD = '2026-1984';
const STORAGE_KEY = 'rdv:unlocked';

interface Props {
  children: ReactNode;
}

export function PasswordGate({ children }: Props) {
  const [unlocked, setUnlocked] = useState<boolean>(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === '1') setUnlocked(true);
    } catch {}
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (input.trim() === ACCESS_PASSWORD) {
      try { sessionStorage.setItem(STORAGE_KEY, '1'); } catch {}
      setUnlocked(true);
      setError(false);
    } else {
      setError(true);
      setInput('');
    }
  }

  if (unlocked) return <>{children}</>;

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--nd-bg, #0f1419)', color: 'var(--nd-text, #e8eaed)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <form onSubmit={handleSubmit} style={{
        background: 'var(--nd-surface, #1a1f24)', padding: 32, borderRadius: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)', width: 360, maxWidth: '90vw',
        border: '1px solid var(--nd-border, #2a2f34)',
      }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>Remote DICOM Viewer</h2>
        <p style={{ margin: '0 0 20px', opacity: 0.7, fontSize: 14 }}>Erişim için şifre girin</p>
        <input
          type="password"
          value={input}
          onChange={(e) => { setInput(e.target.value); if (error) setError(false); }}
          autoFocus
          placeholder="Şifre"
          style={{
            width: '100%', padding: '10px 12px', fontSize: 15,
            background: 'var(--nd-bg, #0f1419)', color: 'inherit',
            border: `1px solid ${error ? '#e74c3c' : 'var(--nd-border, #2a2f34)'}`,
            borderRadius: 6, outline: 'none', boxSizing: 'border-box',
          }}
        />
        {error && (
          <div style={{ color: '#e74c3c', fontSize: 13, marginTop: 8 }}>Şifre yanlış</div>
        )}
        <button type="submit" style={{
          marginTop: 16, width: '100%', padding: '10px', fontSize: 15,
          background: 'var(--nd-primary, #1a4f8a)', color: 'white',
          border: 'none', borderRadius: 6, cursor: 'pointer',
        }}>
          Gir
        </button>
      </form>
    </div>
  );
}
