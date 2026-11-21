<template>
  <div class="page admin-page">
    <header class="section-head">
      <div>
        <h1 class="section-title">运营后台</h1>
        <p class="section-sub">平台核心指标、用户封禁、直播间强制下播、订单与支付对账</p>
      </div>
      <el-button round :loading="loading" @click="refresh">刷新数据</el-button>
    </header>

    <el-alert
      v-if="!auth.isAdmin"
      type="warning"
      :closable="false"
      show-icon
      title="需要管理员权限"
      description="用演示账号 admin / Admin@123456 登录后可查看运营后台。"
      style="margin-bottom: 16px"
    />

    <template v-if="auth.isAdmin">
      <section class="stat-grid">
        <article v-for="card in statCards" :key="card.label" class="stat-card card card-pad">
          <span class="stat-card__label">{{ card.label }}</span>
          <strong class="stat-card__value">{{ card.value }}</strong>
          <span class="stat-card__hint text-muted">{{ card.hint }}</span>
        </article>
      </section>

      <el-tabs v-model="activeTab" class="admin-tabs">
        <el-tab-pane label="用户管理" name="users">
          <div class="toolbar">
            <el-input
              v-model="keyword"
              placeholder="搜索用户名 / 昵称"
              clearable
              style="max-width: 260px"
              @keyup.enter="loadUsers(1)"
              @clear="loadUsers(1)"
            />
            <el-button round @click="loadUsers(1)">搜索</el-button>
          </div>
          <el-table :data="users" v-loading="tabLoading" size="small">
            <el-table-column prop="id" label="ID" width="70" />
            <el-table-column prop="username" label="用户名" min-width="120" />
            <el-table-column prop="nickname" label="昵称" min-width="120" />
            <el-table-column label="角色" width="100">
              <template #default="{ row }">
                <span class="tag" :class="row.role === 'admin' ? 'tag-paid' : row.role === 'anchor' ? 'tag-live' : 'tag-muted'">
                  {{ roleLabel(row.role) }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="余额" width="110">
              <template #default="{ row }">¥{{ Number(row.balance).toFixed(2) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="110">
              <template #default="{ row }">
                <span :class="row.status === 'active' ? 'text-success' : 'text-danger'">
                  {{ row.status === 'active' ? '正常' : '已禁用' }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="120">
              <template #default="{ row }">
                <el-button
                  size="small"
                  round
                  :type="row.status === 'active' ? 'danger' : 'success'"
                  plain
                  :disabled="row.role === 'admin'"
                  @click="toggleUser(row)"
                >
                  {{ row.status === 'active' ? '禁用' : '启用' }}
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-pagination
            class="pager"
            layout="prev, pager, next, total"
            :total="usersTotal"
            :page-size="pageSize"
            :current-page="usersPage"
            @current-change="loadUsers"
          />
        </el-tab-pane>

        <el-tab-pane label="直播间" name="rooms">
          <el-table :data="rooms" v-loading="tabLoading" size="small">
            <el-table-column prop="id" label="ID" width="70" />
            <el-table-column prop="title" label="标题" min-width="200" />
            <el-table-column prop="anchorName" label="主播" width="110" />
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <span class="tag" :class="row.status === 'living' ? 'tag-live' : 'tag-muted'">{{ roomStatus(row.status) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="计费" width="120">
              <template #default="{ row }">
                {{ row.priceType === 'free' ? '免费' : `¥${Number(row.price).toFixed(2)}` }}
              </template>
            </el-table-column>
            <el-table-column prop="viewers" label="观看" width="90" />
            <el-table-column label="操作" width="120">
              <template #default="{ row }">
                <el-button
                  size="small"
                  round
                  type="danger"
                  plain
                  :disabled="row.status !== 'living'"
                  @click="forceClose(row)"
                >
                  强制下播
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-pagination
            class="pager"
            layout="prev, pager, next, total"
            :total="roomsTotal"
            :page-size="pageSize"
            :current-page="roomsPage"
            @current-change="loadRooms"
          />
        </el-tab-pane>

        <el-tab-pane label="订单" name="orders">
          <div class="toolbar">
            <el-radio-group v-model="orderStatus" size="small" @change="loadOrders(1)">
              <el-radio-button label="">全部</el-radio-button>
              <el-radio-button label="pending">待支付</el-radio-button>
              <el-radio-button label="paid">已支付</el-radio-button>
              <el-radio-button label="closed">已关闭</el-radio-button>
              <el-radio-button label="refunded">已退款</el-radio-button>
            </el-radio-group>
          </div>
          <el-table :data="orders" v-loading="tabLoading" size="small">
            <el-table-column prop="orderNo" label="订单号" min-width="200" class-name="mono" />
            <el-table-column prop="username" label="用户" width="110" />
            <el-table-column label="类型" width="100">
              <template #default="{ row }">{{ bizLabel(row.bizType) }}</template>
            </el-table-column>
            <el-table-column label="金额" width="110">
              <template #default="{ row }">¥{{ Number(row.amount).toFixed(2) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <span class="tag" :class="row.status === 'paid' ? 'tag-live' : 'tag-muted'">{{ orderStatusLabel(row.status) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="创建时间" min-width="160">
              <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
            </el-table-column>
          </el-table>
          <el-pagination
            class="pager"
            layout="prev, pager, next, total"
            :total="ordersTotal"
            :page-size="pageSize"
            :current-page="ordersPage"
            @current-change="loadOrders"
          />
        </el-tab-pane>

        <el-tab-pane label="支付对账" name="reconciliation">
          <div class="toolbar">
            <el-date-picker v-model="billDate" type="date" value-format="YYYY-MM-DD" placeholder="对账日期" style="max-width: 190px" />
            <el-select v-model="provider" style="max-width: 160px">
              <el-option label="Mock 沙箱" value="mock" />
              <el-option label="微信支付" value="wechat" />
              <el-option label="支付宝" value="alipay" />
            </el-select>
            <el-button type="primary" round :loading="reconLoading" @click="runReconciliation">执行对账</el-button>
          </div>
          <div v-if="reconciliation" class="recon-result card card-pad">
            <div class="recon-result__head">
              <h3>{{ reconciliation.billDate }} · {{ reconciliation.provider }}</h3>
              <span class="tag" :class="reconciliation.diffCount === 0 ? 'tag-live' : 'tag-paid'">
                {{ reconciliation.diffCount === 0 ? '账平' : `${reconciliation.diffCount} 笔差异` }}
              </span>
            </div>
            <el-row :gutter="16">
              <el-col :span="6"><div class="recon-kv"><span>本地笔数</span><strong>{{ reconciliation.localCount }}</strong></div></el-col>
              <el-col :span="6"><div class="recon-kv"><span>渠道笔数</span><strong>{{ reconciliation.channelCount }}</strong></div></el-col>
              <el-col :span="6"><div class="recon-kv"><span>本地金额</span><strong>¥{{ Number(reconciliation.totalLocal).toFixed(2) }}</strong></div></el-col>
              <el-col :span="6"><div class="recon-kv"><span>渠道金额</span><strong>¥{{ Number(reconciliation.totalChannel).toFixed(2) }}</strong></div></el-col>
            </el-row>
            <pre v-if="reconciliation.diffs.length" class="recon-diff">{{ JSON.stringify(reconciliation.diffs, null, 2) }}</pre>
            <p class="text-muted recon-tip">
              对账会把结果写入 <span class="mono">reconciliation_log</span>（唯一键 bill_date + provider），差异明细用于后续人工补单。
            </p>
          </div>
          <div v-else class="empty-state">选择日期与渠道后执行对账，用于核对本地流水与渠道账单</div>
        </el-tab-pane>
      </el-tabs>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { adminApi } from '@/api';
import type {
  AdminOrderRow,
  AdminRoomRow,
  AdminStats,
  AdminUserRow,
  PageResult,
  ReconciliationResult,
} from '@/api/types';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const loading = ref(false);
const tabLoading = ref(false);
const activeTab = ref<'users' | 'rooms' | 'orders' | 'reconciliation'>('users');

const stats = ref<AdminStats | null>(null);

const users = ref<AdminUserRow[]>([]);
const usersTotal = ref(0);
const usersPage = ref(1);
const keyword = ref('');

const rooms = ref<AdminRoomRow[]>([]);
const roomsTotal = ref(0);
const roomsPage = ref(1);

const orders = ref<AdminOrderRow[]>([]);
const ordersTotal = ref(0);
const ordersPage = ref(1);
const orderStatus = ref('');

const reconciliation = ref<ReconciliationResult | null>(null);
const reconLoading = ref(false);
const billDate = ref('');
const provider = ref('mock');

const pageSize = 10;

const statCards = computed(() => {
  const data = stats.value;
  if (!data) return [];
  return [
    { label: '注册用户', value: data.users.total, hint: `今日新增 ${data.users.today}` },
    { label: '直播间', value: data.rooms.total, hint: `正在直播 ${data.rooms.living}` },
    { label: '今日订单', value: data.orders.today, hint: `累计 ${data.orders.total} 笔` },
    { label: '今日成交额', value: `¥${Number(data.orders.revenueToday).toFixed(2)}`, hint: `支付 ${data.orders.paidToday} 笔` },
    { label: '今日礼物', value: `¥${Number(data.revenue.giftToday).toFixed(2)}`, hint: '礼物打赏流水' },
    { label: '今日弹幕', value: data.danmakuToday, hint: '社区活跃度' },
  ];
});

const roleMap: Record<string, string> = { admin: '运营', anchor: '主播', viewer: '观众' };
const roleLabel = (role: string): string => roleMap[role] ?? role;

const roomStatusMap: Record<string, string> = { living: '直播中', idle: '未开播', ended: '已结束' };
const roomStatus = (status: string): string => roomStatusMap[status] ?? status;

const bizMap: Record<string, string> = { room: '直播间会员', video: '点播购买', recharge: '钱包充值' };
const bizLabel = (biz: string): string => bizMap[biz] ?? biz;

const orderStatusMap: Record<string, string> = {
  pending: '待支付',
  paid: '已支付',
  closed: '已关闭',
  refunded: '已退款',
};
const orderStatusLabel = (status: string): string => orderStatusMap[status] ?? status;

function fmt(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

async function refresh() {
  loading.value = true;
  try {
    stats.value = await adminApi.stats();
  } catch {
    /* 拦截器提示 */
  } finally {
    loading.value = false;
  }
  await loadTab();
}

async function loadTab() {
  if (!auth.isAdmin) return;
  if (activeTab.value === 'users') await loadUsers(usersPage.value);
  else if (activeTab.value === 'rooms') await loadRooms(roomsPage.value);
  else if (activeTab.value === 'orders') await loadOrders(ordersPage.value);
}

async function loadUsers(page = 1) {
  usersPage.value = page;
  tabLoading.value = true;
  try {
    const res = (await adminApi.users(page, pageSize, keyword.value || undefined)) as unknown as PageResult<AdminUserRow>;
    users.value = res.list;
    usersTotal.value = res.total;
  } catch {
    users.value = [];
  } finally {
    tabLoading.value = false;
  }
}

async function loadRooms(page = 1) {
  roomsPage.value = page;
  tabLoading.value = true;
  try {
    const res = (await adminApi.rooms(page, pageSize)) as unknown as PageResult<AdminRoomRow>;
    rooms.value = res.list;
    roomsTotal.value = res.total;
  } catch {
    rooms.value = [];
  } finally {
    tabLoading.value = false;
  }
}

async function loadOrders(page = 1) {
  ordersPage.value = page;
  tabLoading.value = true;
  try {
    const res = (await adminApi.orders(page, pageSize, orderStatus.value || undefined)) as unknown as PageResult<AdminOrderRow>;
    orders.value = res.list;
    ordersTotal.value = res.total;
  } catch {
    orders.value = [];
  } finally {
    tabLoading.value = false;
  }
}

async function toggleUser(row: AdminUserRow) {
  const next = row.status === 'active' ? 'disabled' : 'active';
  try {
    await ElMessageBox.confirm(
      `确认${next === 'disabled' ? '禁用' : '启用'}用户「${row.username}」？`,
      '操作确认',
      { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    await adminApi.setUserStatus(row.id, next);
    row.status = next;
    ElMessage.success('已更新用户状态');
  } catch {
    /* 拦截器提示 */
  }
}

async function forceClose(row: AdminRoomRow) {
  try {
    await ElMessageBox.confirm(`确认强制结束直播间「${row.title}」的直播？`, '强制下播', {
      type: 'warning',
      confirmButtonText: '强制下播',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await adminApi.closeRoom(row.id);
    row.status = 'ended';
    ElMessage.success('已强制下播');
  } catch {
    /* 拦截器提示 */
  }
}

async function runReconciliation() {
  reconLoading.value = true;
  try {
    reconciliation.value = (await adminApi.reconciliation({
      billDate: billDate.value || undefined,
      provider: provider.value,
    })) as unknown as ReconciliationResult;
    ElMessage.success('对账完成');
  } catch {
    /* 拦截器提示 */
  } finally {
    reconLoading.value = false;
  }
}

watch(activeTab, (tab) => {
  if (tab !== 'reconciliation') void loadTab();
});

onMounted(async () => {
  await auth.fetchProfile().catch(() => null);
  await refresh();
  await loadTab();
});
</script>

<style scoped>
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
  margin-bottom: 18px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stat-card__label {
  font-size: 12px;
  color: var(--text-muted);
}

.stat-card__value {
  font-size: 24px;
  font-weight: 700;
  background: var(--gradient-brand);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.stat-card__hint {
  font-size: 11px;
}

.admin-tabs {
  padding: 8px 16px 20px;
  border-radius: var(--radius-md);
  background: var(--bg-card);
  border: 1px solid var(--border-soft);
}

.toolbar {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 12px;
}

.pager {
  margin-top: 14px;
  justify-content: flex-end;
}

.recon-result__head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.recon-result__head h3 {
  font-size: 15px;
}

.recon-kv {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-soft);
}

.recon-kv span {
  font-size: 11px;
  color: var(--text-muted);
}

.recon-diff {
  margin: 14px 0 0;
  padding: 12px;
  max-height: 260px;
  overflow: auto;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--border-soft);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  color: #ffd9a8;
}

.recon-tip {
  margin-top: 12px;
  font-size: 11px;
  line-height: 1.7;
}

.text-success {
  color: var(--success);
}

.text-danger {
  color: var(--danger);
}
</style>
