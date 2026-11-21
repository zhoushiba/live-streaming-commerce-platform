<template>
  <div class="page mockpay-page">
    <div class="mockpay-card card card-pad">
      <header class="mockpay-head">
        <span class="mockpay-logo">M</span>
        <div>
          <h1>Mock 沙箱收银台</h1>
          <p class="text-muted">演示用收银台：H5 收银台形态 + 渠道回调报文可视化，不产生真实扣款</p>
        </div>
      </header>

      <el-alert
        type="warning"
        :closable="false"
        show-icon
        title="当前为沙箱环境，仅用于演示支付链路"
        description="真实接入微信/支付宝时，这里会替换成渠道返回的二维码或跳转链接；商户号、证书、回调域名等配置见 docs/payment.md。"
      />

      <div v-if="body" class="mockpay-body">
        <div class="mockpay-row">
          <span class="text-muted">支付单号</span>
          <span class="mono">{{ outTradeNo }}</span>
        </div>
        <div class="mockpay-row">
          <span class="text-muted">应付金额</span>
          <span class="price mono mockpay-amount">¥{{ Number(body.amount).toFixed(2) }}</span>
        </div>
        <div class="mockpay-row">
          <span class="text-muted">回调状态</span>
          <span class="tag tag-paid">{{ body.status }}</span>
        </div>

        <div class="mockpay-qr" aria-hidden="true">
          <canvas ref="qrRef" width="168" height="168" />
          <span class="text-muted">示意二维码（沙箱不生成真实支付码）</span>
        </div>

        <details class="mockpay-json">
          <summary>查看回调报文（含 HMAC-SHA256 签名）</summary>
          <pre>{{ JSON.stringify(body, null, 2) }}</pre>
        </details>

        <el-button
          type="success"
          size="large"
          round
          class="mockpay-pay"
          :loading="paying"
          :disabled="Boolean(result)"
          @click="confirmPay"
        >
          {{ result ? '已完成支付' : `确认支付 ¥${Number(body.amount).toFixed(2)}` }}
        </el-button>
        <p class="text-muted mockpay-tip">
          点击后前端把报文原样 POST 到 <span class="mono">/api/payments/mock/notify</span>，
          后端会做「验签 → 金额校验 → 流水 CAS 幂等 → 事务发放权益」。
        </p>
      </div>

      <div v-else class="empty-state">
        <p>没有找到支付单 {{ outTradeNo ? `（${outTradeNo}）` : '' }}</p>
        <p class="text-muted">请从「我的订单 → 去支付」发起支付后，再打开模拟收银台</p>
        <el-button round type="primary" style="margin-top: 12px" @click="router.push('/orders')">去我的订单</el-button>
      </div>

      <div v-if="result" class="mockpay-result" :class="result.success ? 'is-success' : 'is-failed'">
        <p class="mockpay-result__title">
          <el-icon><CircleCheckFilled v-if="result.success" /><CircleCloseFilled v-else /></el-icon>
          {{ result.success ? '支付成功' : '支付失败' }}
        </p>
        <ul>
          <li>订单号：<span class="mono">{{ result.orderNo }}</span></li>
          <li>幂等结果：{{ result.duplicate ? '重复回调（未重复发货）' : '首次回调（已发货）' }}</li>
          <li v-if="result.granted?.length">发货内容：{{ result.granted.join(' / ') }}</li>
          <li>渠道消息：{{ result.message }}</li>
        </ul>
        <div class="mockpay-result__actions">
          <el-button type="primary" round @click="router.push('/orders')">查看订单</el-button>
          <el-button round @click="router.push('/')">返回首页</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { CircleCheckFilled, CircleCloseFilled } from '@element-plus/icons-vue';
import { paymentApi } from '@/api';
import type { MockNotifyBody, NotifyOutcome } from '@/api/types';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const outTradeNo = computed(() => (typeof route.query.outTradeNo === 'string' ? route.query.outTradeNo : ''));
const body = ref<MockNotifyBody | null>(null);
const result = ref<NotifyOutcome | null>(null);
const paying = ref(false);
const qrRef = ref<HTMLCanvasElement | null>(null);

function readBody(): MockNotifyBody | null {
  const key = `lc_mock_pay:${outTradeNo.value}`;
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MockNotifyBody;
  } catch {
    return null;
  }
}

/** 用 canvas 画一个伪二维码占位，避免引入额外依赖，也不假装能真的被扫码 */
function drawQr() {
  const canvas = qrRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const size = 21;
  const cell = canvas.width / size;
  ctx.fillStyle = '#0b0f1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const seed = outTradeNo.value.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const isFinder =
        (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);
      const finderOn =
        isFinder &&
        (x % 6 === 0 || y % 6 === 0 || (x > 1 && x < 5 && y > 1 && y < 5) ||
          (x > size - 6 && x < size - 2 && y > 1 && y < 5) ||
          (x > 1 && x < 5 && y > size - 6 && y < size - 2));
      const on = isFinder ? finderOn : (x * 31 + y * 17 + seed) % 3 === 0;
      if (on) {
        ctx.fillStyle = '#e8f0ff';
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }
}

async function confirmPay() {
  if (!body.value) return;
  paying.value = true;
  try {
    result.value = await paymentApi.mockNotify(body.value as unknown as Record<string, unknown>);
    if (result.value.success) {
      await auth.fetchProfile().catch(() => null);
      ElMessage.success('支付成功');
    }
  } catch {
    /* 验签失败等错误由拦截器提示 */
  } finally {
    paying.value = false;
  }
}

onMounted(async () => {
  body.value = readBody();
  if (body.value) {
    // canvas 在 v-if 内，需要等 DOM 渲染完成后再绘制
    await nextTick();
    drawQr();
  }
});
</script>

<style scoped>
.mockpay-page {
  display: grid;
  place-items: start center;
  padding-top: 32px;
}

.mockpay-card {
  width: 100%;
  max-width: 620px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.mockpay-head {
  display: flex;
  align-items: center;
  gap: 14px;
}

.mockpay-logo {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--gradient-brand);
  font-size: 20px;
  font-weight: 700;
}

.mockpay-head h1 {
  font-size: 20px;
  margin-bottom: 4px;
}

.mockpay-head p {
  font-size: 12px;
  line-height: 1.6;
}

.mockpay-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mockpay-row {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  font-size: 13px;
}

.mockpay-amount {
  font-size: 22px;
}

.mockpay-qr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
}

.mockpay-qr canvas {
  border-radius: 12px;
  border: 1px solid var(--border-strong);
}

.mockpay-qr span {
  font-size: 11px;
}

.mockpay-json {
  font-size: 12px;
  color: var(--text-secondary);
}

.mockpay-json summary {
  cursor: pointer;
  color: var(--brand);
  margin-bottom: 8px;
}

.mockpay-json pre {
  margin: 0;
  padding: 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--border-soft);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  color: #b8f0d8;
}

.mockpay-pay {
  width: 100%;
  margin-top: 4px;
}

.mockpay-tip {
  font-size: 11px;
  line-height: 1.7;
}

.mockpay-result {
  border-radius: var(--radius-sm);
  padding: 16px;
  border: 1px solid rgba(33, 212, 180, 0.35);
  background: rgba(33, 212, 180, 0.07);
}

.mockpay-result.is-failed {
  border-color: rgba(255, 107, 157, 0.35);
  background: rgba(255, 107, 157, 0.07);
}

.mockpay-result__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 10px;
}

.mockpay-result ul {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 2;
  color: var(--text-secondary);
}

.mockpay-result__actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}
</style>
