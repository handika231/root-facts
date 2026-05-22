export const APP_CONFIG = {
  // Ambang minimum confidence (0-100) supaya prediksi diterima
  detectionConfidenceThreshold: 75,
  // Margin minimum top-1 - top-2 (0-1). Mencegah prediksi "tebakan dekat"
  // saat dua kelas hampir sama skornya (mis. frame kosong / objek ambigu).
  detectionMarginThreshold: 0.18,
  // Berapa frame berurutan dengan kelas sama harus terjadi sebelum hasil
  // dianggap stabil. Mencegah satu prediksi flukey langsung jadi hasil final.
  stabilityFrames: 3,
  // Jeda antar prediksi klasifikasi (ms) supaya tidak tumpang tindih.
  // Total waktu konfirmasi = stabilityFrames * predictionCooldownMs.
  predictionCooldownMs: 500,
  // Warm-up setelah kamera nyala — beri waktu autofokus & exposure stabil
  // sebelum mulai memprediksi.
  cameraWarmupMs: 1200,
  // Hentikan kamera otomatis saat generator AI mulai menghasilkan deskripsi
  autoStopOnGenerate: true,
  // Heuristik kualitas frame (lihat utils/frameQuality.js)
  frameQuality: {
    minMean: 20,
    maxMean: 240,
    minVariance: 180,
    minEdgeDensity: 6,
  },
  analyzingDelay: 2000,
  factsGenerationDelay: 2000,
  detectionRetryInterval: 100,
};

export const TONE_CONFIG = {
  availableTones: [
    { value: 'normal', label: 'Normal' },
    { value: 'funny', label: 'Lucu' },
    { value: 'professional', label: 'Profesional' },
    { value: 'casual', label: 'Santai' }
  ],
  defaultTone: 'normal'
};

export const isValidDetection = (result) => {
  const { detectionConfidenceThreshold, detectionMarginThreshold } = APP_CONFIG;
  if (!result || !result.isValid) return false;
  if (result.confidence < detectionConfidenceThreshold) return false;
  // Margin antara top-1 dan top-2 harus cukup besar agar bukan "tebakan dekat"
  if (typeof result.margin === 'number' && result.margin < detectionMarginThreshold) {
    return false;
  }
  return true;
};
