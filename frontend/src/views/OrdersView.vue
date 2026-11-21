<template>
  <div class="page">
    <header class="section-head">
      <div>
        <h1 class="section-title">我的订单</h1>
        <p class="section-sub">充值、直播间会员、点播解锁的统一订单流水，15 分钟未支付自动关闭</p>
      </div>
      <el-radio-group v-model="status" @change="load(1)">
        <el-radio-button label="">全部</el-radio-button>
        <el-radio-button label="pending">待支付</el-radio-button>
        <el-radio-button label="paid">已支付</el-radio-button>
        <el-radio-button label="closed">已关闭</el-radio-button>
        <el-radio-button label="refunded">已退款</el-radio-button>
      </el-radio-group>
    </header>

    <div v-loading="loading" class="card">
      <el-table v-if="list.length" :data="list" class="order-table">
        <el-table-column label="订单号" width="210">
          <template #default="{ row }">
            <span class="mono order-no">{{ row.orderNo }}</span>
          </template>
        </el-table-column>
        <el-table-column label="内容" min-width="200">
          <template #default="{ row }">
            <div class="order-title">
              <span>{{ row.title || bizLabel(row.bizType) }}</span>
              <small class="text-muted">{{ bizLabel(row.bizType) }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="120">
          <template #default="{ row }">
            <span class="price mono">¥{{ Number(row.amount).toFixed(2) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <span class="tag" :class="statusClass(row.status)">{{ statusLabel(row.status) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="支付渠道" width="120">
          <template #default="{ row }">
            <span v-if="row.payProvider" class="mono">{{ providerLabel(row.payProvider) }}</span>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">
            <span class="mono text-muted">{{ formatTime(row.createdAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <template v-if="row.status === 'pending'">
              <el-button size="small" type="primary" round @click="router.push(`/checkout/${row.orderNo}`)">
                去支付
              </el-button>
              <el-button size="small" round :loading="cancelling === row.orderNo" @click="cancel(row.orderNo)">
                取消
              </el-button>
            </template>
            <el-button v-else size="small" text @click="showDetail(row.orderNo)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div v-else-if="!loading" class="empty-state">
        还没有订单
        <div style="margin-top: 12px">
          <el-button round type="primary" @click="router.push('/')">去看看直播</el-button>
        </div>
      </div>

      <div class="pager">
        <el-pagination
          layout="total, prev, pager, next"
          :current-page="page"
          :page-size="pageSize"
          :total="total"
          @current-change="load"
        />
      </div>
    </div>

    <el-drawer v-model="detailVisible" title="订单详情" size="440px">
      <div v-loading="detailLoading" class="order-detail">
        <template v-if="detail">
          <div class="order-detail__row">
            <span class="text-muted">订单号</span>
            <span class="mono">{{ detail.orderNo }}</span>
          </div>
          <div class="order-detail__row">
            <span class="text-muted">标题</span>
            <span>{{ detail.title }}</span>
          </div>
          <div class="order-detail__row">
            <span class="text-muted">金额</span>
            <span class="price mono">¥{{ Number(detail.amount).toFixed(2) }}</span>
          </div>
          <div class="order-detail__row">
            <span class="text-muted">状态</span>
            <span class="tag" :class="statusClass(detail.status)">{{ statusLabel(detail.status) }}</span>
          </div>
          <div class="order-detail__row">
            <span class="text-muted">创建时间</span>
            <span class="mono">{{ formatTime(detail.createdAt) }}</span>
          </div>
          <div class="order-detail__row">
            <span class="text-muted">过期时间</span>
            <span class="mono">{{ formatTime(detail.expireAt) }}</span>
          </div>
          <div class="order-detail__row">
            <span class="text-muted">支付时间</span>
            <span class="mono">{{ detail.paidAt ? formatTime(detail.paidAt) : '-' }}</span>
          </div>
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { orderApi } from '@/api';
import type { OrderView } from '@/api/types';

const router = useRouter();

const loading = ref(true);
const list = ref<OrderView[]>([]);
const status = ref('');
const page = ref(1);
const pageSize = ref(10);
const total = ref(0);
const cancelling = ref('');

const detailVisible = ref(false);
const detailLoading = ref(false);
const detail = ref<OrderView | null>(null);

const bizLabels: Record<string, string> = { room: '直播间会员', video: '点播解锁', recharge: '钱包充值' };
const statusLabels: Record<string, string> = { pending: '待支付', paid: '已支付', closed: '已关闭', refunded: '已退款' };
const providerLabels: Record<string, string> = { mock: 'Mock 沙箱', wechat: '微信支付', alipay: '支付宝' };

function bizLabel(value: string): string {
  return bizLabels[value] ?? value;
}

function statusLabel(value: string): string {
  return statusLabels[value] ?? value;
}

function providerLabel(value: string): string {
  return providerLabels[value] ?? value;
}

function statusClass(value: string): string {
  if (value === 'paid') return 'tag-live';
  if (value === 'pending') return 'tag-paid';
  return 'tag-muted';
}

function formatTime(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}

async function load(nextPage = page.value) {
  loading.value = true;
  page.value = nextPage;
  try {
    const res = await orderApi.list({ page: page.value, pageSize: pageSize.value, status: status.value || undefined });
    list.value = res.list;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

async function cancel(orderNo: string) {
  cancelling.value = orderNo;
  try {
    await orderApi.cancel(orderNo);
    ElMessage.success('订单已取消');
    await load();
  } finally {
    cancelling.value = '';
  }
}

async function showDetail(orderNo: string) {
  detailVisible.value = true;
  detailLoading.value = true;
  try {
    detail.value = await orderApi.detail(orderNo);
  } catch {
    detail.value = null;
  } finally {
    detailLoading.value = false;
  }
}

onMounted(() => load(1));
</script>

<style scoped>
.order-table {
  background: transparent;
}

.order-no {
  font-size: 11px;
  color: var(--text-secondary);
}

.order-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}

.order-title small {
  font-size: 11px;
}

.pager {
  display: flex;
  justify-content: flex-end;
  padding: 14px 16px;
}

.order-detail {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.order-detail__row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  font-size: 13px;
  padding-bottom: 12px;
  border-bottom: 1px dashed var(--border-soft);
}

.order-detail__row .mono {
  font-size: 12px;
  word-break: break-all;
  text-align: right;
}
</style>
