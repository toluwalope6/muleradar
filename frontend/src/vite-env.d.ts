/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_SOURCE?: 'live' | 'mock';
  readonly VITE_API_BASE_URL?: string;
}
