/// <reference types="vite/client" />

import type { CodeRecoderDesktopApi } from '../../shared/contracts.js';

declare global {
  interface Window {
    codeRecoder?: CodeRecoderDesktopApi;
  }
}

export {};
