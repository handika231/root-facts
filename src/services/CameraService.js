import { getCameraErrorMessage, logError } from '../utils/common.js';

export class CameraService {
  constructor() {
    this.stream = null;
    this.video = null;
    this.canvas = null;
    this.cameras = [];
    this.fps = 30;
    this.selectedCameraId = 'default';
    this.config = null;
  }

  setVideoElement(videoElement) {
    this.video = videoElement;
  }

  setCanvasElement(canvasElement) {
    this.canvas = canvasElement;
  }

  async loadCameras() {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        return [];
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.cameras = devices.filter((d) => d.kind === 'videoinput');
      return this.cameras;
    } catch (err) {
      logError('CameraService.loadCameras', err);
      return [];
    }
  }

  getConstraints(selectedCameraId) {
    const video = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: this.fps, max: this.fps },
    };

    if (selectedCameraId === 'front') {
      video.facingMode = 'user';
    } else if (!selectedCameraId || selectedCameraId === 'default') {
      video.facingMode = { ideal: 'environment' };
    } else {
      video.deviceId = { exact: selectedCameraId };
    }

    return { video, audio: false };
  }

  async startCamera(selectedCameraId = 'default') {
    if (!this.video) {
      throw new Error('Elemen video belum tersedia');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Browser tidak mendukung MediaStream API');
    }

    this.stopCamera();
    this.selectedCameraId = selectedCameraId;

    try {
      const constraints = this.getConstraints(selectedCameraId);
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;

      await new Promise((resolve, reject) => {
        const onLoaded = () => {
          this.video.removeEventListener('loadedmetadata', onLoaded);
          this.video.removeEventListener('error', onError);
          resolve();
        };
        const onError = (e) => {
          this.video.removeEventListener('loadedmetadata', onLoaded);
          this.video.removeEventListener('error', onError);
          reject(e);
        };
        this.video.addEventListener('loadedmetadata', onLoaded);
        this.video.addEventListener('error', onError);
      });

      try {
        await this.video.play();
      } catch (e) {
        logError('video.play()', e);
      }

      if (this.canvas) {
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
      }

      return this.stream;
    } catch (err) {
      logError('CameraService.startCamera', err);
      throw new Error(getCameraErrorMessage(err));
    }
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
  }

  setFPS(fps) {
    const next = Number(fps);
    if (!Number.isFinite(next) || next <= 0) return;
    this.fps = next;

    if (this.stream) {
      const track = this.stream.getVideoTracks()[0];
      if (track && typeof track.applyConstraints === 'function') {
        track
          .applyConstraints({ frameRate: { ideal: this.fps, max: this.fps } })
          .catch((err) => logError('applyConstraints frameRate', err));
      }
    }
  }

  getFPS() {
    return this.fps;
  }

  isActive() {
    return this.stream !== null && this.stream.active === true;
  }

  isReady() {
    return (
      this.video !== null &&
      this.video.readyState >= 2 &&
      this.video.videoWidth > 0 &&
      this.video.videoHeight > 0
    );
  }
}
