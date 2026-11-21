<template>
  <div class="danmaku">
    <div class="danmaku__head">
      <div class="danmaku__title">
        <el-icon><ChatDotRound /></el-icon>
        <span>弹幕</span>
        <span class="danmaku__online">
          <i class="pulse"></i>
          {{ online }} 人在线
        </span>
      </div>
      <span class="danmaku__conn" :class="`is-${connState}`">{{ connLabel }}</span>
    </div>

    <div ref="listRef" class="danmaku__list" @scroll="onScroll">
      <div v-if="!messages.length" class="danmaku__empty">
        {{ connState === 'connected' ? '还没有人说话，来第一条弹幕吧' : '连接弹幕服务器中…' }}
      </div>
      <div
        v-for="item in messages"
        :key="item.id"
        class="danmaku__item"
        :class="{ 'is-self': item.userId === auth.user?.id, 'is-system': item.userId === null }"
      >
        <span class="danmaku__nick" :style="{ color: nickColor(item.nickname) }">{{ item.nickname }}</span>
        <span class="danmaku__content" :style="{ color: item.color || '#eef2ff' }">{{ item.content }}</span>
        <span class="danmaku__time">{{ formatTime(item.sentAt) }}</span>
      </div>
    </div>

    <div v-if="visible" class="danmaku__input">
      <el-popover placement="top" :width="180" trigger="click">
        <template #reference>
          <button class="color-dot" :style="{ background: color }" aria-label="选择弹幕颜色"></button>
        </template>
        <div class="color-grid">
          <button
            v-for="c in palette"
            :key="c"
            class="color-cell"
            :style="{ background: c }"
            :class="{ 'is-active': c === color }"
            @click="color = c"
          ></button>
        </div>
      </el-popover>

      <input
        v-model="draft"
        class="danmaku__field"
        :placeholder="placeholder"
        maxlength="60"
        :disabled="!canSend"
        @keyup.enter="send"
      />
      <el-button
        type="primary"
        round
        size="small"
        class="danmaku__send"
        :loading="sending"
        :disabled="!canSend || !draft.trim()"
        @click="send"
      >
        发送
      </el-button>
    </div>
    <div v-else class="danmaku__hidden-tip">弹幕已隐藏</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, nextTick, ref, watch } from 'vue';
import { io, type Socket } from 'socket.io-client';
import { ElMessage } from 'element-plus';
import { ChatDotRound } from '@element-plus/icons-vue';
import { roomApi } from '@/api';
import { tokenStore } from '@/api/http';
import type { DanmakuItem } from '@/api/types';
import { useAuthStore } from '@/stores/auth';

/**
 * 弹幕面板：基于 Socket.IO（namespace `/ws`）
 *  - 进入房间 join，拿到历史弹幕 + 在线人数
 *  - 发送走 ack 回调，服务端会做敏感词过滤与 5 秒 5 条限流
 *  - 服务端广播 danmaku:new / presence / gift:new
 */
const props = defineProps<{ roomId: number; visible?: boolean }>();
const emit = defineEmits<{ (e: 'gift', payload: Record<string, unknown>): void }>();

const auth = useAuthStore();
const listRef = ref<HTMLDivElement | null>(null);
const messages = ref<DanmakuItem[]>([]);
const online = ref(0);
const draft = ref('');
const sending = ref(false);
const color = ref('#ffffff');
const connState = ref<'idle' | 'connecting' | 'connected' | 'error'>('idle');
const autoScroll = ref(true);

const palette = ['#ffffff', '#7bf3d2', '#ffd08a', '#ff9ec4', '#8fb8ff', '#c9a2ff'];
let socket: Socket | null = null;

const canSend = computed(() => auth.isLogin && connState.value === 'connected');
const placeholder = computed(() => (auth.isLogin ? '发条弹幕参与互动（5 秒 5 条）' : '登录后参与弹幕互动'));
const connLabel = computed(
  () => ({ idle: '未连接', connecting: '连接中', connected: '已连接', error: '连接失败' })[connState.value],
);

function nickColor(nickname: string): string {
  let hash = 0;
  for (let i = 0; i < nickname.length; i += 1) hash = (hash * 31 + nickname.charCodeAt(i)) % 360;
  return `hsl(${hash}, 78%, 74%)`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

onMounted(async () => {
  connState.value = 'connecting';

  // 先拉一次历史，即使 websocket 失败页面也有内容
  try {
    const history = await roomApi.history(props.roomId, 30);
    messages.value = history;
    scrollToBottom();
  } catch {
    /* 公开接口，失败不影响连接 */
  }

  socket = io('/ws', {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    auth: { token: tokenStore.access ? `Bearer ${tokenStore.access}` : '' },
    reconnection: true,
    reconnectionAttempts: 8,
    reconnectionDelay: 800,
  });

  socket.on('connect', () => {
    connState.value = 'connected';
    socket?.emit('join', { roomId: props.roomId }, (ack: { code: number; data?: { online: number; history: DanmakuItem[] } }) => {
      if (ack?.code === 0 && ack.data) {
        online.value = ack.data.online;
        if (ack.data.history?.length) {
          messages.value = ack.data.history;
          scrollToBottom();
        }
      }
    });
  });

  socket.on('disconnect', () => {
    connState.value = 'error';
  });

  socket.on('connect_error', () => {
    connState.value = 'error';
  });

  socket.on('danmaku:new', (payload: { danmaku: DanmakuItem }) => {
    if (payload?.danmaku) pushMessage(payload.danmaku);
  });

  socket.on('presence', (payload: { online?: number }) => {
    if (typeof payload?.online === 'number') online.value = payload.online;
  });

  socket.on('gift:new', (payload: Record<string, unknown>) => {
    emit('gift', payload);
  });

  socket.on('system', (payload: { type?: string; message?: string }) => {
    if (payload?.type === 'token_invalid') ElMessage.warning('登录态已失效，弹幕将以游客身份显示');
  });
});

onBeforeUnmount(() => {
  if (socket) {
    socket.emit('leave', { roomId: props.roomId });
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
});

watch(
  () => props.roomId,
  (roomId) => {
    messages.value = [];
    socket?.emit('join', { roomId });
  },
);

function pushMessage(item: DanmakuItem) {
  messages.value.push(item);
  if (messages.value.length > 200) messages.value.splice(0, messages.value.length - 200);
  if (autoScroll.value) scrollToBottom();
}

function scrollToBottom() {
  void nextTick(() => {
    const el = listRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

function onScroll() {
  const el = listRef.value;
  if (!el) return;
  autoScroll.value = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
}

function send() {
  const content = draft.value.trim();
  if (!content || !socket) return;
  sending.value = true;
  socket.emit(
    'danmaku:send',
    { roomId: props.roomId, content, color: color.value },
    (ack: { code: number; message?: string; data?: { danmaku: DanmakuItem; masked: boolean; remaining: number } }) => {
      sending.value = false;
      if (ack?.code === 0 && ack.data) {
        draft.value = '';
        autoScroll.value = true;
        if (ack.data.masked) ElMessage.info('内容包含敏感词，已自动打码');
      } else {
        ElMessage.warning(ack?.message || '发送失败');
      }
    },
  );
}
</script>

<style scoped>
.danmaku {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-card);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.danmaku__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-soft);
}

.danmaku__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
}

.danmaku__online {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 400;
  font-size: 12px;
  color: var(--text-muted);
}

.pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 0 rgba(47, 214, 166, 0.6);
  animation: ripple 1.8s infinite;
}

@keyframes ripple {
  70% { box-shadow: 0 0 0 6px rgba(47, 214, 166, 0); }
  100% { box-shadow: 0 0 0 0 rgba(47, 214, 166, 0); }
}

.danmaku__conn {
  font-size: 11px;
  color: var(--text-muted);
}

.danmaku__conn.is-connected {
  color: var(--success);
}

.danmaku__conn.is-error {
  color: var(--danger);
}

.danmaku__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.danmaku__empty {
  margin: auto;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

.danmaku__item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
  animation: slide-in 0.22s ease;
}

@keyframes slide-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}

.danmaku__item.is-self .danmaku__content {
  background: rgba(91, 140, 255, 0.16);
  border-radius: 6px;
  padding: 0 4px;
}

.danmaku__nick {
  flex-shrink: 0;
  font-size: 12px;
  opacity: 0.9;
}

.danmaku__nick::after {
  content: '：';
  color: var(--text-muted);
}

.danmaku__content {
  flex: 1;
}

.danmaku__time {
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.danmaku__input {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--border-soft);
}

.color-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.4);
  cursor: pointer;
  flex-shrink: 0;
}

.color-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 8px;
}

.color-cell {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
}

.color-cell.is-active {
  border-color: var(--brand);
}

.danmaku__field {
  flex: 1;
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--border-soft);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
}

.danmaku__field:focus {
  border-color: rgba(91, 140, 255, 0.6);
}

.danmaku__field:disabled {
  opacity: 0.6;
}

.danmaku__hidden-tip {
  padding: 10px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
  border-top: 1px solid var(--border-soft);
}
</style>
