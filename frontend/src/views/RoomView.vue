<template>
  <div v-loading="loading" class="page room-page">
    <template v-if="room">
      <div class="room-layout">
        <!-- 左：播放器 + 信息 -->
        <div class="room-main">
          <LivePlayer
            ref="playerRef"
            :room-id="room.id"
            :play-info="playInfo"
            :poster="room.coverUrl"
            :title="room.title"
            @unlock="openPay"
            @danmaku-toggle="danmakuVisible = $event"
          />

          <!-- 礼物飘屏 -->
          <TransitionGroup name="gift-float" tag="div" class="gift-float-layer">
            <div v-for="g in giftBanners" :key="g.key" class="gift-float">
              <span class="gift-float__icon">{{ g.icon }}</span>
              <div>
                <p><b>{{ g.nickname }}</b> 送出 {{ g.giftName }} ×{{ g.count }}</p>
                <span class="mono">¥{{ g.amount }}</span>
              </div>
            </div>
          </TransitionGroup>

          <!-- 房间信息 -->
          <section class="room-info">
            <div class="room-info__left">
              <div class="room-info__title-row">
                <h1 class="room-info__title">{{ room.title }}</h1>
                <span class="tag" :class="room.status === 'living' ? 'tag-live' : 'tag-muted'">
                  {{ statusLabel }}
                </span>
                <span class="tag" :class="room.priceType === 'free' ? 'tag-free' : 'tag-paid'">
                  {{ room.priceType === 'free' ? '免费观看' : `¥${room.price}/${room.priceType === 'monthly' ? '月' : '年'}` }}
                </span>
              </div>
              <div class="room-info__meta">
                <span class="room-info__anchor">
                  <el-avatar :size="24">{{ room.anchor.displayName.slice(0, 1) }}</el-avatar>
                  <div>
                    <p>{{ room.anchor.displayName }}</p>
                    <span class="text-muted">{{ room.category?.name ?? '未分类' }}</span>
                  </div>
                </span>
                <span class="room-info__stat"><el-icon><View /></el-icon>{{ room.viewers }} 观看</span>
                <span class="room-info__stat"><el-icon><Star /></el-icon>{{ room.likes }} 点赞</span>
                <span v-if="playInfo" class="room-info__stat mono">{{ protocolText }}</span>
              </div>
            </div>

            <div class="room-info__actions">
              <el-button round @click="like">
                <el-icon><Star /></el-icon>点赞
              </el-button>
              <el-button v-if="!room.access.canWatch" type="primary" round @click="openPay">
                <el-icon><Lock /></el-icon>解锁直播
              </el-button>
              <el-button v-else-if="room.priceType !== 'free' && !room.access.isOwner" round disabled>
                已订阅
              </el-button>
              <el-tooltip v-if="room.access.isOwner" content="推流地址与 OBS 参数" placement="top">
                <el-button round @click="openPushInfo"><el-icon><VideoCamera /></el-icon>推流信息</el-button>
              </el-tooltip>
            </div>
          </section>

          <!-- 主播控制台 -->
          <section v-if="room.access.isOwner" class="anchor-panel">
            <div class="anchor-panel__head">
              <span><el-icon><Setting /></el-icon> 主播控制台</span>
              <span class="text-muted">推流后点击「开始直播」，播放器会自动切到真实流</span>
            </div>
            <div class="anchor-panel__row">
              <el-button
                v-if="room.status !== 'living'"
                type="primary"
                round
                :loading="liveLoading"
                @click="startLive"
              >
                开始直播
              </el-button>
              <el-button v-else type="danger" plain round :loading="liveLoading" @click="endLive">结束直播</el-button>
              <el-button round @click="refreshPlay">刷新播放信息</el-button>
              <span class="anchor-panel__hint mono">{{ streamKeyHint }}</span>
            </div>
          </section>

          <p class="room-info__notice">
            <el-icon><InfoFilled /></el-icon>
            {{ playInfo?.notice || '正在获取播放信息…' }}
          </p>
        </div>

        <!-- 右：弹幕 + 礼物 -->
        <aside class="room-side">
          <div class="room-side__danmaku">
            <DanmakuPanel :room-id="room.id" :visible="danmakuVisible" @gift="onGift" />
          </div>
          <GiftBar :room-id="room.id" @need-recharge="openRecharge" @sent="onGiftSent" />
        </aside>
      </div>
    </template>

    <div v-else-if="!loading" class="empty-state">
      直播间不存在或已下线
      <div style="margin-top: 12px">
        <el-button round @click="router.push('/')">返回首页</el-button>
      </div>
    </div>

    <!-- 支付弹窗 -->
    <PayDialog
      v-model="payVisible"
      :biz-type="payBizType"
      :target-id="payTargetId"
      :title="payTitle"
      :amount="payAmount"
      @success="onPaySuccess"
    />

    <!-- 推流信息 -->
    <el-drawer v-model="pushVisible" title="推流信息（OBS / ffmpeg）" size="440px">
      <div v-loading="pushLoading" class="push">
        <template v-if="pushInfo">
          <div class="push__item">
            <label>推流地址（Server）</label>
            <div class="push__value mono">{{ pushInfo.rtmpUrl }}</div>
          </div>
          <div class="push__item">
            <label>串流密钥（Stream Key）</label>
            <div class="push__value mono">{{ pushInfo.streamKey }}</div>
          </div>
          <div class="push__item">
            <label>ffmpeg 推流命令</label>
            <pre class="push__code">{{ pushInfo.ffmpegCommand }}</pre>
            <el-button size="small" round @click="copy(pushInfo.ffmpegCommand)">复制命令</el-button>
          </div>
          <div class="push__item">
            <label>播放地址</label>
            <div v-for="s in pushInfo.playUrls" :key="s" class="push__value mono">{{ s }}</div>
          </div>
        </template>
      </div>
    </el-drawer>

    <!-- 充值弹窗 -->
    <PayDialog v-model="rechargeVisible" biz-type="recharge" title="钱包充值" @success="onRechargeSuccess" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { InfoFilled, Lock, Setting, Star, VideoCamera, View } from '@element-plus/icons-vue';
import LivePlayer from '@/components/LivePlayer.vue';
import DanmakuPanel from '@/components/DanmakuPanel.vue';
import GiftBar from '@/components/GiftBar.vue';
import PayDialog from '@/components/PayDialog.vue';
import { roomApi, streamApi } from '@/api';
import type { OrderView, PlayInfo, RoomDetail } from '@/api/types';
import { useAuthStore } from '@/stores/auth';

interface PushInfo {
  rtmpUrl: string;
  streamKey: string;
  ffmpegCommand: string;
  playUrls: string[];
}

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const room = ref<RoomDetail | null>(null);
const playInfo = ref<PlayInfo | null>(null);
const loading = ref(true);
const liveLoading = ref(false);
const danmakuVisible = ref(true);
const playerRef = ref<InstanceType<typeof LivePlayer> | null>(null);

const payVisible = ref(false);
const rechargeVisible = ref(false);
const pushVisible = ref(false);
const pushLoading = ref(false);
const pushInfo = ref<PushInfo | null>(null);

const giftBanners = ref<Array<{ key: string; nickname: string; giftName: string; count: number; amount: string; icon: string }>>([]);
let refreshTimer: number | null = null;

const roomId = computed(() => Number(route.params.id));

const statusLabel = computed(() => {
  if (playInfo.value?.mode === 'demo') return '演示流';
  return room.value?.status === 'living' ? '直播中' : room.value?.status === 'ended' ? '已结束' : '未开播';
});

const protocolText = computed(() => {
  if (!playInfo.value) return '';
  if (playInfo.value.mode === 'demo') return 'DEMO MODE';
  return `${playInfo.value.sources.length} 路源 · ${playInfo.value.fallbackOrder.join(' → ').toUpperCase()}`;
});

const streamKeyHint = computed(() => (room.value?.streamKey ? `streamKey: ${room.value.streamKey}` : ''));

const payBizType = computed(() => 'room' as const);
const payTargetId = computed(() => room.value?.id);
const payTitle = computed(() => room.value?.title ?? '');
const payAmount = computed(() => room.value?.price ?? 0);

onMounted(async () => {
  await loadAll();
  startAutoRefresh();
});

onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer);
});

watch(roomId, async () => {
  if (!Number.isFinite(roomId.value)) return;
  await loadAll();
});

async function loadAll() {
  if (!Number.isFinite(roomId.value)) {
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const [detail, play] = await Promise.all([
      roomApi.detail(roomId.value),
      streamApi.playInfo(roomId.value).catch(() => null),
    ]);
    room.value = detail;
    playInfo.value = play;
    if (auth.isLogin) {
      try {
        await roomApi.enter(roomId.value);
      } catch {
        /* 游客或重复进入，忽略 */
      }
    }
  } catch {
    room.value = null;
  } finally {
    loading.value = false;
  }
}

/** 播放令牌有 TTL，这里每 60 秒静默刷新一次，避免长时间观看后断流 */
function startAutoRefresh() {
  if (refreshTimer) window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(async () => {
    if (room.value?.status === 'living' && document.visibilityState === 'visible') {
      await refreshPlay(true);
    }
  }, 60_000);
}

async function refreshPlay(silent = false) {
  try {
    playInfo.value = await streamApi.playInfo(roomId.value);
    if (!silent) ElMessage.success('播放信息已刷新');
  } catch {
    /* noop */
  }
}

async function like() {
  try {
    const res = await roomApi.like(roomId.value);
    if (room.value) room.value.likes = res.likes;
  } catch {
    /* noop */
  }
}

function openPay() {
  if (!auth.isLogin) {
    ElMessage.warning('请先登录');
    router.push({ name: 'login', query: { redirect: route.fullPath } });
    return;
  }
  payVisible.value = true;
}

function openRecharge() {
  if (!auth.isLogin) {
    router.push({ name: 'login', query: { redirect: route.fullPath } });
    return;
  }
  rechargeVisible.value = true;
}

async function onPaySuccess(_order: OrderView) {
  await Promise.all([loadAll(), auth.fetchProfile()]);
  ElMessage.success('解锁成功，正在为你切换画面');
}

async function onRechargeSuccess() {
  await auth.fetchProfile();
  ElMessage.success('充值成功');
}

async function startLive() {
  liveLoading.value = true;
  try {
    await roomApi.startLive(roomId.value);
    ElMessage.success('已开播');
    await loadAll();
  } finally {
    liveLoading.value = false;
  }
}

async function endLive() {
  liveLoading.value = true;
  try {
    await roomApi.endLive(roomId.value);
    ElMessage.success('直播已结束');
    await loadAll();
  } finally {
    liveLoading.value = false;
  }
}

async function openPushInfo() {
  pushVisible.value = true;
  pushLoading.value = true;
  try {
    const raw = await streamApi.pushInfo(roomId.value);
    pushInfo.value = {
      rtmpUrl: String(raw.rtmpUrl ?? raw.server ?? ''),
      streamKey: String(raw.streamKey ?? ''),
      ffmpegCommand: String(raw.ffmpegCommand ?? ''),
      playUrls: Array.isArray(raw.playUrls) ? (raw.playUrls as string[]) : [],
    };
  } catch {
    pushInfo.value = null;
  } finally {
    pushLoading.value = false;
  }
}

function onGift(payload: Record<string, unknown>) {
  const item = {
    key: `${Date.now()}-${Math.random()}`,
    nickname: String(payload.nickname ?? '观众'),
    giftName: String(payload.giftName ?? '礼物'),
    count: Number(payload.count ?? 1),
    amount: String(payload.amount ?? '0.00'),
    icon: String(payload.icon ?? '🎁'),
  };
  giftBanners.value.push(item);
  window.setTimeout(() => {
    giftBanners.value = giftBanners.value.filter((g) => g.key !== item.key);
  }, 4200);
}

function onGiftSent(payload: Record<string, unknown>) {
  onGift({
    nickname: auth.user?.nickname ?? '我',
    giftName: payload.giftName,
    count: payload.count,
    amount: payload.amount,
    icon: '🎁',
  });
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('已复制');
  } catch {
    ElMessage.warning('复制失败，请手动选择');
  }
}
</script>

<style scoped>
.room-page {
  padding-top: 20px;
}

.room-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 20px;
  align-items: start;
}

.room-main {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.room-side {
  position: sticky;
  top: calc(var(--header-h) + 16px);
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: calc(100vh - var(--header-h) - 40px);
}

.room-side__danmaku {
  flex: 1;
  min-height: 240px;
}

/* ---------------------------------------------------------- 礼物飘屏 */
.gift-float-layer {
  position: absolute;
  left: 16px;
  top: 74px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  z-index: 6;
  max-width: 70%;
}

.gift-float {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-radius: 12px;
  background: linear-gradient(120deg, rgba(255, 107, 157, 0.22), rgba(176, 107, 255, 0.2));
  border: 1px solid rgba(255, 181, 71, 0.35);
  backdrop-filter: blur(8px);
  font-size: 12px;
  color: #ffe9c9;
  animation: gift-in 0.28s ease;
}

.gift-float__icon {
  font-size: 20px;
}

.gift-float .mono {
  font-size: 11px;
  color: #ffd08a;
}

@keyframes gift-in {
  from { opacity: 0; transform: translateX(-16px); }
  to { opacity: 1; transform: none; }
}

.gift-float-leave-active {
  transition: all 0.4s ease;
}

.gift-float-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}

/* ---------------------------------------------------------- 房间信息 */
.room-info {
  display: flex;
  gap: 18px;
  justify-content: space-between;
  align-items: flex-start;
  padding: 18px;
  border-radius: var(--radius-md);
  background: var(--bg-card);
  border: 1px solid var(--border-soft);
}

.room-info__left {
  min-width: 0;
}

.room-info__title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.room-info__title {
  font-size: 20px;
}

.room-info__meta {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.room-info__anchor {
  display: flex;
  align-items: center;
  gap: 8px;
}

.room-info__anchor p {
  font-size: 13px;
  line-height: 1.3;
}

.room-info__anchor .text-muted {
  font-size: 11px;
}

.room-info__stat {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-muted);
}

.room-info__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.room-info__notice {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
  padding: 0 4px;
}

/* ---------------------------------------------------------- 主播台 */
.anchor-panel {
  padding: 16px 18px;
  border-radius: var(--radius-md);
  background: linear-gradient(120deg, rgba(91, 140, 255, 0.1), rgba(176, 107, 255, 0.06));
  border: 1px solid rgba(91, 140, 255, 0.24);
}

.anchor-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  margin-bottom: 12px;
  gap: 12px;
  flex-wrap: wrap;
}

.anchor-panel__head > span:first-child {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.anchor-panel__row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.anchor-panel__hint {
  font-size: 11px;
  color: var(--text-muted);
  word-break: break-all;
}

/* ---------------------------------------------------------- 推流抽屉 */
.push {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.push__item label {
  display: block;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.push__value {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border-soft);
  font-size: 12px;
  word-break: break-all;
  margin-bottom: 6px;
}

.push__code {
  margin: 0 0 8px;
  padding: 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--border-soft);
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  color: #b8f0d8;
}

@media (max-width: 1080px) {
  .room-layout {
    grid-template-columns: 1fr;
  }
  .room-side {
    position: static;
    height: auto;
  }
  .room-side__danmaku {
    height: 360px;
  }
}
</style>
