<template>
  <div class="page profile-page">
    <header class="profile-head card card-pad">
      <el-avatar :size="64" :src="auth.user?.avatar || undefined">
        {{ auth.user?.nickname?.slice(0, 1) ?? 'U' }}
      </el-avatar>
      <div class="profile-head__info">
        <h1>{{ auth.user?.nickname ?? '未登录' }}</h1>
        <p class="text-muted">
          <span class="mono">@{{ auth.user?.username }}</span>
          <span class="dot">·</span>
          <span>{{ roleLabel }}</span>
          <span class="dot">·</span>
          <span class="mono">ID {{ auth.user?.id }}</span>
        </p>
      </div>
      <div class="profile-head__wallet">
        <span class="text-muted">钱包余额</span>
        <span class="price mono">¥{{ auth.balance.toFixed(2) }}</span>
        <el-button type="primary" round @click="rechargeVisible = true">充值</el-button>
      </div>
    </header>

    <el-tabs v-model="tab" class="profile-tabs">
      <!-- 概览 -->
      <el-tab-pane label="账号资料" name="overview">
        <div class="card card-pad">
          <el-form label-width="90px" class="profile-form">
            <el-form-item label="昵称">
              <el-input v-model="form.nickname" maxlength="20" show-word-limit placeholder="2-20 个字符" />
            </el-form-item>
            <el-form-item label="头像地址">
              <el-input v-model="form.avatar" placeholder="https://...（可选）" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" round :loading="saving" @click="saveProfile">保存修改</el-button>
              <el-button round @click="tab = 'wallet'">查看钱包</el-button>
            </el-form-item>
          </el-form>
          <div class="profile-meta">
            <span>注册时间：{{ formatTime(auth.user?.createdAt) }}</span>
            <span>最近登录：{{ formatTime(auth.user?.lastLoginAt) }}</span>
          </div>
        </div>
      </el-tab-pane>

      <!-- 钱包 -->
      <el-tab-pane label="钱包与充值" name="wallet">
        <div class="wallet-cards">
          <div class="wallet-card card card-pad">
            <span class="text-muted">可用余额</span>
            <p class="price mono wallet-card__value">¥{{ (wallet?.balance ?? auth.balance).toFixed(2) }}</p>
          </div>
          <div class="wallet-card card card-pad">
            <span class="text-muted">累计充值</span>
            <p class="mono wallet-card__value">¥{{ (wallet?.totalRecharge ?? 0).toFixed(2) }}</p>
          </div>
          <div class="wallet-card card card-pad">
            <span class="text-muted">累计消费</span>
            <p class="mono wallet-card__value">¥{{ (wallet?.totalConsume ?? 0).toFixed(2) }}</p>
          </div>
        </div>

        <div class="card card-pad">
          <header class="section-head">
            <h2 class="section-title">余额流水</h2>
            <el-button round size="small" :loading="txLoading" @click="loadTransactions">刷新</el-button>
          </header>
          <el-table v-loading="txLoading" :data="transactions" class="tx-table">
            <el-table-column label="业务单号" min-width="220">
              <template #default="{ row }"><span class="mono tx-no">{{ row.bizNo }}</span></template>
            </el-table-column>
            <el-table-column label="类型" width="100">
              <template #default="{ row }">
                <span class="tag" :class="row.amount >= 0 ? 'tag-free' : 'tag-paid'">
                  {{ row.amount >= 0 ? '收入' : '支出' }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="变动" width="120">
              <template #default="{ row }">
                <span class="mono" :class="row.amount >= 0 ? 'tx-in' : 'tx-out'">
                  {{ row.amount >= 0 ? '+' : '' }}{{ Number(row.amount).toFixed(2) }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="余额" width="120">
              <template #default="{ row }"><span class="mono">¥{{ Number(row.balanceAfter).toFixed(2) }}</span></template>
            </el-table-column>
            <el-table-column label="备注" min-width="160">
              <template #default="{ row }"><span class="text-muted">{{ row.remark || '-' }}</span></template>
            </el-table-column>
            <el-table-column label="时间" width="170">
              <template #default="{ row }"><span class="mono text-muted">{{ formatTime(row.createdAt) }}</span></template>
            </el-table-column>
          </el-table>
          <div v-if="!transactions.length && !txLoading" class="empty-state">还没有余额变动记录</div>
        </div>
      </el-tab-pane>

      <!-- 权益 -->
      <el-tab-pane label="我的权益" name="entitlements">
        <div class="card card-pad">
          <header class="section-head">
            <h2 class="section-title">已解锁内容</h2>
            <el-button round size="small" :loading="entLoading" @click="loadEntitlements">刷新</el-button>
          </header>
          <ul v-loading="entLoading" class="ent-list">
            <li v-for="item in entitlements" :key="item.id" class="ent-item">
              <span class="ent-item__icon">{{ item.targetType === 'room' ? '📺' : '🎬' }}</span>
              <div class="ent-item__body">
                <p>{{ item.title || `${item.targetType === 'room' ? '直播间' : '点播'} #${item.targetId}` }}</p>
                <span class="text-muted mono">
                  {{ item.source }} · {{ item.expireAt ? `有效期至 ${formatTime(item.expireAt)}` : '永久有效' }}
                </span>
              </div>
              <span class="tag" :class="item.active ? 'tag-live' : 'tag-muted'">{{ item.active ? '生效中' : '已失效' }}</span>
            </li>
          </ul>
          <div v-if="!entitlements.length && !entLoading" class="empty-state">
            还没有解锁记录，去直播间或点播专区逛逛吧
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <PayDialog v-model="rechargeVisible" biz-type="recharge" title="钱包充值" @success="onRechargeSuccess" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import PayDialog from '@/components/PayDialog.vue';
import { authApi, entitlementApi, walletApi } from '@/api';
import type { BalanceTransaction, EntitlementView, WalletInfo } from '@/api/types';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const route = useRoute();

const tab = ref('overview');
const form = reactive({ nickname: '', avatar: '' });
const saving = ref(false);
const rechargeVisible = ref(false);

const wallet = ref<WalletInfo | null>(null);
const transactions = ref<BalanceTransaction[]>([]);
const txLoading = ref(false);

const entitlements = ref<EntitlementView[]>([]);
const entLoading = ref(false);

const roleLabel = computed(() => {
  const map: Record<string, string> = { viewer: '观众', anchor: '主播', admin: '平台运营' };
  return map[auth.user?.role ?? 'viewer'] ?? '观众';
});

function formatTime(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}

async function saveProfile() {
  saving.value = true;
  try {
    await authApi.updateProfile({ nickname: form.nickname, avatar: form.avatar });
    await auth.fetchProfile();
    ElMessage.success('资料已更新');
  } catch {
    /* 拦截器已提示 */
  } finally {
    saving.value = false;
  }
}

async function loadWallet() {
  txLoading.value = true;
  try {
    const [me, txs] = await Promise.all([walletApi.me(), walletApi.transactions(1, 20)]);
    wallet.value = me;
    transactions.value = txs.list;
  } catch {
    /* 未登录或网络异常时静默 */
  } finally {
    txLoading.value = false;
  }
}

async function loadTransactions() {
  txLoading.value = true;
  try {
    const [me, txs] = await Promise.all([walletApi.me(), walletApi.transactions(1, 20)]);
    wallet.value = me;
    transactions.value = txs.list;
  } finally {
    txLoading.value = false;
  }
}

async function loadEntitlements() {
  entLoading.value = true;
  try {
    entitlements.value = await entitlementApi.mine();
  } catch {
    entitlements.value = [];
  } finally {
    entLoading.value = false;
  }
}

async function onRechargeSuccess() {
  await Promise.all([auth.fetchProfile(), loadWallet()]);
  ElMessage.success('充值成功');
}

watch(tab, (value) => {
  if (value === 'wallet' && !transactions.value.length) void loadWallet();
  if (value === 'entitlements' && !entitlements.value.length) void loadEntitlements();
});

onMounted(async () => {
  await auth.fetchProfile();
  form.nickname = auth.user?.nickname ?? '';
  form.avatar = auth.user?.avatar ?? '';
  const queryTab = typeof route.query.tab === 'string' ? route.query.tab : '';
  if (queryTab === 'wallet' || queryTab === 'entitlements') tab.value = queryTab;
  await loadWallet();
});
</script>

<style scoped>
.profile-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.profile-head {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}

.profile-head__info {
  flex: 1;
  min-width: 180px;
}

.profile-head__info h1 {
  font-size: 22px;
  margin-bottom: 4px;
}

.profile-head__info p {
  font-size: 12px;
  display: flex;
  gap: 6px;
  align-items: center;
}

.profile-head__wallet {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-radius: var(--radius-md);
  background: rgba(255, 181, 71, 0.08);
  border: 1px solid rgba(255, 181, 71, 0.22);
  font-size: 12px;
}

.profile-head__wallet .price {
  font-size: 20px;
}

.profile-form {
  max-width: 520px;
}

.profile-meta {
  display: flex;
  gap: 24px;
  margin-top: 8px;
  padding-top: 14px;
  border-top: 1px dashed var(--border-soft);
  font-size: 12px;
  color: var(--text-muted);
  flex-wrap: wrap;
}

.wallet-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}

.wallet-card span {
  font-size: 12px;
}

.wallet-card__value {
  font-size: 26px;
  margin-top: 8px;
}

.tx-no {
  font-size: 11px;
  color: var(--text-secondary);
}

.tx-in {
  color: var(--success);
}

.tx-out {
  color: var(--danger);
}

.ent-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  list-style: none;
  padding: 0;
  margin: 0;
}

.ent-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-soft);
  background: rgba(255, 255, 255, 0.02);
}

.ent-item__icon {
  font-size: 20px;
}

.ent-item__body {
  flex: 1;
  min-width: 0;
}

.ent-item__body p {
  font-size: 13px;
  margin-bottom: 2px;
}

.ent-item__body span {
  font-size: 11px;
}

.dot {
  opacity: 0.4;
}
</style>
