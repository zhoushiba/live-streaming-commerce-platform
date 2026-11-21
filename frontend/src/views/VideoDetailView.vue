<template>
  <div v-loading="loading" class="page video-page">
    <template v-if="video">
      <div class="video-layout">
        <!-- 左：播放器 + 分集 -->
        <div class="video-main">
          <div class="player-shell" :style="coverStyle">
            <video ref="videoRef" class="player-video" controls playsinline @error="onPlayerError" />
            <div v-if="!playing" class="player-mask">
              <template v-if="activeEpisode">
                <p class="player-mask__title">{{ activeEpisode.title }}</p>
                <p class="text-muted">
                  {{ activeEpisode.locked ? '该集需要解锁后播放' : '点击下方分集开始播放' }}
                </p>
                <el-button v-if="activeEpisode.locked" type="primary" round @click="openPay(activeEpisode)">
                  解锁本集 ¥{{ activeEpisode.price }}
                </el-button>
              </template>
              <template v-else>
                <p class="player-mask__title">{{ video.title }}</p>
                <p class="text-muted">选择右下方任意一集开始观看</p>
              </template>
            </div>
            <div v-if="playerError" class="player-error">
              <el-icon><WarningFilled /></el-icon>
              <span>{{ playerError }}</span>
            </div>
          </div>

          <section class="video-meta card card-pad">
            <div class="video-meta__head">
              <h1>{{ video.title }}</h1>
              <span class="tag" :class="video.free ? 'tag-free' : 'tag-paid'">
                {{ video.free ? '免费内容' : `整套 ¥${video.price}` }}
              </span>
              <span v-if="video.ownedAll" class="tag tag-live">已解锁</span>
            </div>
            <p class="text-secondary">{{ video.description || '暂无简介' }}</p>
            <div class="video-meta__stats">
              <span class="mono">{{ video.playCount }} 次播放</span>
              <span class="mono">{{ video.episodes.length }} 集</span>
              <span class="mono">协议 HLS / FLV 自适应</span>
            </div>
          </section>

          <section class="episodes card card-pad">
            <header class="episodes__head">
              <h2>分集列表</h2>
              <span class="text-muted">未解锁的分集会标记 🔒，付费后永久观看</span>
            </header>
            <ul class="episode-list">
              <li
                v-for="episode in video.episodes"
                :key="episode.id"
                class="episode"
                :class="{ 'is-active': activeEpisode?.id === episode.id }"
                @click="selectEpisode(episode)"
              >
                <span class="episode__no mono">EP{{ episode.episodeNo }}</span>
                <div class="episode__title">
                  <p>{{ episode.title }}</p>
                  <span class="text-muted mono">{{ formatDuration(episode.duration) }}</span>
                </div>
                <span v-if="episode.free" class="tag tag-free">免费</span>
                <span v-else-if="episode.locked" class="tag tag-paid">🔒 ¥{{ episode.price }}</span>
                <span v-else class="tag tag-live">可播放</span>
              </li>
            </ul>
          </section>
        </div>

        <!-- 右：购买卡片 -->
        <aside class="video-side">
          <div class="buy-card card card-pad">
            <p class="text-muted">整套解锁价</p>
            <p class="buy-card__price price">¥{{ video.price }}</p>
            <el-button v-if="!video.ownedAll && !video.free" type="primary" round class="buy-card__btn" @click="openPay(firstPaidEpisode)">
              {{ auth.isLogin ? '立即解锁全部剧集' : '登录后解锁' }}
            </el-button>
            <el-button v-else-if="video.free" round class="buy-card__btn" disabled>免费公开课</el-button>
            <el-button v-else round class="buy-card__btn" disabled>已解锁，可直接观看</el-button>
            <ul class="buy-card__tips">
              <li>· 支付走「下单 → 发起支付 → 回调验签 → 事务发放权益」闭环</li>
              <li>· Mock / 微信 / 支付宝三渠道，沙箱下可一键完成</li>
              <li>· 订单 15 分钟未支付自动关闭，权益与订单一一对应</li>
            </ul>
          </div>
        </aside>
      </div>
    </template>

    <div v-else-if="!loading" class="empty-state">
      视频不存在或已下架
      <div style="margin-top: 12px">
        <el-button round @click="router.push('/videos')">返回点播专区</el-button>
      </div>
    </div>

    <PayDialog
      v-model="payVisible"
      biz-type="video"
      :target-id="payTargetId"
      :title="payTitle"
      :amount="payAmount"
      @success="onPaySuccess"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { WarningFilled } from '@element-plus/icons-vue';
import Hls from 'hls.js';
import flvjs from 'flv.js';
import PayDialog from '@/components/PayDialog.vue';
import { videoApi } from '@/api';
import type { EpisodePlayResult, OrderView, VideoDetail, VideoEpisode } from '@/api/types';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const video = ref<VideoDetail | null>(null);
const loading = ref(true);
const activeEpisode = ref<VideoEpisode | null>(null);
const playing = ref(false);
const playerError = ref('');
const videoRef = ref<HTMLVideoElement | null>(null);

const payVisible = ref(false);
const payTargetId = ref<number | undefined>(undefined);
const payTitle = ref('');
const payAmount = ref(0);

let hls: Hls | null = null;
let flv: ReturnType<typeof flvjs.createPlayer> | null = null;

const gradients = [
  'linear-gradient(135deg, #5b8cff, #b06bff)',
  'linear-gradient(135deg, #21d4b4, #5b8cff)',
  'linear-gradient(135deg, #ff6b9d, #b06bff)',
];
const coverStyle = computed<Record<string, string>>(() => {
  const v = video.value;
  if (v?.coverUrl) return { backgroundImage: `url(${v.coverUrl})` };
  return { backgroundImage: gradients[(v?.id ?? 0) % gradients.length] };
});

const firstPaidEpisode = computed(() => video.value?.episodes.find((ep) => !ep.free && ep.locked) ?? null);

function formatDuration(seconds: number): string {
  if (!seconds) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function load() {
  loading.value = true;
  try {
    video.value = await videoApi.detail(Number(route.params.id));
    // 不自动拉流：首屏保持封面，用户点击分集时才真正发起播放请求
    activeEpisode.value = video.value?.episodes.find((ep) => ep.free) ?? null;
    playing.value = false;
    destroyPlayer();
  } catch {
    video.value = null;
  } finally {
    loading.value = false;
  }
}

function openPay(episode: VideoEpisode | null) {
  if (!auth.isLogin) {
    ElMessage.warning('请先登录');
    router.push({ name: 'login', query: { redirect: route.fullPath } });
    return;
  }
  if (!episode) {
    ElMessage.info('该视频没有需要购买的分集');
    return;
  }
  payTargetId.value = episode.id;
  payTitle.value = `${video.value?.title ?? ''} · EP${episode.episodeNo}`;
  payAmount.value = episode.price;
  payVisible.value = true;
}

async function onPaySuccess(_order: OrderView) {
  ElMessage.success('解锁成功，权益已到账');
  await Promise.all([load(), auth.fetchProfile()]);
}

async function selectEpisode(episode: VideoEpisode) {
  activeEpisode.value = episode;
  playerError.value = '';
  if (episode.locked) {
    playing.value = false;
    destroyPlayer();
    return;
  }
  try {
    const result = await videoApi.play(Number(route.params.id), episode.id);
    if (result.locked) {
      playing.value = false;
      openPay(episode);
      return;
    }
    playResult(result);
  } catch {
    playerError.value = '播放地址获取失败，请稍后重试';
  }
}

function playResult(result: EpisodePlayResult) {
  if (!result.playUrl || !videoRef.value) {
    playerError.value = '演示环境未挂载真实点播源（生产由 OSS/CDN 提供 m3u8/flv）';
    return;
  }
  playing.value = true;
  destroyPlayer();
  const element = videoRef.value;

  if (result.protocol === 'hls' && Hls.isSupported()) {
    hls = new Hls({ lowLatencyMode: true, enableWorker: true });
    hls.loadSource(result.playUrl);
    hls.attachMedia(element);
    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (data.fatal) playerError.value = 'HLS 拉流失败：演示环境没有真实的 m3u8 切片（真实环境接 CDN 后即可播放）';
    });
  } else if (result.protocol === 'flv' && flvjs.isSupported()) {
    flv = flvjs.createPlayer({ type: 'flv', url: result.playUrl, isLive: false });
    flv.attachMediaElement(element);
    flv.load();
    flv.on(flvjs.Events.ERROR, () => {
      playerError.value = 'FLV 拉流失败：演示环境没有真实的 flv 文件（真实环境接 CDN 后即可播放）';
    });
  } else {
    element.src = result.playUrl;
  }
  void element.play().catch(() => {
    playerError.value = '浏览器阻止了自动播放，请点击播放器上的播放按钮';
  });
}

function onPlayerError() {
  if (playing.value) {
    playerError.value = '视频源加载失败：演示环境没有挂载真实媒体文件，播放器逻辑与错误回退仍会完整执行';
  }
}

function destroyPlayer() {
  if (hls) {
    hls.destroy();
    hls = null;
  }
  if (flv) {
    flv.destroy();
    flv = null;
  }
}

onMounted(load);
onBeforeUnmount(destroyPlayer);
</script>

<style scoped>
.video-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 20px;
  align-items: start;
}

.video-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.player-shell {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: var(--radius-md);
  overflow: hidden;
  background-color: #05070d;
  background-size: cover;
  background-position: center;
  border: 1px solid var(--border-soft);
}

.player-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #05070d;
}

.player-mask {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  background: rgba(5, 7, 13, 0.62);
  backdrop-filter: blur(2px);
}

.player-mask__title {
  font-size: 18px;
  font-weight: 600;
}

.player-error {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  color: #ffd7b0;
  background: rgba(80, 30, 10, 0.72);
  border: 1px solid rgba(255, 181, 71, 0.3);
}

.video-meta__head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.video-meta__head h1 {
  font-size: 20px;
}

.video-meta__head + p {
  font-size: 13px;
  line-height: 1.7;
}

.video-meta__stats {
  display: flex;
  gap: 18px;
  margin-top: 12px;
  font-size: 11px;
  color: var(--text-muted);
}

.episodes__head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.episodes__head h2 {
  font-size: 16px;
}

.episode-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  list-style: none;
  padding: 0;
  margin: 0;
}

.episode {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-soft);
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: all 0.16s ease;
}

.episode:hover,
.episode.is-active {
  border-color: rgba(91, 140, 255, 0.45);
  background: rgba(91, 140, 255, 0.08);
}

.episode__no {
  font-size: 11px;
  color: var(--brand);
}

.episode__title {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.episode__title p {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.episode__title span {
  font-size: 11px;
  flex-shrink: 0;
}

.video-side {
  position: sticky;
  top: calc(var(--header-h) + 16px);
}

.buy-card__price {
  font-size: 30px;
  margin: 6px 0 16px;
}

.buy-card__btn {
  width: 100%;
}

.buy-card__tips {
  margin: 16px 0 0;
  padding: 14px 0 0;
  list-style: none;
  border-top: 1px dashed var(--border-soft);
  font-size: 12px;
  line-height: 1.9;
  color: var(--text-muted);
}

@media (max-width: 1000px) {
  .video-layout {
    grid-template-columns: 1fr;
  }
  .video-side {
    position: static;
  }
}
</style>
