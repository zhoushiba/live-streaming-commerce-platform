<template>
  <div class="giftbar">
    <div class="giftbar__head">
      <span class="giftbar__title"><el-icon><Present /></el-icon> 礼物</span>
      <span class="giftbar__balance mono">
        余额 <b :class="{ 'is-low': balance < cheapest }">¥{{ balance.toFixed(2) }}</b>
      </span>
    </div>

    <div class="giftbar__grid">
      <button
        v-for="gift in gifts"
        :key="gift.id"
        class="gift"
        :class="{ 'is-active': selected?.id === gift.id }"
        @click="select(gift)"
      >
        <span class="gift__icon">{{ gift.icon }}</span>
        <span class="gift__name">{{ gift.name }}</span>
        <span class="gift__price mono">¥{{ gift.price }}</span>
      </button>
    </div>

    <div class="giftbar__actions">
      <div class="qty">
        <button class="qty__btn" :disabled="count <= 1" @click="count = Math.max(1, count - 1)">−</button>
        <span class="qty__value mono">{{ count }}</span>
        <button class="qty__btn" :disabled="count >= 99" @click="count = Math.min(99, count + 1)">+</button>
      </div>
      <el-button type="primary" round :loading="sending" :disabled="!selected" @click="send">
        送出{{ selected ? ` ${selected.name} ×${count}` : '' }}
      </el-button>
    </div>
    <p class="giftbar__total">
      合计 <span class="mono">¥{{ total.toFixed(2) }}</span>
      <span v-if="!auth.isLogin" class="text-muted">· 登录后可送礼物</span>
      <span v-else-if="balance < total" class="text-muted">· 余额不足，先去充值</span>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Present } from '@element-plus/icons-vue';
import { giftApi } from '@/api';
import type { GiftItem } from '@/api/types';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{ roomId: number }>();
const emit = defineEmits<{ (e: 'sent', payload: Record<string, unknown>): void; (e: 'need-recharge'): void }>();

const auth = useAuthStore();
const gifts = ref<GiftItem[]>([]);
const selected = ref<GiftItem | null>(null);
const count = ref(1);
const sending = ref(false);

const balance = computed(() => auth.balance);
const total = computed(() => (selected.value ? selected.value.price * count.value : 0));
const cheapest = computed(() => (gifts.value.length ? Math.min(...gifts.value.map((g) => g.price)) : 0));

onMounted(async () => {
  try {
    gifts.value = await giftApi.list();
    if (gifts.value.length) selected.value = gifts.value[1] ?? gifts.value[0];
  } catch {
    /* 拦截器已提示 */
  }
});

function select(gift: GiftItem) {
  selected.value = gift;
}

/**
 * 送礼：requestId 由前端生成并作为幂等键。
 * 网络抖动时用户重复点击同一 requestId 不会重复扣款（后端 gift_record.request_id 唯一）。
 */
async function send() {
  if (!selected.value) return;
  if (!auth.isLogin) {
    ElMessage.warning('请先登录');
    return;
  }
  if (balance.value < total.value) {
    ElMessage.warning('余额不足，请先充值');
    emit('need-recharge');
    return;
  }

  sending.value = true;
  const requestId = `gift-${props.roomId}-${auth.user?.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const result = await giftApi.send({ roomId: props.roomId, giftId: selected.value.id, count: count.value, requestId });
    ElMessage.success(`已送出 ${result.giftName} ×${result.count}`);
    emit('sent', { ...result, giftName: result.giftName, count: result.count });
    await auth.fetchProfile();
  } catch {
    /* 拦截器已提示 */
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
.giftbar {
  padding: 14px;
  border-radius: var(--radius-md);
  background: var(--bg-card);
  border: 1px solid var(--border-soft);
}

.giftbar__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.giftbar__title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
}

.giftbar__balance {
  font-size: 12px;
  color: var(--text-muted);
}

.giftbar__balance b {
  color: #ffd08a;
}

.giftbar__balance b.is-low {
  color: var(--danger);
}

.giftbar__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 8px;
}

.gift {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 6px;
  border-radius: 10px;
  border: 1px solid var(--border-soft);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.16s ease;
}

.gift:hover {
  border-color: rgba(91, 140, 255, 0.5);
  transform: translateY(-1px);
}

.gift.is-active {
  border-color: rgba(91, 140, 255, 0.85);
  background: rgba(91, 140, 255, 0.12);
  color: var(--text-primary);
}

.gift__icon {
  font-size: 22px;
  line-height: 1.2;
}

.gift__name {
  font-size: 12px;
}

.gift__price {
  font-size: 11px;
  color: #ffd08a;
}

.giftbar__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}

.qty {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  overflow: hidden;
}

.qty__btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 15px;
}

.qty__btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.qty__value {
  min-width: 30px;
  text-align: center;
  font-size: 13px;
}

.giftbar__actions :deep(.el-button) {
  flex: 1;
}

.giftbar__total {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-muted);
  display: flex;
  gap: 6px;
  align-items: baseline;
}

.giftbar__total .mono {
  color: #ffd08a;
  font-weight: 600;
}
</style>
