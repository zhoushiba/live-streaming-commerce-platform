<template>
  <el-dialog
    :model-value="modelValue"
    :title="order ? '收银台' : '确认订单'"
    width="520px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
    @open="onOpen"
  >
    <div class="pay">
      <!-- 商品信息 -->
      <div class="pay__product">
        <div class="pay__thumb" :class="`is-${bizType}`">
          <el-icon :size="22"><VideoCamera v-if="bizType === 'room'" /><Film v-else-if="bizType === 'video'" /><Wallet v-else /></el-icon>
        </div>
        <div class="pay__meta">
          <p class="pay__title">{{ title }}</p>
          <span class="text-muted">{{ bizLabel }}</span>
        </div>
        <div class="pay__amount mono">
          <span class="pay__currency">¥</span>{{ (order?.amount ?? amount ?? 0).toFixed(2) }}
        </div>
      </div>

      <!-- 充值金额 -->
      <div v-if="bizType === 'recharge' && !order" class="pay__recharge">
        <span class="text-muted">充值金额</span>
        <el-input-number v-model="rechargeAmount" :min="1" :max="10000" :step="10" controls-position="right" />
        <div class="pay__quick">
          <el-button v-for="v in [10, 50, 100, 500]" :key="v" size="small" round @click="rechargeAmount = v">¥{{ v }}</el-button>
        </div>
      </div>

      <!-- 支付渠道 -->
      <div class="pay__section">
        <p class="pay__section-title">支付方式</p>
        <div class="pay__providers">
          <button
            v-for="p in providers"
            :key="p.code"
            class="provider"
            :class="{ 'is-active': provider === p.code, 'is-disabled': p.code !== 'mock' && !p.sandbox }"
            @click="pickProvider(p.code)"
          >
            <span class="provider__logo" :class="`is-${p.code}`">{{ providerShort(p.code) }}</span>
            <span class="provider__name">{{ p.displayName }}</span>
            <span v-if="p.code === 'mock'" class="provider__tag">推荐演示</span>
            <span v-else-if="p.sandbox" class="provider__tag is-muted">沙箱</span>
          </button>
        </div>
        <p class="pay__notice">
          <el-icon><InfoFilled /></el-icon>
          <span>{{ providerNotice }}</span>
        </p>
      </div>

      <!-- 支付流程时间线 -->
      <div v-if="steps.length" class="pay__steps">
        <div v-for="step in steps" :key="step.key" class="step" :class="`is-${step.status}`">
          <span class="step__dot">
            <el-icon v-if="step.status === 'done'"><Check /></el-icon>
            <el-icon v-else-if="step.status === 'failed'"><Close /></el-icon>
            <span v-else-if="step.status === 'active'" class="step__spin"></span>
            <span v-else class="step__index"></span>
          </span>
          <div class="step__body">
            <p class="step__label">{{ step.label }}</p>
            <p v-if="step.detail" class="step__detail mono">{{ step.detail }}</p>
          </div>
        </div>
      </div>

      <div v-if="result" class="pay__result" :class="{ 'is-fail': !result.success }">
        <el-icon :size="18"><CircleCheckFilled v-if="result.success" /><CircleCloseFilled v-else /></el-icon>
        <div>
          <p>{{ result.message }}</p>
          <p v-if="result.granted?.length" class="mono">已发放：{{ result.granted.join('、') }}</p>
          <p v-if="result.duplicate" class="mono">重复回调已被幂等拦截，未重复发货</p>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="pay__footer">
        <el-button text @click="emit('update:modelValue', false)">关闭</el-button>
        <el-button
          v-if="!result?.success"
          type="primary"
          round
          :loading="paying"
          :disabled="!order"
          @click="pay"
        >
          {{ provider === 'mock' ? '模拟支付（演示）' : '发起支付' }}
        </el-button>
        <el-button v-else type="primary" round @click="finish">完成</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { Check, CircleCheckFilled, CircleCloseFilled, Close, Film, InfoFilled, VideoCamera, Wallet } from '@element-plus/icons-vue';
import { orderApi, paymentApi } from '@/api';
import type { CreatedPayment, NotifyOutcome, OrderView, PaymentProviderCode, ProviderInfo } from '@/api/types';

const props = defineProps<{
  modelValue: boolean;
  bizType: 'room' | 'video' | 'recharge';
  targetId?: number;
  title: string;
  amount?: number;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void; (e: 'success', order: OrderView): void }>();

interface Step {
  key: string;
  label: string;
  status: 'pending' | 'active' | 'done' | 'failed';
  detail?: string;
}

const providers = ref<ProviderInfo[]>([
  { code: 'mock', displayName: 'Mock 支付', sandbox: true, notice: '本地 HMAC 验签，用于演示完整支付链路' },
]);
const provider = ref<PaymentProviderCode>('mock');
const order = ref<OrderView | null>(null);
const payment = ref<CreatedPayment | null>(null);
const result = ref<NotifyOutcome | null>(null);
const steps = ref<Step[]>([]);
const paying = ref(false);
const rechargeAmount = ref(50);
let pollTimer: number | null = null;

const bizLabel = computed(
  () => ({ room: '直播间订阅', video: '点播解锁', recharge: '钱包充值' })[props.bizType],
);

const providerNotice = computed(() => {
  const found = providers.value.find((p) => p.code === provider.value);
  if (!found) return '';
  if (found.code === 'mock') return 'Mock 渠道会在发起后立即生成一条带 HMAC 签名的回调报文，前端原样回传以验证「验签 → 幂等 → 发货」全链路。';
  return found.sandbox
    ? '当前为沙箱模式：不会真实扣款，RSA 密钥由本地自动生成。正式环境需在 .env 配置商户号、证书与私钥。'
    : '当前为生产模式，将真实调用渠道网关。';
});

function providerShort(code: string): string {
  return { mock: 'M', wechat: '微', alipay: '支' }[code] ?? code;
}

async function onOpen() {
  reset();
  try {
    providers.value = await paymentApi.providers();
  } catch {
    /* 保留默认 mock */
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) void prepareOrder();
  },
);

async function prepareOrder() {
  // 充值需要用户先确认金额，所以订单在点击支付时创建
  if (props.bizType === 'recharge') return;
  await createOrder();
}

async function createOrder(): Promise<OrderView | null> {
  try {
    const created = await orderApi.create({
      bizType: props.bizType,
      targetId: props.targetId,
      amount: props.bizType === 'recharge' ? rechargeAmount.value : undefined,
      idempotencyKey: `web-${props.bizType}-${props.targetId ?? 0}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    order.value = created;
    steps.value = [
      { key: 'order', label: '创建订单', status: 'done', detail: created.orderNo },
      { key: 'pay', label: '发起支付', status: 'pending' },
      { key: 'notify', label: '接收支付回调', status: 'pending' },
      { key: 'verify', label: '验签 + 幂等校验', status: 'pending' },
      { key: 'grant', label: '事务发放权益', status: 'pending' },
    ];
    return created;
  } catch {
    return null;
  }
}

function pickProvider(code: PaymentProviderCode) {
  provider.value = code;
}

async function pay() {
  if (paying.value) return;
  if (!order.value) {
    const created = await createOrder();
    if (!created) return;
  }
  const current = order.value;
  if (!current) return;

  paying.value = true;
  mark('pay', 'active');
  try {
    const created = await paymentApi.create({ orderNo: current.orderNo, provider: provider.value });
    payment.value = created;
    mark('pay', 'done', created.outTradeNo);

    if (provider.value === 'mock' && created.mockNotifyBody) {
      mark('notify', 'active');
      // 模拟渠道服务器回调：真实场景由微信/支付宝服务器 POST 到 notify_url
      const outcome = await paymentApi.mockNotify(created.mockNotifyBody as unknown as Record<string, unknown>);
      result.value = outcome;
      mark('notify', outcome.success ? 'done' : 'failed', 'HTTP 200');
      mark('verify', outcome.success ? 'done' : 'failed', outcome.duplicate ? '幂等命中' : '签名校验通过');
      mark('grant', outcome.success ? 'done' : 'failed', outcome.granted?.join('、') || '无新增权益');
      if (outcome.success) {
        mark('pay', 'done');
        await refreshOrder();
        paying.value = false;
        return;
      }
      paying.value = false;
      return;
    }

    // 微信/支付宝：跳转/扫码由渠道页面完成，这里轮询订单状态
    mark('notify', 'active');
    startPolling(current.orderNo);
  } catch {
    mark('pay', 'failed');
    paying.value = false;
  }
}

function mark(key: string, status: Step['status'], detail?: string) {
  const step = steps.value.find((s) => s.key === key);
  if (!step) return;
  step.status = status;
  if (detail) step.detail = detail;
}

function startPolling(orderNo: string) {
  stopPolling();
  let attempts = 0;
  pollTimer = window.setInterval(async () => {
    attempts += 1;
    try {
      const detail = await orderApi.detail(orderNo);
      if (detail.status === 'paid') {
        stopPolling();
        order.value = detail;
        mark('notify', 'done');
        mark('verify', 'done');
        mark('grant', 'done');
        mark('pay', 'done');
        result.value = {
          provider: provider.value,
          success: true,
          duplicate: false,
          outTradeNo: detail.outTradeNo ?? '',
          orderNo,
          message: '支付成功，权益已到账',
        };
        paying.value = false;
      }
    } catch {
      /* 忽略轮询错误 */
    }
    if (attempts > 60 && paying.value) {
      stopPolling();
      paying.value = false;
      ElMessage.warning('未检测到支付结果，请稍后在「我的订单」查看');
    }
  }, 2000);
}

async function refreshOrder() {
  if (!order.value) return;
  try {
    order.value = await orderApi.detail(order.value.orderNo);
  } catch {
    /* ignore */
  }
}

function finish() {
  if (order.value) emit('success', order.value);
  emit('update:modelValue', false);
}

function reset() {
  stopPolling();
  order.value = null;
  payment.value = null;
  result.value = null;
  steps.value = [];
  paying.value = false;
}

function stopPolling() {
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = null;
}

onBeforeUnmount(stopPolling);

defineExpose({ payment });
</script>

<style scoped>
.pay {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.pay__product {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border-soft);
}

.pay__thumb {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  color: #fff;
  flex-shrink: 0;
  background: var(--gradient-brand);
}

.pay__thumb.is-video {
  background: linear-gradient(135deg, #21d4b4, #5b8cff);
}

.pay__thumb.is-recharge {
  background: linear-gradient(135deg, #ffb547, #ff7a59);
}

.pay__meta {
  flex: 1;
  min-width: 0;
}

.pay__title {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pay__meta .text-muted {
  font-size: 12px;
}

.pay__amount {
  font-size: 22px;
  font-weight: 700;
  color: #ffd08a;
  white-space: nowrap;
}

.pay__currency {
  font-size: 14px;
  margin-right: 2px;
}

.pay__recharge {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.pay__quick {
  display: flex;
  gap: 6px;
}

.pay__section-title {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 10px;
}

.pay__providers {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.provider {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-soft);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.18s ease;
  flex: 1;
  min-width: 150px;
}

.provider:hover {
  border-color: rgba(91, 140, 255, 0.45);
}

.provider.is-active {
  border-color: rgba(91, 140, 255, 0.8);
  background: rgba(91, 140, 255, 0.12);
  color: var(--text-primary);
  box-shadow: var(--shadow-glow);
}

.provider__logo {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #5b8cff, #b06bff);
}

.provider__logo.is-wechat {
  background: linear-gradient(135deg, #2fd66f, #0fa958);
}

.provider__logo.is-alipay {
  background: linear-gradient(135deg, #1677ff, #4aa6ff);
}

.provider__name {
  font-size: 13px;
}

.provider__tag {
  position: absolute;
  top: -8px;
  right: 8px;
  padding: 0 6px;
  border-radius: 6px;
  font-size: 10px;
  background: var(--gradient-hot);
  color: #fff;
}

.provider__tag.is-muted {
  background: rgba(255, 255, 255, 0.16);
  color: var(--text-secondary);
}

.pay__notice {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}

.pay__steps {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: var(--radius-md);
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid var(--border-soft);
}

.step {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.step__dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  margin-top: 2px;
  font-size: 11px;
  border: 1px solid var(--border-strong);
  color: var(--text-muted);
}

.step.is-done .step__dot {
  background: rgba(47, 214, 166, 0.16);
  border-color: rgba(47, 214, 166, 0.6);
  color: var(--success);
}

.step.is-failed .step__dot {
  background: rgba(255, 92, 114, 0.16);
  border-color: rgba(255, 92, 114, 0.6);
  color: var(--danger);
}

.step.is-active .step__dot {
  border-color: var(--brand);
}

.step__spin {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 2px solid rgba(91, 140, 255, 0.3);
  border-top-color: var(--brand);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.step__label {
  font-size: 13px;
}

.step.is-pending .step__label {
  color: var(--text-muted);
}

.step__detail {
  font-size: 11px;
  color: var(--text-muted);
  word-break: break-all;
}

.pay__result {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: rgba(47, 214, 166, 0.1);
  border: 1px solid rgba(47, 214, 166, 0.3);
  color: #a8f0dc;
  font-size: 13px;
}

.pay__result.is-fail {
  background: rgba(255, 92, 114, 0.1);
  border-color: rgba(255, 92, 114, 0.3);
  color: #ffb3be;
}

.pay__result .mono {
  font-size: 11px;
  opacity: 0.85;
}

.pay__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
