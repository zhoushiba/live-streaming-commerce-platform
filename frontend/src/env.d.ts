/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

/**
 * flv.js 只发布 UMD 产物、没有自带 .d.ts，这里给出本项目用到的
 * 最小类型声明（LivePlayer / 点播播放器只需要 attach + load + on）。
 */
declare module 'flv.js' {
  export interface FlvMediaDataSource {
    type?: 'flv' | 'mp4';
    url?: string;
    isLive?: boolean;
    hasAudio?: boolean;
    hasVideo?: boolean;
    cors?: boolean;
    withCredentials?: boolean;
  }

  export interface FlvPlayer {
    attachMediaElement(element: HTMLMediaElement): void;
    detachMediaElement(): void;
    load(): void;
    unload(): void;
    play(): void;
    pause(): void;
    destroy(): void;
    on(event: string, listener: (...args: any[]) => void): void;
    off(event: string, listener: (...args: any[]) => void): void;
  }

  export const Events: Record<string, string>;
  export const ErrorTypes: Record<string, string>;
  export const ErrorDetails: Record<string, string>;
  export function isSupported(): boolean;
  export function createPlayer(mediaDataSource: FlvMediaDataSource, config?: Record<string, unknown>): FlvPlayer;

  const flvjs: {
    Events: typeof Events;
    ErrorTypes: typeof ErrorTypes;
    ErrorDetails: typeof ErrorDetails;
    isSupported: typeof isSupported;
    createPlayer: typeof createPlayer;
  };
  export default flvjs;
}
