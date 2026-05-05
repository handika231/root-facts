/* global self */

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';

self.skipWaiting();
clientsClaim();

// Precache: aset inti (HTML/CSS/JS/icons/manifest) + model TF.js (.json + .bin)
// Daftar file di-inject otomatis oleh Workbox dari injectManifest.globPatterns
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Runtime cache: model Transformers.js dari huggingface.co (CacheFirst, 90 hari)
registerRoute(
  ({ url }) =>
    url.origin === 'https://huggingface.co' ||
    url.origin === 'https://cdn-lfs.huggingface.co' ||
    url.origin === 'https://cdn-lfs.hf.co',
  new CacheFirst({
    cacheName: 'hf-models',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 30,
        maxAgeSeconds: 60 * 60 * 24 * 90,
        purgeOnQuotaError: true,
      }),
    ],
  }),
);

// Runtime cache: Google Fonts stylesheet (StaleWhileRevalidate)
registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new StaleWhileRevalidate({ cacheName: 'google-fonts-stylesheets' }),
);

// Runtime cache: Google Fonts webfont files (CacheFirst, 1 tahun)
registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'google-fonts-webfonts',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 30,
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
    ],
  }),
);
