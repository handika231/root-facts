// [Advance] Heuristik kualitas frame: variance luminance + densitas tepi.
// Tujuannya menolak frame kosong (dinding polos), gelap, terlalu terang,
// atau blur sebelum dikirim ke model klasifikasi.

const SAMPLE_SIZE = 64;
let _canvas = null;
let _ctx = null;

function getCanvas() {
  if (!_canvas) {
    _canvas = document.createElement('canvas');
    _canvas.width = SAMPLE_SIZE;
    _canvas.height = SAMPLE_SIZE;
    _ctx = _canvas.getContext('2d', { willReadFrequently: true });
  }
  return { canvas: _canvas, ctx: _ctx };
}

/**
 * Mengukur kualitas frame video.
 * - mean: kecerahan rata-rata (0-255)
 * - variance: variansi luminance (frame polos punya variance kecil)
 * - edgeDensity: rata-rata gradien Sobel sederhana (blur punya edge rendah)
 */
export function measureFrameQuality(video) {
  if (!video || video.readyState < 2 || !video.videoWidth) {
    return { ok: false, reason: 'frame-not-ready' };
  }

  const { ctx } = getCanvas();
  ctx.drawImage(video, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

  const n = SAMPLE_SIZE * SAMPLE_SIZE;
  const lum = new Float32Array(n);

  let sum = 0;
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    lum[j] = l;
    sum += l;
  }
  const mean = sum / n;

  let varAcc = 0;
  for (let j = 0; j < n; j++) {
    const d = lum[j] - mean;
    varAcc += d * d;
  }
  const variance = varAcc / n;

  // Sobel-lite (gradien horizontal+vertikal)
  let edgeAcc = 0;
  const w = SAMPLE_SIZE;
  for (let y = 1; y < SAMPLE_SIZE - 1; y++) {
    for (let x = 1; x < SAMPLE_SIZE - 1; x++) {
      const i = y * w + x;
      const gx = lum[i + 1] - lum[i - 1];
      const gy = lum[i + w] - lum[i - w];
      edgeAcc += Math.abs(gx) + Math.abs(gy);
    }
  }
  const edgeDensity = edgeAcc / ((SAMPLE_SIZE - 2) * (SAMPLE_SIZE - 2));

  return { ok: true, mean, variance, edgeDensity };
}

/**
 * Cek apakah frame layak diprediksi.
 */
export function isFrameAcceptable(quality, opts) {
  if (!quality?.ok) return { acceptable: false, reason: quality?.reason || 'invalid' };
  const { mean, variance, edgeDensity } = quality;
  const {
    minMean = 20,        // terlalu gelap
    maxMean = 240,       // terlalu terang / overexposed
    minVariance = 180,   // frame polos / dinding kosong
    minEdgeDensity = 6,  // frame blur / tidak fokus
  } = opts || {};

  if (mean < minMean) return { acceptable: false, reason: 'too-dark' };
  if (mean > maxMean) return { acceptable: false, reason: 'too-bright' };
  if (variance < minVariance) return { acceptable: false, reason: 'empty-frame' };
  if (edgeDensity < minEdgeDensity) return { acceptable: false, reason: 'blurry-frame' };

  return { acceptable: true };
}
