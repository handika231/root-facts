import { Sprout } from 'lucide-react';

function Header({ modelStatus, loadProgress }) {
  const isModelReady = modelStatus === 'Siap';
  const isLoading = !isModelReady && typeof loadProgress === 'number' && loadProgress < 100;

  return (
    <header className="header">
      <div className="header-content">
        <div className="logo">
          <Sprout size={20} />
          <span>RootFacts</span>
        </div>

        <div className="status-pill" title={modelStatus}>
          <span className={`status-dot ${isModelReady ? 'active' : ''}`}></span>
          <span>{modelStatus}</span>
        </div>
      </div>

      {isLoading && (
        <div
          style={{
            marginTop: '0.5rem',
            height: '3px',
            width: '100%',
            background: 'var(--border-light)',
            borderRadius: '2px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${loadProgress}%`,
              height: '100%',
              background: 'var(--primary)',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      )}
    </header>
  );
}

export default Header;
