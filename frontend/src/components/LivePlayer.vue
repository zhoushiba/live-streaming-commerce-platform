<template>
  <div
    ref="containerRef"
    class="player"
    :class="{ 'is-fullscreen': isFullscreen, 'is-idle': !showControls, 'is-locked': status === 'locked' }"
    tabindex="0"
    @mousemove="revealControls"
    @mouseleave="scheduleHide"
    @keydown="onKeydown"
  >
    <!-- 真实视频元素：hls.js / flv.js 都通过 MSE 往这里灌数据 -->
    <video
      ref="videoRef"
      class="player__video"
      playsinline
      :poster="poster || undefined"
      preload="none"
      @click="togglePlay"
      @playing="onPlaying"
      @pause="onPause"
      @waiting="onWaiting"
      @error="onVideoError"
    ></video>

    <!-- demo 模式状态机：无可用直播源时用 Canvas 模拟播放器画面 -->
    <canvas v-show="engine === 'demo'" ref="canvasRef" class="player__canvas"></canvas>

    <!-- 顶栏：模式 / 清晰度 / 实时数据 -->
    <div class="player__top" :class="{ 'is-visible': showControls || status !== 'playing' }">
      <div class="player__top-left">
        <span v-if="activeInfo?.status === 'living'" class="badge badge--live">
          <i class="dot"></i>LIVE
        </span>
        <span v-else-if="engine === 'demo'" class="badge badge--demo">DEMO 演示</span>
        <span v-else class="badge badge--idle">未开播</span>
        <span class="badge badge--ghost">{{ protocolLabel }}</span>
        <span class="badge badge--ghost">{{ currentQuality }}</span>
      </div>
      <div class="player__top-right">
        <span v-if="bitrateKbps" class="stat">{{ bitrateKbps }} kbps</span>
        <span v-if="latencySec !== null" class="stat">延迟 {{ latencySec.toFixed(1) }}s</span>
        <span class="stat">断流重连 {{ retryAttempt }}/{{ maxRetry }}</span>
      </div>
    </div>

    <!-- 加载态 -->
    <div v-if="status === 'loading'" class="player__overlay player__overlay--soft">
      <div class="spinner"></div>
      <p>正在拉取直播流…</p>
      <span class="tip">{{ protocolLabel }} · {{ currentQuality }}</span>
    </div>

    <!-- 断流重连 -->
    <div v-else-if="status === 'reconnecting'" class="player__overlay">
      <el-icon class="overlay-icon"><Refresh /></el-icon>
      <p>连接中断，{{ countdown }} 秒后重试（第 {{ retryAttempt }} 次）</p>
      <span class="tip">{{ lastError || '网络抖动或推流端已断开' }}</span>
      <el-button size="small" round @click="retryNow">立即重连</el-button>
    </div>

    <!-- 付费墙 -->
    <div v-else-if="status === 'locked'" class="player__overlay player__overlay--lock">
      <el-icon class="overlay-icon"><Lock /></el-icon>
      <p class="lock-title">付费直播间</p>
      <p class="lock-desc">{{ activeInfo?.lockReason || '购买后即可观看' }}</p>
      <div v-if="activeInfo?.price" class="lock-price">
        <span class="mono">¥{{ activeInfo.price.amount }}</span>
        <span class="text-muted">/ {{ activeInfo.price.priceType === 'monthly' ? '月' : activeInfo.price.priceType === 'yearly' ? '年' : '次' }}</span>
      </div>
      <el-button type="primary" round @click="emit('unlock')">立即解锁</el-button>
    </div>

    <!-- 彻底失败 -->
    <div v-else-if="status === 'error'" class="player__overlay">
      <el-icon class="overlay-icon"><WarningFilled /></el-icon>
      <p>直播流加载失败</p>
      <span class="tip">{{ lastError }}</span>
      <div class="overlay-actions">
        <el-button size="small" round @click="restart">重新加载</el-button>
        <el-button size="small" round type="primary" @click="enterDemo('手动切换到演示模式')">进入演示模式</el-button>
      </div>
    </div>

    <!-- demo 提示条 -->
    <div v-if="engine === 'demo'" class="player__demo-tip">
      <el-icon><InfoFilled /></el-icon>
      <span>{{ demoNotice }}</span>
    </div>

    <!-- 暂停大按钮 -->
    <button v-if="status === 'paused' && engine !== 'demo'" class="player__bigplay" @click="togglePlay" aria-label="播放">
      <el-icon :size="34"><VideoPlay /></el-icon>
    </button>

    <!-- 底栏控制 -->
    <div class="player__controls" :class="{ 'is-visible': showControls || status !== 'playing' }">
      <button class="ctl" :disabled="status === 'locked' || status === 'error'" @click="togglePlay" :title="status === 'paused' ? '播放' : '暂停'">
        <el-icon :size="18"><VideoPause v-if="status === 'playing'" /><VideoPlay v-else /></el-icon>
      </button>

      <div class="ctl-volume">
        <button class="ctl" @click="toggleMute" :title="muted ? '取消静音' : '静音'">
          <el-icon :size="18"><Mute v-if="muted || volume === 0" /><Bell v-else /></el-icon>
        </button>
        <input
          v-model.number="volume"
          class="volume-range"
          type="range"
          min="0"
          max="1"
          step="0.05"
          aria-label="音量"
          @input="onVolumeInput"
        />
      </div>

      <span class="ctl-time mono">{{ liveClock }}</span>
      <span class="ctl-spacer"></span>

      <button class="ctl" :class="{ 'is-on': showDanmaku }" title="弹幕开关" @click="toggleDanmaku">
        <el-icon :size="18"><ChatDotRound /></el-icon>
      </button>

      <el-dropdown trigger="click" @command="onQuality" :disabled="qualityOptions.length <= 1">
        <button class="ctl ctl--text">{{ currentQuality }}<el-icon :size="12"><ArrowDown /></el-icon></button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="q in qualityOptions" :key="q" :command="q" :disabled="q === currentQuality">
              {{ q }}<span v-if="q === currentQuality" class="text-muted">（当前）</span>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>

      <button class="ctl" title="重新加载" @click="restart">
        <el-icon :size="18"><Refresh /></el-icon>
      </button>

      <button class="ctl" :title="isFullscreen ? '退出全屏' : '全屏'" @click="toggleFullscreen">
        <el-icon :size="18"><FullScreen /></el-icon>
      </button>
    </div>

    <div v-if="showUnmuteHint" class="player__unmute" @click="unmute">
      <el-icon><Bell /></el-icon> 浏览器拦截了有声自动播放，点击开启声音
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Hls from 'hls.js';
import flvjs from 'flv.js';
import {
  ArrowDown,
  Bell,
  ChatDotRound,
  FullScreen,
  InfoFilled,
  Lock,
  Mute,
  Refresh,
  VideoPause,
  VideoPlay,
  WarningFilled,
} from '@element-plus/icons-vue';
import { streamApi } from '@/api';
import type { PlayInfo, PlaySource } from '@/api/types';

type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'reconnecting' | 'error' | 'locked' | 'demo';
type Engine = 'none' | 'hls' | 'hls-native' | 'flv' | 'demo';

const props = defineProps<{
  roomId: number;
  playInfo: PlayInfo | null;
  poster?: string | null;
  title?: string;
}>();

const emit = defineEmits<{
  (e: 'unlock'): void;
  (e: 'quality-change', quality: string): void;
  (e: 'status', status: PlayerStatus): void;
  (e: 'danmaku-toggle', visible: boolean): void;
}>();

const containerRef = ref<HTMLDivElement | null>(null);
const videoRef = ref<HTMLVideoElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

const activeInfo = ref<PlayInfo | null>(null);
const engine = ref<Engine>('none');
const status = ref<PlayerStatus>('idle');
const lastError = ref('');
const demoNotice = ref('');
const currentQuality = ref('720p');
const currentProtocol = ref<'hls' | 'flv' | 'demo'>('hls');
const retryAttempt = ref(0);
const countdown = ref(0);
const bitrateKbps = ref(0);
const latencySec = ref<number | null>(null);
const muted = ref(false);
const volume = ref(0.7);
const showControls = ref(true);
const isFullscreen = ref(false);
const showDanmaku = ref(true);
const showUnmuteHint = ref(false);
const liveClock = ref('--:--:--');

/** 播放器内部状态（不用 ref，避免被响应式代理影响 MSE 对象） */
let hls: Hls | null = null;
let flv: ReturnType<typeof flvjs.createPlayer> | null = null;
let retryTimer: number | null = null;
let countdownTimer: number | null = null;
let hideTimer: number | null = null;
let clockTimer: number | null = null;
let demoRaf: number | null = null;
let demoObserver: ResizeObserver | null = null;
let demoPaused = false;
let sourceIndex = 0;
let mounted = false;

const maxRetry = computed(() => activeInfo.value?.retry?.max ?? 5);

/** 候选源排序：按后端下发的 fallbackOrder（默认 hls → flv），同协议内默认清晰度优先 */
const candidates = computed<PlaySource[]>(() => {
  const info = activeInfo.value;
  if (!info) return [];
  const order = info.fallbackOrder?.length ? info.fallbackOrder : ['hls', 'flv'];
  return [...info.sources].sort((a, b) => {
    const oa = order.indexOf(a.protocol);
    const ob = order.indexOf(b.protocol);
    if (oa !== ob) return (oa === -1 ? 99 : oa) - (ob === -1 ? 99 : ob);
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.quality.localeCompare(b.quality);
  });
});

const qualityOptions = computed(() => {
  const seen = new Set<string>();
  for (const s of activeInfo.value?.sources ?? []) {
    if (s.protocol === currentProtocol.value) seen.add(s.quality);
  }
  if (seen.size === 0) {
    for (const s of activeInfo.value?.sources ?? []) seen.add(s.quality);
  }
  return [...seen];
});

const protocolLabel = computed(() => {
  if (engine.value === 'demo') return 'DEMO';
  return currentProtocol.value === 'flv' ? 'HTTP-FLV' : 'HLS';
});

/* ------------------------------------------------------------ 生命周期 */

onMounted(() => {
  mounted = true;
  clockTimer = window.setInterval(() => {
    liveClock.value = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  }, 1000);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  start(props.playInfo);
});

onBeforeUnmount(() => {
  mounted = false;
  teardown();
  if (clockTimer) window.clearInterval(clockTimer);
  document.removeEventListener('fullscreenchange', onFullscreenChange);
});

watch(
  () => props.playInfo,
  (info) => {
    if (mounted) start(info);
  },
  { deep: false },
);

watch(status, (value) => {
  emit('status', value);
  if (value === 'playing') scheduleHide();
});

/* ------------------------------------------------------------ 启动 / 销毁 */

function start(info: PlayInfo | null) {
  activeInfo.value = info;
  teardown();

  if (!info) {
    status.value = 'idle';
    return;
  }
  if (info.locked) {
    status.value = 'locked';
    return;
  }
  if (!info.sources.length) {
    enterDemo('该直播间暂无可用直播源');
    return;
  }

  sourceIndex = 0;
  retryAttempt.value = 0;
  lastError.value = '';
  const preferred = info.sources.find((s) => s.isDefault) ?? info.sources[0];
  currentQuality.value = preferred.quality;
  tryLoad();
}

/** 清理所有引擎与定时器，保证切换源/清晰度时没有悬挂的 MSE 实例 */
function teardown() {
  if (retryTimer) window.clearTimeout(retryTimer);
  if (countdownTimer) window.clearInterval(countdownTimer);
  if (demoRaf) cancelAnimationFrame(demoRaf);
  retryTimer = null;
  countdownTimer = null;
  demoRaf = null;
  demoObserver?.disconnect();
  demoObserver = null;
  countdown.value = 0;

  if (hls) {
    hls.destroy();
    hls = null;
  }
  if (flv) {
    try {
      flv.pause();
      flv.unload();
      flv.detachMediaElement();
      flv.destroy();
    } catch {
      /* flv.js 在未加载完成时 destroy 可能抛错，忽略 */
    }
    flv = null;
  }
  const video = videoRef.value;
  if (video) {
    video.removeAttribute('src');
    try {
      video.load();
    } catch {
      /* noop */
    }
  }
  engine.value = 'none';
  bitrateKbps.value = 0;
  latencySec.value = null;
}

function restart() {
  if (activeInfo.value) start(activeInfo.value);
}

/* ------------------------------------------------------------ 拉流：HLS */

function tryLoad() {
  const list = candidates.value;
  if (sourceIndex >= list.length) {
    if (list.length > 0) enterDemo('所有直播协议均不可用，已切到演示模式');
    else enterDemo('该直播间暂无可用直播源');
    return;
  }

  const source = list[sourceIndex];
  currentQuality.value = source.quality;
  currentProtocol.value = source.protocol;
  status.value = 'loading';
  emit('quality-change', source.quality);

  if (source.protocol === 'flv') loadFlv(source);
  else loadHls(source);
}

function loadHls(source: PlaySource) {
  const video = videoRef.value;
  if (!video) return;

  // Safari 原生支持 m3u8，直接给 src 更省 CPU
  if (!Hls.isSupported() && video.canPlayType('application/vnd.apple.mpegurl')) {
    engine.value = 'hls-native';
    video.src = source.url;
    void safePlay();
    return;
  }
  if (!Hls.isSupported()) {
    fail('当前浏览器不支持 HLS（MSE 不可用）');
    return;
  }

  engine.value = 'hls';
  const instance = new Hls({
    enableWorker: true,
    lowLatencyMode: true,
    backBufferLength: 30,
    maxBufferLength: 12,
    liveSyncDurationCount: 3,
    manifestLoadingMaxRetry: 2,
    levelLoadingMaxRetry: 2,
    fragLoadingMaxRetry: 2,
  });
  hls = instance;

  instance.on(Hls.Events.MEDIA_ATTACHED, () => instance.loadSource(source.url));
  instance.on(Hls.Events.MANIFEST_PARSED, () => {
    void safePlay();
  });
  instance.on(Hls.Events.FRAG_BUFFERED, () => {
    const level = instance.levels[instance.currentLevel];
    if (level?.bitrate) bitrateKbps.value = Math.round(level.bitrate / 1000);
    const latency = (instance as unknown as { latency?: number }).latency;
    if (typeof latency === 'number') latencySec.value = latency;
  });
  instance.on(Hls.Events.ERROR, (_event, data) => {
    if (!data.fatal) return;
    // 媒体错误先尝试 hls.js 自带恢复，失败再走我们的降级链路
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      fail(`HLS 网络错误：${data.details}`);
    } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      fail(`HLS 解码错误：${data.details}`);
    } else {
      fail(`HLS 致命错误：${data.details}`);
    }
  });

  instance.attachMedia(video);
}

/* ------------------------------------------------------------ 拉流：FLV */

function loadFlv(source: PlaySource) {
  const video = videoRef.value;
  if (!video) return;
  if (!flvjs.isSupported()) {
    fail('当前浏览器不支持 HTTP-FLV 播放');
    return;
  }

  engine.value = 'flv';
  const instance = flvjs.createPlayer(
    { type: 'flv', url: source.url, isLive: true, hasAudio: true, cors: true },
    {
      enableWorker: false,
      enableStashBuffer: false,
      stashInitialSize: 128,
      lazyLoad: false,
      fixAudioTimestampGap: false,
      autoCleanupSourceBuffer: true,
    },
  );
  flv = instance;

  instance.on(flvjs.Events.ERROR, (type: string, detail: string) => {
    fail(`FLV ${type}：${detail}`);
  });
  instance.on(flvjs.Events.STATISTICS_INFO, (info: { speed?: number; decodedFrames?: number; droppedFrames?: number }) => {
    if (typeof info.speed === 'number') bitrateKbps.value = Math.round(info.speed * 8);
  });
  instance.attachMediaElement(video);
  instance.load();
  void safePlay();
}

/* ------------------------------------------------------------ 失败与重连 */

/**
 * 降级链路：
 *   同一个源 → 指数退避重连（最多 maxRetry 次）
 *   → 下一个协议/清晰度（HLS → FLV）
 *   → 全部失败 → demo 演示模式
 */
function fail(reason: string) {
  if (!mounted) return;
  lastError.value = reason;
  teardown();
  if (retryAttempt.value < maxRetry.value) {
    retryAttempt.value += 1;
    scheduleReconnect();
    return;
  }
  retryAttempt.value = 0;
  sourceIndex += 1;
  if (sourceIndex < candidates.value.length) {
    tryLoad();
  } else {
    enterDemo('直播流不可达（断流/未推流/网络受限），已启用演示模式');
  }
}

function scheduleReconnect() {
  const retry = activeInfo.value?.retry;
  const base = retry?.baseDelay ?? 1000;
  const cap = retry?.maxDelay ?? 10000;
  const delay = Math.min(cap, base * 2 ** (retryAttempt.value - 1));
  status.value = 'reconnecting';
  countdown.value = Math.ceil(delay / 1000);

  if (countdownTimer) window.clearInterval(countdownTimer);
  countdownTimer = window.setInterval(() => {
    countdown.value -= 1;
  }, 1000);

  if (retryTimer) window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => {
    if (countdownTimer) window.clearInterval(countdownTimer);
    countdownTimer = null;
    countdown.value = 0;
    tryLoad();
  }, delay);
}

function retryNow() {
  if (retryTimer) window.clearTimeout(retryTimer);
  if (countdownTimer) window.clearInterval(countdownTimer);
  countdown.value = 0;
  tryLoad();
}

/* ------------------------------------------------------------ demo 演示模式 */

function enterDemo(reason: string) {
  teardown();
  engine.value = 'demo';
  status.value = 'demo';
  currentProtocol.value = 'demo';
  demoNotice.value = reason;
  demoPaused = false;
  void nextTick(() => startDemoCanvas());
}

/**
 * demo 状态机：没有真实推流时，用 Canvas 渲染一个「正在直播」的示意画面，
 * 同时把播放器的加载/播放/暂停/重连状态照常驱动，保证 UI 体验与真实播放一致。
 */
function startDemoCanvas() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  };
  resize();

  demoObserver?.disconnect();
  demoObserver = new ResizeObserver(resize);
  demoObserver.observe(canvas);

  let start = performance.now();
  let pausedAt = 0;

  const draw = (now: number) => {
    if (!mounted || engine.value !== 'demo') {
      return;
    }
    const w = canvas.width;
    const h = canvas.height;
    const t = demoPaused ? pausedAt : (now - start) / 1000;
    if (demoPaused) start = now - pausedAt * 1000;

    // 背景渐变
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, `hsl(${230 + Math.sin(t / 3) * 12}, 62%, 14%)`);
    g.addColorStop(1, `hsl(${270 + Math.cos(t / 4) * 10}, 58%, 20%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 声波柱
    const bars = 48;
    const bw = w / bars;
    for (let i = 0; i < bars; i += 1) {
      const amp = (Math.sin(t * 2 + i * 0.35) * 0.5 + 0.5) * 0.6 + 0.15;
      const bh = amp * h * 0.42;
      ctx.fillStyle = `hsla(${200 + i * 2.2}, 90%, 65%, ${0.16 + amp * 0.32})`;
      ctx.fillRect(i * bw + bw * 0.18, h * 0.62 - bh / 2, bw * 0.64, bh);
    }

    // 流动光斑
    for (let i = 0; i < 3; i += 1) {
      const cx = ((t * (26 + i * 14) + i * 380) % (w + 300)) - 150;
      const cy = h * 0.42 + Math.sin(t * 0.8 + i) * h * 0.12;
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 160 * dpr);
      rg.addColorStop(0, `hsla(${210 + i * 40}, 100%, 70%, 0.22)`);
      rg.addColorStop(1, 'transparent');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(cx, cy, 160 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    // 文案
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(238, 242, 255, 0.94)';
    ctx.font = `600 ${Math.round(26 * dpr)}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.fillText(demoPaused ? '演示流已暂停' : '演示直播流', w / 2, h * 0.36);

    ctx.fillStyle = 'rgba(164, 176, 208, 0.85)';
    ctx.font = `${Math.round(13 * dpr)}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.fillText('DEMO MODE · 无真实推流时由播放器状态机渲染', w / 2, h * 0.44);

    // 计时器
    ctx.fillStyle = 'rgba(47, 214, 166, 0.95)';
    ctx.font = `600 ${Math.round(15 * dpr)}px "JetBrains Mono", Consolas, monospace`;
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(Math.floor(t % 60)).padStart(2, '0');
    ctx.fillText(`● ${mm}:${ss}`, w / 2, h * 0.56);

    if (demoPaused) pausedAt = t;
    demoRaf = requestAnimationFrame(draw);
  };

  demoRaf = requestAnimationFrame(draw);
}

/* ------------------------------------------------------------ 播放控制 */

async function safePlay() {
  const video = videoRef.value;
  if (!video) return;
  try {
    await video.play();
  } catch {
    // 浏览器自动播放策略：先静音再播
    video.muted = true;
    muted.value = true;
    try {
      await video.play();
      showUnmuteHint.value = true;
    } catch {
      status.value = 'paused';
    }
  }
}

function togglePlay() {
  if (status.value === 'locked' || status.value === 'error') return;
  if (engine.value === 'demo') {
    demoPaused = !demoPaused;
    status.value = demoPaused ? 'paused' : 'demo';
    return;
  }
  const video = videoRef.value;
  if (!video) return;
  if (video.paused) void video.play();
  else video.pause();
}

function toggleMute() {
  muted.value = !muted.value;
  const video = videoRef.value;
  if (video) video.muted = muted.value;
  showUnmuteHint.value = false;
}

function unmute() {
  muted.value = false;
  const video = videoRef.value;
  if (video) {
    video.muted = false;
    video.volume = volume.value;
  }
  showUnmuteHint.value = false;
}

function onVolumeInput() {
  const video = videoRef.value;
  if (video) {
    video.volume = volume.value;
    video.muted = volume.value === 0;
  }
  muted.value = volume.value === 0;
}

function toggleDanmaku() {
  showDanmaku.value = !showDanmaku.value;
  emit('danmaku-toggle', showDanmaku.value);
}

async function onQuality(quality: string) {
  if (quality === currentQuality.value) return;

  // 优先在当前已下发的源里切；没有就重新拉一次 play-info（会带上新 token）
  const sameProtocol = activeInfo.value?.sources.find(
    (s) => s.quality === quality && s.protocol === currentProtocol.value,
  );
  const any = activeInfo.value?.sources.find((s) => s.quality === quality);
  if (sameProtocol || any) {
    const target = sameProtocol ?? any!;
    sourceIndex = candidates.value.findIndex((s) => s.protocol === target.protocol && s.quality === target.quality);
    if (sourceIndex < 0) sourceIndex = 0;
    retryAttempt.value = 0;
    teardown();
    tryLoad();
    return;
  }

  try {
    const info = await streamApi.playInfo(props.roomId, quality);
    activeInfo.value = info;
    start(info);
  } catch {
    /* 失败保留当前清晰度，错误提示已由 axios 拦截器弹出 */
  }
}

function toggleFullscreen() {
  const el = containerRef.value;
  if (!el) return;
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else {
    void el.requestFullscreen?.();
  }
}

function onFullscreenChange() {
  isFullscreen.value = document.fullscreenElement === containerRef.value;
}

function revealControls() {
  showControls.value = true;
  scheduleHide();
}

function scheduleHide() {
  if (hideTimer) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (status.value === 'playing' || status.value === 'demo') showControls.value = false;
  }, 3200);
}

function onKeydown(event: KeyboardEvent) {
  const key = event.key.toLowerCase();
  if (key === ' ' || key === 'k') {
    event.preventDefault();
    togglePlay();
  } else if (key === 'f') {
    toggleFullscreen();
  } else if (key === 'm') {
    toggleMute();
  }
}

/* ------------------------------------------------------------ 媒体事件 */

function onPlaying() {
  status.value = 'playing';
  retryAttempt.value = 0;
  showUnmuteHint.value = false;
}

function onPause() {
  if (status.value !== 'reconnecting' && status.value !== 'loading') status.value = 'paused';
}

function onWaiting() {
  if (status.value === 'playing') status.value = 'loading';
}

function onVideoError() {
  if (engine.value === 'hls-native') fail('原生 HLS 播放出错');
}

defineExpose({ restart, togglePlay });
</script>

<style scoped>
.player {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #05070d;
  border-radius: var(--radius-lg);
  overflow: hidden;
  outline: none;
  box-shadow: var(--shadow-card);
  border: 1px solid var(--border-soft);
}

.player.is-fullscreen {
  border-radius: 0;
  aspect-ratio: auto;
  height: 100vh;
}

.player__video,
.player__canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #05070d;
}

.player__top {
  position: absolute;
  inset: 0 0 auto 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  background: linear-gradient(180deg, rgba(3, 6, 12, 0.72), transparent);
  opacity: 0;
  transition: opacity 0.2s ease;
  pointer-events: none;
}

.player__top.is-visible {
  opacity: 1;
}

.player__top-left,
.player__top-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.4px;
}

.badge--live {
  color: #fff;
  background: var(--gradient-hot);
}

.badge--live .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #fff;
  animation: pulse 1.4s infinite;
}

.badge--demo {
  color: #ffe0a8;
  background: rgba(255, 181, 71, 0.22);
  border: 1px solid rgba(255, 181, 71, 0.4);
}

.badge--idle {
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.1);
}

.badge--ghost {
  color: rgba(238, 242, 255, 0.82);
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-family: var(--font-mono);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.stat {
  font-size: 11px;
  color: rgba(238, 242, 255, 0.7);
  font-family: var(--font-mono);
}

.player__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  padding: 24px;
  background: rgba(5, 8, 16, 0.78);
  backdrop-filter: blur(6px);
  z-index: 3;
}

.player__overlay--soft {
  background: rgba(5, 8, 16, 0.55);
}

.player__overlay p {
  font-size: 15px;
  color: var(--text-primary);
}

.player__overlay .tip {
  font-size: 12px;
  color: var(--text-muted);
  max-width: 80%;
}

.overlay-icon {
  font-size: 40px;
  color: var(--brand);
}

.player__overlay--lock .overlay-icon {
  color: #ffd08a;
}

.lock-title {
  font-size: 18px !important;
  font-weight: 650;
}

.lock-desc {
  color: var(--text-secondary) !important;
  font-size: 13px !important;
}

.lock-price {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 22px;
  color: #ffd08a;
  margin: 2px 0 6px;
}

.overlay-actions {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}

.spinner {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 3px solid rgba(91, 140, 255, 0.25);
  border-top-color: var(--brand);
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.player__demo-tip {
  position: absolute;
  left: 16px;
  bottom: 76px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  color: #ffe0a8;
  background: rgba(24, 18, 6, 0.72);
  border: 1px solid rgba(255, 181, 71, 0.3);
  max-width: 70%;
  z-index: 2;
}

.player__bigplay {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 72px;
  height: 72px;
  border-radius: 50%;
  border: none;
  background: rgba(91, 140, 255, 0.92);
  color: #fff;
  display: grid;
  place-items: center;
  cursor: pointer;
  z-index: 2;
  box-shadow: 0 10px 30px rgba(91, 140, 255, 0.4);
}

.player__controls {
  position: absolute;
  inset: auto 0 0 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px 12px;
  background: linear-gradient(0deg, rgba(3, 6, 12, 0.86), transparent);
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.2s ease, transform 0.2s ease;
  z-index: 4;
}

.player__controls.is-visible {
  opacity: 1;
  transform: none;
}

.ctl {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 34px;
  height: 34px;
  padding: 0 6px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(238, 242, 255, 0.88);
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease;
}

.ctl:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.ctl:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ctl--text {
  font-size: 12px;
  font-family: var(--font-mono);
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.13);
  height: 28px;
}

.ctl.is-on {
  color: var(--brand);
}

.ctl-spacer {
  flex: 1;
}

.ctl-volume {
  display: flex;
  align-items: center;
  gap: 4px;
}

.volume-range {
  width: 0;
  opacity: 0;
  transition: width 0.2s ease, opacity 0.2s ease;
  accent-color: var(--brand);
  cursor: pointer;
}

.ctl-volume:hover .volume-range {
  width: 78px;
  opacity: 1;
}

.ctl-time {
  font-size: 12px;
  color: rgba(238, 242, 255, 0.72);
  min-width: 66px;
}

.player__unmute {
  position: absolute;
  top: 56px;
  left: 16px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 8px;
  font-size: 12px;
  background: rgba(91, 140, 255, 0.92);
  color: #fff;
  cursor: pointer;
  z-index: 5;
}

@media (max-width: 720px) {
  .player {
    border-radius: var(--radius-md);
  }
  .ctl-volume .volume-range {
    display: none;
  }
  .player__top-right {
    display: none;
  }
}
</style>
