import { pipeline } from '@huggingface/transformers';
import { TONE_CONFIG } from '../utils/config.js';
import { isWebGPUSupported, logError } from '../utils/common.js';

const MODEL_NAME = 'Xenova/LaMini-Flan-T5-77M';

const TONE_PROMPT_BUILDERS = {
  normal: (name) =>
    `Write one short and interesting fun fact (max 2 sentences) about the vegetable called ${name}.`,
  funny: (name) =>
    `Write one short, funny, and humorous fact (max 2 sentences) about the vegetable called ${name}. Use a playful tone.`,
  professional: (name) =>
    `Write one short scientific and professional fact (max 2 sentences) about the vegetable called ${name}. Use a formal academic tone.`,
  casual: (name) =>
    `Write one short and casual fun fact (max 2 sentences) about the vegetable called ${name}. Use a friendly conversational tone.`,
};

export class RootFactsService {
  constructor() {
    this.generator = null;
    this.isModelLoaded = false;
    this.isGenerating = false;
    this.config = null;
    this.currentBackend = null;
    this.currentTone = TONE_CONFIG.defaultTone;
  }

  async _initPipeline(device, onProgress) {
    return pipeline('text2text-generation', MODEL_NAME, {
      device,
      progress_callback: (data) => {
        if (typeof onProgress === 'function' && data?.progress != null) {
          onProgress(Math.round(data.progress));
        }
      },
    });
  }

  async loadModel(onProgress) {
    if (isWebGPUSupported()) {
      try {
        this.generator = await this._initPipeline('webgpu', onProgress);
        this.currentBackend = 'webgpu';
      } catch (err) {
        logError('Transformers webgpu init failed, fallback ke wasm', err);
      }
    }

    if (!this.generator) {
      this.generator = await this._initPipeline('wasm', onProgress);
      this.currentBackend = 'wasm';
    }

    this.isModelLoaded = true;
    if (typeof onProgress === 'function') onProgress(100);

    return { backend: this.currentBackend };
  }

  setTone(tone) {
    const valid = TONE_CONFIG.availableTones.some((t) => t.value === tone);
    if (valid) this.currentTone = tone;
  }

  getTone() {
    return this.currentTone;
  }

  _buildPrompt(vegetableName) {
    const builder =
      TONE_PROMPT_BUILDERS[this.currentTone] || TONE_PROMPT_BUILDERS.normal;
    return builder(vegetableName);
  }

  async generateFacts(vegetableName) {
    if (!this.isReady()) {
      throw new Error('Generator AI belum siap');
    }
    if (this.isGenerating) return null;

    this.isGenerating = true;
    try {
      const prompt = this._buildPrompt(vegetableName);

      const output = await this.generator(prompt, {
        max_new_tokens: 80,
        temperature: 0.8,
        top_p: 0.9,
        do_sample: true,
        repetition_penalty: 1.2,
      });

      const text = Array.isArray(output)
        ? output[0]?.generated_text
        : output?.generated_text;

      const cleaned = (text || '').trim();
      return cleaned || 'Tidak ada fakta yang dapat dihasilkan.';
    } finally {
      this.isGenerating = false;
    }
  }

  isReady() {
    return this.isModelLoaded && this.generator !== null;
  }

  getBackend() {
    return this.currentBackend;
  }
}
