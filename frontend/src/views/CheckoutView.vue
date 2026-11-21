<template>
  <div v-loading="loading" class="page checkout-page">
    <template v-if="order">
      <header class="checkout-head">
        <h1 class="section-title">收银台</h1>
        <p class="section-sub">订单已创建，选择支付渠道完成付款；演示环境使用 Mock 渠道模拟「渠道回调 → 验签 → 幂等 → 发货」全链路</p>
      </header>

      <div class="checkout-layout">
        <section class="checkout-main">
          <div class="card card-pad order-summary">
            <div class="order-summary__row">
              <span class="text-muted">订单号</span>
              <span class="mono">{{ order.orderNo }}</span>
            </div>
            <div class="order-summary__row">
              <span class="text-muted">购买内容</span>
              <span>{{ order.title }}</span>
            </div>
            <div class="order-summary__row">
              <span class="text-muted">业务类型</span>
              <span class="tag tag-muted">{{ bizLabel(order.bizType) }}</span>
            </div>
            <div class="order-summary__row">
              <span class="text-muted">应付金额</span>
              <span class="price mono checkout-amount">¥{{ Number(order.amount).toFixed(2) }}</span>
            </div>
            <div class="order-summary__row">
              <span class="text-muted">支付截止</span>
              <span class="mono">{{ formatTime(order.expireAt) }}</span>
            </div>
            <div class="order-summary__row">
              <span class="text-muted">订单状态</span>
              <span class="tag" :class="statusClass(order.status)">{{ statusLabel(order.status) }}</span>
            </div>
          </div>

          <div class="card card-pad">
            <h2 class="section-title">选择支付方式</h2>
            <div class="providers">
              <button
                v-for="item in providers"
                :key="item.code"
                type="button"
                class="provider"
                :class="{ 'is-active': provider === item.code }"
                @click="provider = item.code"
              >
                <span class="provider__logo">{{ providerShort(item.code) }}</span>
                <span class="provider__text">
                  <b>{{ item.displayName }}</b>
                  <small class="text-muted">{{ item.sandbox ? '沙箱模式' : '生产模式' }}</small>
                </span>
                <el-icon v-if="provider === item.code" class="provider__check"><Select /></el-icon>
              </button>
            </div>
            <p class="provider-notice text-muted">
              <el-icon><InfoFilled /></el-icon>
              {{ activeProvider?.notice }}
            </p>
            <el-button
              type="primary"
              size="large"
              round
              class="pay-btn"
              :loading="creating"
              :disabled="order.status !== 'pending'"
              @click="startPayment"
            >
              {{ order.status === 'pending' ? `支付 ¥${Number(order.amount).toFixed(2)}` : '该订单当前不可支付' }}
            </el-button>
          </div>

          <!-- 支付结果 -->
          <div v-if="payment" class="card card-pad">
            <h2 class="section-title">支付流水</h2>
            <div class="order-summary__row">
              <span class="text-muted">支付单号（outTradeNo）</span>
              <span class="mono">{{ payment.outTradeNo }}</span>
            </div>
            <div class="order-summary__row">
              <span class="text-muted">渠道</span>
              <span class="mono">{{ payment.provider }}</span>
            </div>
            <div class="order-summary__row">
              <span class="text-muted">金额</span>
              <span class="mono">¥{{ Number(payment.amount).toFixed(2) }}</span>
            </div>

            <template v-if="payment.mockNotifyBody">
              <div class="notify-panel">
                <p class="notify-panel__title">
                  <el-icon><Bell /></el-icon>
                  Mock 渠道会下发一条 HMAC-SHA256 签名的回调报文
                </p>
                <pre class="notify-panel__json">{{ notifyPreview }}</pre>
                <div class="notify-panel__actions">
                  <el-button type="primary" round :loading="notifying" @click="sendNotify">
                    模拟渠道回调（POST /payments/mock/notify）
                  </el-button>
                  <el-button round @click="openMockCashier">在新页面打开模拟收银台</el-button>
                </div>
              </div>
            </template>

            <div v-else class="sandbox-params">
              <p class="text-muted">该渠道为沙箱模式，真实接入时需要把下面的支付参数交给收银台 SDK / 二维码组件：</p>
              <pre class="notify-panel__json">{{ JSON.stringify(payment.payParams, null, 2) }}</pre>
              <p class="text-muted">
                本仓库只内置 Mock 渠道的完整回调闭环；微信/支付宝的验签逻辑在
                <code class="mono">backend/src/modules/payment/providers/</code> 中预留了扩展点。
              </p>
            </div>
          </div>

          <div v-if="outcome" class="card card-pad result-card" :class="outcome.success ? 'is-success' : 'is-failed'">
            <p class="result-card__title">
              <el-icon><CircleCheckFilled v-if="outcome.success" /><CircleCloseFilled v-else /></el-icon>
              {{ outcome.success ? '支付成功，权益已发放' : '回调被拒绝' }}
            </p>
            <ul class="result-card__list">
              <li>订单状态：{{ outcome.success ? '已支付' : '未变更' }}</li>
              <li>幂等判定：{{ outcome.duplicate ? '重复回调，未重复发货' : '首次回调，已完成发货' }}</li>
              <li v-if="outcome.granted?.length">发放内容：{{ outcome.granted.join(' / ') }}</li>
              <li>渠道消息：{{ outcome.message }}</li>
            </ul>
            <div class="result-card__actions">
              <el-button type="primary" round @click="router.push('/orders')">查看我的订单</el-button>
              <el-button round @click="router.push('/')">继续逛直播</el-button>
            </div>
          </div>
        </section>

        <aside class="checkout-side">
          <div class="card card-pad">
            <h3 class="section-title">支付链路</h3>
            <ol class="flow">
              <li class="is-done">创建订单（DB 事务 + 幂等键）</li>
              <li :class="{ 'is-done': Boolean(payment) }">发起支付（payment_transaction pending）</li>
              <li :class="{ 'is-done': Boolean(outcome) }">渠道回调（HMAC / RSA 验签）</li>
              <li :class="{ 'is-done': Boolean(outcome?.success) }">幂等结算（CAS pending → success）</li>
              <li :class="{ 'is-done': Boolean(outcome?.success) }">事务发放权益（钱包 / 会员 / 点播）</li>
            </ol>
          </div>
          <div class="card card-pad">
            <h3 class="section-title">安全要点</h3>
            <ul class="safety">
              <li>回调地址 <span class="mono">@Public</span>，校验签名与时间戳窗口</li>
              <li>金额与订单金额严格比对，防止篡改</li>
              <li>重复回调不重复发货（流水状态 CAS）</li>
              <li>权益表唯一键 <span class="mono">(user_id,target_type,target_id)</span> 兜底</li>
            </ul>
          </div>
        </aside>
      </div>
    </template>

    <div v-else-if="!loading" class="empty-state">
      订单不存在或无权访问
      <div style="margin-top: 12px">
        <el-button round @click="router.push('/orders')">返回我的订单</el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Bell, CircleCheckFilled, CircleCloseFilled, InfoFilled, Select } from '@element-plus/icons-vue';
import { orderApi, paymentApi } from '@/api';
import type { CreatedPayment, NotifyOutcome, OrderView, PaymentProviderCode, ProviderInfo } from '@/api/types';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const loading = ref(true);
const order = ref<OrderView | null>(null);
const providers = ref<ProviderInfo[]>([]);
const provider = ref<PaymentProviderCode>('mock');
const payment = ref<CreatedPayment | null>(null);
const outcome = ref<NotifyOutcome | null>(null);
const creating = ref(false);
const notifying = ref(false);

const bizLabels: Record<string, string> = { room: '直播间会员', video: '点播解锁', recharge: '钱包充值' };
const statusLabels: Record<string, string> = { pending: '待支付', paid: '已支付', closed: '已关闭', refunded: '已退款' };

const activeProvider = computed(() => providers.value.find((item) => item.code === provider.value) ?? null);
const notifyPreview = computed(() => JSON.stringify(payment.value?.mockNotifyBody ?? {}, null, 2));

function bizLabel(value: string): string {
  return bizLabels[value] ?? value;
}

function statusLabel(value: string): string {
  return statusLabels[value] ?? value;
}

function statusClass(value: string): string {
  if (value === 'paid') return 'tag-live';
  if (value === 'pending') return 'tag-paid';
  return 'tag-muted';
}

function providerShort(code: string): string {
  return ({ mock: 'M', wechat: '微', alipay: '支' } as Record<string, string>)[code] ?? code;
}

function formatTime(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}

async function load() {
  loading.value = true;
  try {
    const [detail, list] = await Promise.all([
      orderApi.detail(String(route.params.orderNo)),
      paymentApi.providers().catch(() => [] as ProviderInfo[]),
    ]);
    order.value = detail;
    providers.value = list.length ? list : [{ code: 'mock', displayName: 'Mock 支付', sandbox: true, notice: '本地 HMAC 验签' }];
  } catch {
    order.value = null;
  } finally {
    loading.value = false;
  }
}

async function startPayment() {
  if (!order.value) return;
  creating.value = true;
  try {
    payment.value = await paymentApi.create({ orderNo: order.value.orderNo, provider: provider.value });
    outcome.value = null;
    if (payment.value.mockNotifyBody) {
      sessionStorage.setItem(`lc_mock_pay:${payment.value.outTradeNo}`, JSON.stringify(payment.value.mockNotifyBody));
      ElMessage.success('支付单已创建，可点击下方按钮模拟渠道回调');
    } else {
      ElMessage.info('支付单已创建，请在渠道侧完成支付（沙箱模式不会真实扣款）');
    }
  } catch {
    /* 拦截器提示 */
  } finally {
    creating.value = false;
  }
}

async function sendNotify() {
  if (!payment.value?.mockNotifyBody) return;
  notifying.value = true;
  try {
    outcome.value = await paymentApi.mockNotify(payment.value.mockNotifyBody as unknown as Record<string, unknown>);
    if (outcome.value.success) {
      await Promise.all([load(), auth.fetchProfile()]);
      ElMessage.success('支付成功');
    }
  } catch {
    /* 拦截器提示（验签失败/金额不符等） */
  } finally {
    notifying.value = false;
  }
}

function openMockCashier() {
  if (!payment.value) return;
  void router.push({ name: 'mock-pay', query: { outTradeNo: payment.value.outTradeNo } });
}

onMounted(load);
</script>

<style scoped>
.checkout-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.checkout-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 18px;
  align-items: start;
}

.checkout-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.order-summary {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.order-summary__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  font-size: 13px;
}

.order-summary__row > span:last-child {
  text-align: right;
  word-break: break-all;
}

.checkout-amount {
  font-size: 24px;
}

.providers {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin: 14px 0 12px;
}

.provider {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-soft);
  background: rgba(255, 255, 255, 0.02);
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
  transition: all 0.16s ease;
}

.provider.is-active {
  border-color: rgba(91, 140, 255, 0.6);
  background: rgba(91, 140, 255, 0.1);
}

.provider__logo {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--gradient-brand);
  font-weight: 700;
  font-size: 14px;
}

.provider__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.provider__text b {
  font-size: 13px;
}

.provider__text small {
  font-size: 11px;
}

.provider__check {
  color: var(--brand);
}

.provider-notice {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  line-height: 1.7;
  margin-bottom: 16px;
}

.pay-btn {
  width: 100%;
}

.notify-panel {
  margin-top: 16px;
  padding: 14px;
  border-radius: var(--radius-sm);
  border: 1px dashed rgba(91, 140, 255, 0.4);
  background: rgba(91, 140, 255, 0.06);
}

.notify-panel__title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin-bottom: 10px;
}

.notify-panel__json {
  margin: 0 0 12px;
  padding: 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--border-soft);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  color: #b8f0d8;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.notify-panel__actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.sandbox-params {
  margin-top: 14px;
  font-size: 12px;
  line-height: 1.8;
}

.result-card {
  border-color: rgba(33, 212, 180, 0.35);
  background: linear-gradient(140deg, rgba(33, 212, 180, 0.08), transparent);
}

.result-card.is-failed {
  border-color: rgba(255, 107, 157, 0.35);
  background: linear-gradient(140deg, rgba(255, 107, 157, 0.08), transparent);
}

.result-card__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
}

.result-card__list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 2;
  color: var(--text-secondary);
}

.result-card__actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.checkout-side {
  display: flex;
  flex-direction: column;
  gap: 14px;
  position: sticky;
  top: calc(var(--header-h) + 16px);
}

.flow {
  margin: 12px 0 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 2.1;
  color: var(--text-muted);
}

.flow li.is-done {
  color: var(--success);
}

.safety {
  margin: 12px 0 0;
  padding-left: 16px;
  font-size: 12px;
  line-height: 1.9;
  color: var(--text-muted);
}

.safety .mono {
  color: var(--text-secondary);
}

@media (max-width: 1000px) {
  .checkout-layout {
    grid-template-columns: 1fr;
  }
  .checkout-side {
    position: static;
  }
}
</style>
