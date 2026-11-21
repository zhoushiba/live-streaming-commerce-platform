<template>
  <div class="page home">
    <!-- Hero -->
    <section class="hero">
      <div class="hero__copy">
        <span class="hero__eyebrow">LIVE COMMERCE · 求职作品集</span>
        <h1 class="hero__title">边看边聊，边聊边买</h1>
        <p class="hero__desc">
          HLS / HTTP-FLV 双协议直播播放、WebSocket 实时弹幕、礼物打赏与三方支付订单，
          全部由一条真实可跑通的后端链路驱动。
        </p>
        <div class="hero__actions">
          <el-button type="primary" size="large" round @click="scrollToRooms">
            开始逛直播间
          </el-button>
          <el-button size="large" round @click="router.push('/videos')">点播专区</el-button>
        </div>
        <div class="hero__stats">
          <div v-for="s in heroStats" :key="s.label" class="hero__stat">
            <span class="mono">{{ s.value }}</span>
            <em>{{ s.label }}</em>
          </div>
        </div>
      </div>
      <div class="hero__deck">
        <div class="deck__screen">
          <div class="deck__live"><i></i>LIVE</div>
          <div class="deck__bars">
            <span v-for="i in 28" :key="i" :style="{ animationDelay: `${i * 0.06}s`, height: `${20 + ((i * 37) % 60)}%` }"></span>
          </div>
          <div class="deck__caption">hls.js · flv.js · 弹幕 · 礼物</div>
        </div>
        <div class="deck__float deck__float--danmaku">这画质也太顶了 👏</div>
        <div class="deck__float deck__float--gift">🚀 送出 火箭 ×1</div>
      </div>
    </section>

    <!-- 主播开播入口 -->
    <el-alert
      v-if="auth.isAnchor && myRoomCount === 0"
      class="anchor-alert"
      type="info"
      :closable="false"
      show-icon
    >
      <template #title>
        你已经是主播啦，还没有直播间 ——
        <el-button link type="primary" @click="createMyRoom">一键创建直播间</el-button>
      </template>
    </el-alert>

    <!-- 筛选 -->
    <section ref="roomsRef" class="filters">
      <div class="filters__cats">
        <button class="cat" :class="{ 'is-active': !categoryId }" @click="pickCategory(null)">全部</button>
        <button
          v-for="cat in categories"
          :key="cat.id"
          class="cat"
          :class="{ 'is-active': categoryId === cat.id }"
          @click="pickCategory(cat.id)"
        >
          {{ cat.name }}
        </button>
      </div>
      <div class="filters__right">
        <el-input v-model="keyword" placeholder="搜索直播间" clearable class="filters__search" @keyup.enter="reload" @clear="reload">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="sort" class="filters__sort" @change="reload">
          <el-option label="最热" value="hot" />
          <el-option label="最新" value="new" />
          <el-option label="价格从低到高" value="price_asc" />
          <el-option label="价格从高到低" value="price_desc" />
        </el-select>
      </div>
    </section>

    <!-- 房间列表 -->
    <section v-loading="loading" class="rooms">
      <div v-if="rooms.length" class="grid-rooms">
        <RouterLink v-for="room in rooms" :key="room.id" :to="`/room/${room.id}`" class="room-card">
          <div class="room-card__cover">
            <img v-if="room.coverUrl" :src="room.coverUrl" :alt="room.title" loading="lazy" />
            <div v-else class="room-card__placeholder" :style="{ background: gradientFor(room.id) }">
              <span>{{ room.title.slice(0, 2) }}</span>
            </div>
            <span v-if="room.status === 'living'" class="room-card__badge is-live"><i></i>直播中</span>
            <span v-else class="room-card__badge is-idle">{{ room.status === 'ended' ? '已结束' : '未开播' }}</span>
            <span class="room-card__viewers">
              <el-icon><View /></el-icon>{{ room.viewers }}
            </span>
          </div>
          <div class="room-card__body">
            <p class="room-card__title">{{ room.title }}</p>
            <div class="room-card__meta">
              <span class="room-card__anchor">
                <el-avatar :size="18">{{ room.anchor.displayName.slice(0, 1) }}</el-avatar>
                {{ room.anchor.displayName }}
              </span>
              <span class="room-card__price" :class="room.priceType === 'free' ? 'tag-free' : 'tag-paid'">
                {{ room.priceType === 'free' ? '免费' : `¥${room.price}/${room.priceType === 'monthly' ? '月' : '年'}` }}
              </span>
            </div>
          </div>
        </RouterLink>
      </div>
      <div v-else-if="!loading" class="empty-state">还没有匹配的直播间，换个关键词试试</div>

      <el-pagination
        v-if="total > pageSize"
        v-model:current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="prev, pager, next"
        @current-change="load"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Search, View } from '@element-plus/icons-vue';
import { roomApi } from '@/api';
import type { RoomCard, RoomCategory } from '@/api/types';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();

const rooms = ref<RoomCard[]>([]);
const categories = ref<RoomCategory[]>([]);
const loading = ref(false);
const page = ref(1);
const pageSize = ref(12);
const total = ref(0);
const categoryId = ref<number | null>(null);
const keyword = ref('');
const sort = ref<'hot' | 'new' | 'price_asc' | 'price_desc'>('hot');
const roomsRef = ref<HTMLElement | null>(null);
const myRoomCount = ref(0);

const heroStats = computed(() => [
  { label: '直播间', value: total.value || rooms.value.length },
  { label: '在线观看', value: rooms.value.reduce((sum, r) => sum + r.viewers, 0) },
  { label: '付费房间', value: rooms.value.filter((r) => r.priceType !== 'free').length },
]);

const gradients = [
  'linear-gradient(135deg, #5b8cff, #b06bff)',
  'linear-gradient(135deg, #21d4b4, #5b8cff)',
  'linear-gradient(135deg, #ffb547, #ff7a59)',
  'linear-gradient(135deg, #ff6b9d, #b06bff)',
  'linear-gradient(135deg, #7bf3d2, #21a4d4)',
];

function gradientFor(id: number): string {
  return gradients[id % gradients.length];
}

onMounted(async () => {
  await Promise.all([loadCategories(), load()]);
  if (auth.isLogin) await auth.fetchProfile();
  if (auth.isAnchor) {
    try {
      const mine = await roomApi.mine();
      myRoomCount.value = mine.total;
    } catch {
      /* 非主播会 403，忽略 */
    }
  }
});

async function loadCategories() {
  try {
    categories.value = await roomApi.categories();
  } catch {
    /* noop */
  }
}

async function load() {
  loading.value = true;
  try {
    const result = await roomApi.list({
      page: page.value,
      pageSize: pageSize.value,
      categoryId: categoryId.value ?? undefined,
      keyword: keyword.value || undefined,
      sort: sort.value,
    });
    rooms.value = result.list;
    total.value = result.total;
  } finally {
    loading.value = false;
  }
}

function reload() {
  page.value = 1;
  void load();
}

function pickCategory(id: number | null) {
  categoryId.value = id;
  reload();
}

function scrollToRooms() {
  roomsRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function createMyRoom() {
  try {
    const { value } = await ElMessageBox.prompt('给你的直播间起个名字', '创建直播间', {
      inputValue: `${auth.user?.nickname} 的直播间`,
      inputValidator: (v: string) => (v && v.trim().length >= 2 ? true : '至少 2 个字'),
    });
    const room = await roomApi.create({ title: value.trim(), priceType: 'free', price: 0 });
    ElMessage.success('直播间创建成功');
    router.push(`/room/${room.id}`);
  } catch {
    /* 取消 */
  }
}
</script>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: 26px;
}

/* ------------------------------------------------------------ Hero */
.hero {
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  gap: 36px;
  align-items: center;
  padding: 18px 0 6px;
}

.hero__eyebrow {
  font-size: 11px;
  letter-spacing: 2.4px;
  color: var(--brand);
  font-weight: 600;
}

.hero__title {
  font-size: 40px;
  line-height: 1.25;
  margin: 12px 0 14px;
  background: linear-gradient(120deg, #fff 20%, #b7c8ff 60%, #d7b3ff 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.hero__desc {
  color: var(--text-secondary);
  max-width: 520px;
  line-height: 1.75;
}

.hero__actions {
  display: flex;
  gap: 12px;
  margin: 22px 0 18px;
}

.hero__stats {
  display: flex;
  gap: 28px;
}

.hero__stat {
  display: flex;
  flex-direction: column;
}

.hero__stat .mono {
  font-size: 20px;
  font-weight: 700;
  color: #fff;
}

.hero__stat em {
  font-style: normal;
  font-size: 12px;
  color: var(--text-muted);
}

.hero__deck {
  position: relative;
  height: 260px;
}

.deck__screen {
  position: absolute;
  inset: 0;
  border-radius: 22px;
  background: linear-gradient(150deg, rgba(91, 140, 255, 0.22), rgba(176, 107, 255, 0.16)), #0d1220;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 30px 60px rgba(4, 8, 20, 0.6);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 18px;
}

.deck__live {
  position: absolute;
  top: 16px;
  left: 16px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #fff;
  background: var(--gradient-hot);
}

.deck__live i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #fff;
  animation: blink 1.4s infinite;
}

@keyframes blink {
  50% { opacity: 0.3; }
}

.deck__bars {
  position: absolute;
  inset: 40px 18px 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.deck__bars span {
  flex: 1;
  border-radius: 3px;
  background: linear-gradient(180deg, rgba(91, 140, 255, 0.9), rgba(176, 107, 255, 0.5));
  animation: wave 1.6s ease-in-out infinite alternate;
}

@keyframes wave {
  from { transform: scaleY(0.45); opacity: 0.6; }
  to { transform: scaleY(1); opacity: 1; }
}

.deck__caption {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.deck__float {
  position: absolute;
  padding: 9px 14px;
  border-radius: 12px;
  font-size: 12px;
  background: rgba(18, 24, 41, 0.92);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-card);
  animation: float 4s ease-in-out infinite;
}

.deck__float--danmaku {
  top: -12px;
  right: 8px;
  color: #bfe6ff;
}

.deck__float--gift {
  bottom: -14px;
  left: -6px;
  color: #ffd08a;
  animation-delay: 1.4s;
}

@keyframes float {
  50% { transform: translateY(-8px); }
}

/* ------------------------------------------------------------ 筛选 */
.anchor-alert {
  background: rgba(91, 140, 255, 0.08) !important;
  border: 1px solid rgba(91, 140, 255, 0.24) !important;
}

.filters {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 14px 16px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-soft);
}

.filters__cats {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.cat {
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.16s ease;
}

.cat:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.05);
}

.cat.is-active {
  color: #fff;
  background: rgba(91, 140, 255, 0.18);
  border-color: rgba(91, 140, 255, 0.45);
}

.filters__right {
  display: flex;
  gap: 10px;
}

.filters__search {
  width: 200px;
}

.filters__sort {
  width: 140px;
}

/* ------------------------------------------------------------ 房间卡片 */
.rooms {
  min-height: 200px;
}

.room-card {
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-card);
  border: 1px solid var(--border-soft);
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.room-card:hover {
  transform: translateY(-4px);
  border-color: rgba(91, 140, 255, 0.45);
  box-shadow: 0 20px 40px rgba(4, 8, 20, 0.55);
}

.room-card__cover {
  position: relative;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  background: #0d1220;
}

.room-card__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.35s ease;
}

.room-card:hover .room-card__cover img {
  transform: scale(1.04);
}

.room-card__placeholder {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
}

.room-card__placeholder span {
  font-size: 34px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
  letter-spacing: 2px;
  text-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
}

.room-card__badge {
  position: absolute;
  top: 10px;
  left: 10px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
}

.room-card__badge.is-live {
  background: var(--gradient-hot);
}

.room-card__badge.is-live i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #fff;
  animation: blink 1.4s infinite;
}

.room-card__badge.is-idle {
  background: rgba(6, 10, 20, 0.72);
  color: var(--text-secondary);
}

.room-card__viewers {
  position: absolute;
  right: 10px;
  bottom: 10px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  color: #e8eeff;
  background: rgba(6, 10, 20, 0.66);
  font-family: var(--font-mono);
}

.room-card__body {
  padding: 12px 14px 14px;
}

.room-card__title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 40px;
}

.room-card__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
}

.room-card__anchor {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.room-card__price {
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-family: var(--font-mono);
}

@media (max-width: 900px) {
  .hero {
    grid-template-columns: 1fr;
  }
  .hero__deck {
    display: none;
  }
  .hero__title {
    font-size: 30px;
  }
}
</style>
