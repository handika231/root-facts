import { useCallback, useEffect, useRef, useState } from 'react';
import Header from './components/Header';
import CameraSection from './components/CameraSection';
import InfoPanel from './components/InfoPanel';
import { useAppState } from './hooks/useAppState';
import { DetectionService } from './services/DetectionService';
import { CameraService } from './services/CameraService';
import { RootFactsService } from './services/RootFactsService';
import { APP_CONFIG, TONE_CONFIG, isValidDetection } from './utils/config';
import { logError } from './utils/common';
import { measureFrameQuality, isFrameAcceptable } from './utils/frameQuality';

function App() {
  const { state, actions } = useAppState();
  const detectionLoopRef = useRef(null);
  const isRunningRef = useRef(false);
  const lastDetectionRef = useRef(null);
  const servicesRef = useRef({ detector: null, camera: null, generator: null });
  const [currentTone, setCurrentTone] = useState(TONE_CONFIG.defaultTone);
  const [loadProgress, setLoadProgress] = useState(0);
  // Hint kualitas frame untuk UI ("Arahkan kamera ke sayuran...", dll.)
  const [scanHint, setScanHint] = useState(null);

  // [Basic] Inisialisasi layanan deteksi, kamera, dan generator fakta saat aplikasi dimuat
  useEffect(() => {
    let cancelled = false;

    const detector = new DetectionService();
    const camera = new CameraService();
    const generator = new RootFactsService();

    servicesRef.current = { detector, camera, generator };
    actions.setServices({ detector, camera, generator });

    (async () => {
      try {
        actions.setModelStatus('Menunggu Model... 0%');

        await detector.loadModel((p) => {
          if (cancelled) return;
          setLoadProgress(p);
          actions.setModelStatus(`Menunggu Model... ${p}%`);
        });

        if (cancelled) return;
        actions.setModelStatus('Memuat AI Generator...');

        try {
          await generator.loadModel((p) => {
            if (cancelled) return;
            actions.setModelStatus(`Memuat AI Generator... ${p}%`);
          });
        } catch (err) {
          logError('RootFactsService.loadModel', err);
        }

        if (!cancelled) {
          actions.setModelStatus('Siap');
        }
      } catch (err) {
        logError('App.init', err);
        if (!cancelled) {
          actions.setError(`Gagal memuat model: ${err.message}`);
          actions.setModelStatus('Gagal memuat model');
        }
      }
    })();

    // [Basic] Bersihkan sumber daya saat komponen ditinggalkan
    return () => {
      cancelled = true;
      isRunningRef.current = false;
      if (detectionLoopRef.current) {
        cancelAnimationFrame(detectionLoopRef.current);
        detectionLoopRef.current = null;
      }
      camera.stopCamera();
      detector.dispose?.();
    };
  }, []);

  // [Basic] Hentikan loop deteksi dan kamera (dipakai juga oleh auto-stop saat generate)
  const stopDetectionAndCamera = useCallback(() => {
    const { camera } = servicesRef.current;
    isRunningRef.current = false;
    if (detectionLoopRef.current) {
      cancelAnimationFrame(detectionLoopRef.current);
      detectionLoopRef.current = null;
    }
    camera?.stopCamera();
    actions.setRunning(false);
  }, [actions]);

  // [Basic] Mapping alasan frame ditolak → pesan UI
  const FRAME_HINTS = {
    'frame-not-ready': 'Menunggu kamera siap...',
    'too-dark': 'Pencahayaan terlalu gelap',
    'too-bright': 'Cahaya terlalu terang',
    'empty-frame': 'Arahkan kamera ke sayuran',
    'blurry-frame': 'Tahan kamera lebih stabil — gambar blur',
    'warmup': 'Menstabilkan kamera...',
    'low-confidence': 'Mencari sayuran yang dikenali...',
    'stabilizing': 'Mengonfirmasi hasil...',
  };

  // [Basic] Fungsi untuk memulai loop deteksi
  const startDetectionLoop = useCallback(() => {
    const { detector, camera, generator } = servicesRef.current;
    if (!detector || !camera) return;

    let lastFrameTime = 0;
    let lastPredictionTime = 0;
    const startTime = performance.now();
    // Stability buffer: butuh N frame berurutan dengan kelas sama
    let stableClass = null;
    let stableCount = 0;

    const setHint = (reason) => {
      setScanHint(FRAME_HINTS[reason] ?? null);
    };

    const loop = async (timestamp) => {
      if (!isRunningRef.current) return;

      const fps = camera.getFPS ? camera.getFPS() : 30;
      const minFrameDelay = 1000 / fps;
      const cooldown = APP_CONFIG.predictionCooldownMs;

      const frameElapsed = timestamp - lastFrameTime >= minFrameDelay;
      const cooldownElapsed = timestamp - lastPredictionTime >= cooldown;

      // [Advance] Warm-up — beri kamera waktu autofokus/exposure sebelum prediksi
      const sinceStart = performance.now() - startTime;
      if (sinceStart < APP_CONFIG.cameraWarmupMs) {
        setHint('warmup');
        detectionLoopRef.current = requestAnimationFrame(loop);
        return;
      }

      if (frameElapsed && cooldownElapsed && camera.isReady()) {
        lastFrameTime = timestamp;
        lastPredictionTime = timestamp;

        try {
          // [Advance] Frame quality gate — tolak frame kosong/gelap/blur
          // SEBELUM model dipanggil. Lebih hemat dan menghindari prediksi acak.
          const quality = measureFrameQuality(camera.video);
          const accept = isFrameAcceptable(quality, APP_CONFIG.frameQuality);
          if (!accept.acceptable) {
            // Reset stability buffer karena scene berubah / tidak valid
            stableClass = null;
            stableCount = 0;
            setHint(accept.reason);
            detectionLoopRef.current = requestAnimationFrame(loop);
            return;
          }

          const result = await detector.predict(camera.video);

          if (!isValidDetection(result)) {
            // Confidence/margin belum cukup — terus pantau
            stableClass = null;
            stableCount = 0;
            setHint('low-confidence');
            detectionLoopRef.current = requestAnimationFrame(loop);
            return;
          }

          // [Advance] Uji stabilitas: butuh N frame berurutan kelas sama
          if (stableClass === result.className) {
            stableCount += 1;
          } else {
            stableClass = result.className;
            stableCount = 1;
          }

          if (stableCount < APP_CONFIG.stabilityFrames) {
            setHint('stabilizing');
            detectionLoopRef.current = requestAnimationFrame(loop);
            return;
          }

          // Sudah stabil — terima hasil
          if (lastDetectionRef.current !== result.className) {
            lastDetectionRef.current = result.className;
            setScanHint(null);
            actions.setDetectionResult(result);
            actions.setFunFactData(null);
            actions.setAppState('result');

            if (generator?.isReady()) {
              // [Advance] Auto-stop kamera saat generator AI mulai menghasilkan
              // deskripsi agar tidak terjadi tumpang tindih antara klasifikasi
              // berikutnya dengan proses generative yang sedang berjalan.
              const detectedName = result.className;
              if (APP_CONFIG.autoStopOnGenerate) {
                stopDetectionAndCamera();
              }

              generator
                .generateFacts(detectedName)
                .then((text) => {
                  if (lastDetectionRef.current === detectedName) {
                    actions.setFunFactData(text);
                  }
                })
                .catch((err) => {
                  logError('generateFacts', err);
                  if (lastDetectionRef.current === detectedName) {
                    actions.setFunFactData('error');
                  }
                });

              if (APP_CONFIG.autoStopOnGenerate) {
                return; // hentikan loop, jangan request frame berikutnya
              }
            } else {
              actions.setFunFactData('error');
            }
          }
        } catch (err) {
          logError('predict loop', err);
        }
      }

      detectionLoopRef.current = requestAnimationFrame(loop);
    };

    detectionLoopRef.current = requestAnimationFrame(loop);
  }, [actions, stopDetectionAndCamera]);

  // [Basic] Fungsi untuk memulai dan menghentikan kamera
  const handleToggleCamera = useCallback(async () => {
    const { camera } = servicesRef.current;
    if (!camera) return;

    if (isRunningRef.current) {
      stopDetectionAndCamera();
      lastDetectionRef.current = null;
      setScanHint(null);
      actions.setAppState('idle');
      actions.setDetectionResult(null);
      actions.setFunFactData(null);
      return;
    }

    try {
      actions.setError(null);
      await camera.startCamera('default');
      isRunningRef.current = true;
      lastDetectionRef.current = null;
      setScanHint(null);
      actions.setRunning(true);
      actions.setAppState('analyzing');
      actions.setDetectionResult(null);
      actions.setFunFactData(null);
      startDetectionLoop();
    } catch (err) {
      logError('handleToggleCamera', err);
      actions.setError(err.message || 'Gagal memulai kamera');
    }
  }, [actions, startDetectionLoop, stopDetectionAndCamera]);

  // [Advance] Fungsi untuk mengubah nada fakta yang dihasilkan
  const handleToneChange = useCallback(
    (newTone) => {
      setCurrentTone(newTone);
      const { generator } = servicesRef.current;
      generator?.setTone(newTone);

      // Regenerasi fakta jika sudah ada deteksi terkini
      const currentDetection = lastDetectionRef.current;
      if (currentDetection && generator?.isReady()) {
        actions.setFunFactData(null);
        generator
          .generateFacts(currentDetection)
          .then((text) => {
            if (lastDetectionRef.current === currentDetection) {
              actions.setFunFactData(text);
            }
          })
          .catch((err) => {
            logError('regenerate on tone change', err);
            actions.setFunFactData('error');
          });
      }
    },
    [actions],
  );

  // [Skilled] Fungsi untuk menyalin fakta ke clipboard
  const handleCopyFact = useCallback(async () => {
    const text = state.funFactData;
    if (!text || typeof text !== 'string' || text === 'error') return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch (err) {
      logError('copyFact', err);
      actions.setError('Gagal menyalin fakta ke papan klip');
    }
  }, [state.funFactData, actions]);

  return (
    <div className="app-container">
      <Header modelStatus={state.modelStatus} loadProgress={loadProgress} />

      <main className="main-content">
        <CameraSection
          isRunning={state.isRunning}
          onToggleCamera={handleToggleCamera}
          onToneChange={handleToneChange}
          services={state.services}
          modelStatus={state.modelStatus}
          error={state.error}
          currentTone={currentTone}
        />

        <InfoPanel
          appState={state.appState}
          detectionResult={state.detectionResult}
          funFactData={state.funFactData}
          error={state.error}
          scanHint={scanHint}
          onCopyFact={handleCopyFact}
        />
      </main>

      <footer className="footer">
        <p>Powered by TensorFlow.js & Transformers.js</p>
      </footer>

      {state.error && (
        <div style={{
          position: 'fixed',
          bottom: '1rem',
          left: '50%',
          transform: 'translateX(-50%)',
          maxWidth: '380px',
          padding: '0.875rem 1rem',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 'var(--radius-md)',
          color: '#991b1b',
          fontSize: '0.8125rem',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          zIndex: 1000
        }}>
          <strong>Error:</strong> {state.error}
          <button
            onClick={() => actions.setError(null)}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: 'none',
              fontSize: '1.25rem',
              cursor: 'pointer',
              color: '#991b1b',
              padding: 0,
              lineHeight: 1
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
