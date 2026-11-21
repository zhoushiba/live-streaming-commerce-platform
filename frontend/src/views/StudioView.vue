<template>
  <div class="page">
    <header class="section-head">
      <div>
        <h1 class="section-title">主播后台</h1>
        <p class="section-sub">创建直播间、获取 RTMP 推流地址、开播 / 下播，并查看实时观看数据</p>
      </div>
      <el-button type="primary" round :disabled="!auth.isAnchor" @click="openCreate">新建直播间</el-button>
    </header>

    <el-alert
      v-if="!auth.isAnchor"
      type="warning"
      :closable="false"
      show-icon
      title="当前账号不是主播"
      description="注册时选择「主播」身份，或用演示账号 anchor / Anchor@123456 登录后再访问本页。"
      style="margin-bottom: 16px"
    />

    <div v-loading="loading" class="studio">
      <article v-for="room in rooms" :key="room.id" class="studio-card card">
        <div class="studio-card__cover" :style="coverStyle(room)">
          <span class="tag" :class="room.status === 'living' ? 'tag-live' : 'tag-muted'">{{ statusLabel(room.status) }}</span>
          <span class="tag" :class="room.priceType === 'free' ? 'tag-free' : 'tag-paid'">
            {{ room.priceType === 'free' ? '免费' : `¥${room.price} / ${room.priceType === 'monthly' ? '月' : '年'}` }}
          </span>
        </div>
        <div class="studio-card__body">
          <h3>{{ room.title }}</h3>
          <p class="text-muted">
            {{ room.category?.name ?? '未分类' }} · {{ room.viewers }} 观看 · {{ room.likes }} 点赞
          </p>
          <div class="studio-card__actions">
            <el-button
              v-if="room.status !== 'living'"
              type="primary"
              size="small"
              round
              :loading="busy === `start-${room.id}`"
              @click="startLive(room.id)"
            >
              开始直播
            </el-button>
            <el-button
              v-else
              type="danger"
              size="small"
              plain
              round
              :loading="busy === `end-${room.id}`"
              @click="endLive(room.id)"
            >
              结束直播
            </el-button>
            <el-button size="small" round @click="router.push(`/room/${room.id}`)">进入直播间</el-button>
            <el-button size="small" round @click="openPush(room.id)">推流信息</el-button>
          </div>
        </div>
      </article>

      <div v-if="!rooms.length && !loading" class="empty-state">
        还没有直播间，点击右上角「新建直播间」开始你的第一场直播
      </div>
    </div>

    <!-- 新建直播间 -->
    <el-dialog v-model="createVisible" title="新建直播间" width="480px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="86px">
        <el-form-item label="标题" prop="title">
          <el-input v-model="form.title" maxlength="60" show-word-limit placeholder="例如：深夜电台 · 治愈系钢琴" />
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="form.categoryId" placeholder="选择分类" style="width: 100%">
            <el-option v-for="cat in categories" :key="cat.id" :label="cat.name" :value="cat.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="计费方式">
          <el-radio-group v-model="form.priceType">
            <el-radio-button label="free">免费</el-radio-button>
            <el-radio-button label="monthly">按月订阅</el-radio-button>
            <el-radio-button label="yearly">按年订阅</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.priceType !== 'free'" label="价格" prop="price">
          <el-input-number v-model="form.price" :min="1" :max="999999" :precision="2" :step="1" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button round @click="createVisible = false">取消</el-button>
        <el-button type="primary" round :loading="creating" @click="submitCreate">创建并进入</el-button>
      </template>
    </el-dialog>

    <!-- 推流信息 -->
    <el-drawer v-model="pushVisible" title="推流信息（OBS / ffmpeg）" size="460px">
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
            <label>ffmpeg 命令</label>
            <pre class="push__code">{{ pushInfo.ffmpegCommand }}</pre>
          </div>
          <div class="push__item">
            <label>播放地址</label>
            <div v-for="url in pushInfo.playUrls" :key="url" class="push__value mono">{{ url }}</div>
          </div>
          <div class="push__item">
            <label>实时数据</label>
            <div class="push__stats">
              <span>在线 {{ Number(pushStats.viewers ?? 0) }}</span>
              <span>峰值 {{ Number(pushStats.peakViewers ?? 0) }}</span>
              <span>时长 {{ Number(pushStats.durationSec ?? 0) }}s</span>
            </div>
          </div>
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { roomApi, streamApi } from '@/api';
import type { RoomCard, RoomCategory } from '@/api/types';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();

const rooms = ref<RoomCard[]>([]);
const categories = ref<RoomCategory[]>([]);
const loading = ref(true);
const busy = ref('');

const createVisible = ref(false);
const creating = ref(false);
const formRef = ref<FormInstance>();
const form = reactive({ title: '', categoryId: undefined as number | undefined, priceType: 'free', price: 9.9 });

const rules: FormRules = {
  title: [
    { required: true, message: '请输入直播间标题', trigger: 'blur' },
    { min: 2, max: 60, message: '标题长度为 2-60 个字符', trigger: 'blur' },
  ],
  price: [{ required: true, message: '请输入价格', trigger: 'blur' }],
};

const pushVisible = ref(false);
const pushLoading = ref(false);
const pushInfo = ref<{ rtmpUrl: string; streamKey: string; ffmpegCommand: string; playUrls: string[] } | null>(null);
const pushStats = ref<Record<string, unknown>>({});

const gradients = [
  'linear-gradient(135deg, #5b8cff, #b06bff)',
  'linear-gradient(135deg, #21d4b4, #5b8cff)',
  'linear-gradient(135deg, #ff6b9d, #b06bff)',
];

const statusMap: Record<string, string> = { living: '直播中', idle: '未开播', ended: '已结束' };
const statusLabel = (status: string): string => statusMap[status] ?? status;

function coverStyle(room: RoomCard): Record<string, string> {
  if (room.coverUrl) return { backgroundImage: `url(${room.coverUrl})` };
  return { backgroundImage: gradients[room.id % gradients.length] };
}

async function load() {
  loading.value = true;
  try {
    const [mine, cats] = await Promise.all([roomApi.mine(), roomApi.categories().catch(() => [] as RoomCategory[])]);
    rooms.value = mine.list;
    categories.value = cats;
  } catch {
    rooms.value = [];
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  form.title = '';
  form.categoryId = categories.value[0]?.id;
  form.priceType = 'free';
  form.price = 9.9;
  createVisible.value = true;
}

async function submitCreate() {
  if (!formRef.value) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;
  creating.value = true;
  try {
    const created = await roomApi.create({
      title: form.title,
      categoryId: form.categoryId,
      priceType: form.priceType,
      price: form.priceType === 'free' ? 0 : form.price,
    });
    createVisible.value = false;
    ElMessage.success('直播间已创建');
    router.push(`/room/${created.id}`);
  } catch {
    /* 拦截器提示 */
  } finally {
    creating.value = false;
  }
}

async function startLive(id: number) {
  busy.value = `start-${id}`;
  try {
    await roomApi.startLive(id);
    ElMessage.success('已开播');
    await load();
  } finally {
    busy.value = '';
  }
}

async function endLive(id: number) {
  busy.value = `end-${id}`;
  try {
    await roomApi.endLive(id);
    ElMessage.success('直播已结束');
    await load();
  } finally {
    busy.value = '';
  }
}

async function openPush(roomId: number) {
  pushVisible.value = true;
  pushLoading.value = true;
  try {
    const [raw, stats] = await Promise.all([
      streamApi.pushInfo(roomId),
      streamApi.stats(roomId).catch(() => ({})),
    ]);
    pushInfo.value = {
      rtmpUrl: String(raw.rtmpUrl ?? raw.server ?? ''),
      streamKey: String(raw.streamKey ?? ''),
      ffmpegCommand: String(raw.ffmpegCommand ?? ''),
      playUrls: Array.isArray(raw.playUrls) ? (raw.playUrls as string[]) : [],
    };
    pushStats.value = stats;
  } catch {
    pushInfo.value = null;
  } finally {
    pushLoading.value = false;
  }
}

onMounted(async () => {
  await auth.fetchProfile().catch(() => null);
  await load();
});
</script>

<style scoped>
.studio {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.studio-card {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.studio-card__cover {
  position: relative;
  aspect-ratio: 16 / 9;
  background-size: cover;
  background-position: center;
  padding: 10px;
  display: flex;
  justify-content: flex-end;
  align-items: flex-start;
  gap: 6px;
}

.studio-card__body {
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.studio-card__body h3 {
  font-size: 15px;
}

.studio-card__body p {
  font-size: 12px;
}

.studio-card__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}

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
  margin: 0;
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

.push__stats {
  display: flex;
  gap: 18px;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
