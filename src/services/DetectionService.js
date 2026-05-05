import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgpu';
import { isWebGPUSupported, logError, validateModelMetadata } from '../utils/common.js';

const MODEL_URL = '/model/model.json';
const METADATA_URL = '/model/metadata.json';

export class DetectionService {
  constructor() {
    this.model = null;
    this.labels = [];
    this.imageSize = 224;
    this.config = null;
    this.currentBackend = null;
  }

  async _setupBackend() {
    if (isWebGPUSupported()) {
      try {
        await tf.setBackend('webgpu');
        await tf.ready();
        this.currentBackend = 'webgpu';
        return;
      } catch (err) {
        logError('WebGPU init failed, fallback ke WebGL', err);
      }
    }

    try {
      await tf.setBackend('webgl');
      await tf.ready();
      this.currentBackend = 'webgl';
    } catch (err) {
      logError('WebGL init failed, fallback ke CPU', err);
      await tf.setBackend('cpu');
      await tf.ready();
      this.currentBackend = 'cpu';
    }
  }

  async loadModel(onProgress) {
    await this._setupBackend();

    const reportProgress = (value) => {
      if (typeof onProgress === 'function') onProgress(value);
    };

    reportProgress(0);

    const [metadata, model] = await Promise.all([
      fetch(METADATA_URL).then((r) => r.json()),
      tf.loadLayersModel(MODEL_URL, {
        onProgress: (frac) => reportProgress(Math.round(frac * 100)),
      }),
    ]);

    if (!validateModelMetadata(metadata)) {
      throw new Error('Metadata model tidak valid');
    }

    this.labels = metadata.labels;
    this.imageSize = metadata.imageSize || 224;
    this.model = model;
    this.config = metadata;

    reportProgress(100);
    return { backend: this.currentBackend, labels: this.labels };
  }

  async predict(imageElement) {
    if (!this.isLoaded()) {
      throw new Error('Model deteksi belum dimuat');
    }

    const { topClass, topScore } = tf.tidy(() => {
      const tensor = tf.browser
        .fromPixels(imageElement)
        .resizeBilinear([this.imageSize, this.imageSize])
        .toFloat()
        .div(127.5)
        .sub(1)
        .expandDims(0);

      const logits = this.model.predict(tensor);
      const data = logits.dataSync();

      let bestIdx = 0;
      let bestScore = data[0];
      for (let i = 1; i < data.length; i++) {
        if (data[i] > bestScore) {
          bestScore = data[i];
          bestIdx = i;
        }
      }

      return { topClass: bestIdx, topScore: bestScore };
    });

    const className = this.labels[topClass] || 'Unknown';
    const confidence = Math.round(topScore * 100);
    const isValid = topScore >= 0.5;

    return {
      className,
      score: topScore,
      confidence,
      isValid,
      index: topClass,
    };
  }

  isLoaded() {
    return this.model !== null;
  }

  getBackend() {
    return this.currentBackend;
  }

  dispose() {
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
  }
}
