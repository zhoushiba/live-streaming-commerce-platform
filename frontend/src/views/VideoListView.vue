<template>
  <div v-loading="loading" class="page">
    <header class="section-head">
      <div>
        <h1 class="section-title">点播专区</h1>
        <p class="section-sub">付费点播内容：按集解锁、永久观看，解锁记录与订单可追溯</p>
      </div>
      <el-input v-model="keyword" class="search" placeholder="搜索课程 / 专栏" clearable @keyup.enter="load(1)">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
    </header>

    <div v-if="list.length" class="grid-videos">
      <RouterLink v-for="video in list" :key="video.id" :to="`/videos/${video.id}`" class="video-card card">
        <div class="video-card__cover" :style="coverStyle(video)">
          <span class="video-card__badge" :class="video.free ? 'tag-free' : 'tag-paid'">
            {{ video.free ? '免费' : `¥${video.price}` }}
          </span>
          <span class="video-card__episodes mono">{{ video.episodeCount }} 集</span>
        </div>
        <div class="video-card__body">
          <h3>{{ video.title }}</h3>
          <p class="text-muted">{{ video.description || '暂无简介' }}</p>
          <footer>
            <span class="mono">{{ video.playCount }} 次播放</span>
            <span class="text-muted">{{ formatDate(video.createdAt) }}</span>
          </footer>
        </div>
      </RouterLink>
    </div>

    <div v-else-if="!loading" class="empty-state">还没有上架的点播内容</div>

    <el-pagination
      v-if="total > pageSize"
      class="pager"
      layout="prev, pager, next"
      :current-page="page"
      :page-size="pageSize"
      :total="total"
      @current-change="load"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Search } from '@element-plus/icons-vue';
import { videoApi } from '@/api';
import type { VideoListItem } from '@/api/types';

const loading = ref(true);
const list = ref<VideoListItem[]>([]);
const keyword = ref('');
const page = ref(1);
const pageSize = ref(9);
const total = ref(0);

const gradients = [
  'linear-gradient(135deg, #5b8cff, #b06bff)',
  'linear-gradient(135deg, #21d4b4, #5b8cff)',
  'linear-gradient(135deg, #ff6b9d, #b06bff)',
  'linear-gradient(135deg, #ffb547, #ff6b9d)',
  'linear-gradient(135deg, #6b8cff, #21d4b4)',
];

function coverStyle(video: VideoListItem): Record<string, string> {
  if (video.coverUrl) return { backgroundImage: `url(${video.coverUrl})` };
  return { backgroundImage: gradients[video.id % gradients.length] };
}

function formatDate(value: string): string {
  if (!value) return '';
  return new Date(value).toLocaleDateString('zh-CN');
}

async function load(nextPage = page.value) {
  loading.value = true;
  page.value = nextPage;
  try {
    const res = await videoApi.list({ page: page.value, pageSize: pageSize.value, keyword: keyword.value || undefined });
    list.value = res.list;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

onMounted(() => load(1));
</script>

<style scoped>
.search {
  width: 260px;
}

.video-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: transform 0.2s ease, border-color 0.2s ease;
}

.video-card:hover {
  transform: translateY(-3px);
  border-color: var(--border-strong);
}

.video-card__cover {
  position: relative;
  aspect-ratio: 16 / 9;
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding: 10px;
}

.video-card__badge {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  backdrop-filter: blur(6px);
}

.video-card__episodes {
  position: absolute;
  left: 10px;
  bottom: 8px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  color: #fff;
  background: rgba(0, 0, 0, 0.45);
}

.video-card__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px 16px;
}

.video-card__body h3 {
  font-size: 15px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.video-card__body p {
  font-size: 12px;
  line-height: 1.6;
  min-height: 38px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.video-card__body footer {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
}

.pager {
  justify-content: center;
  margin-top: 26px;
}
</style>
