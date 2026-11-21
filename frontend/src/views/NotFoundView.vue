<template>
  <div class="page not-found">
    <p class="code">404</p>
    <h1>这个页面走丢了</h1>
    <p class="text-muted">链接可能已失效，或者直播间已经下线。</p>
    <div class="actions">
      <el-button type="primary" round @click="router.push('/')">回到发现页</el-button>
      <el-button round @click="router.back()">返回上一页</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<style scoped>
.not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: calc(100vh - var(--header-h) - 120px);
  text-align: center;
}

.code {
  font-family: var(--font-mono);
  font-size: 92px;
  line-height: 1;
  font-weight: 700;
  background: var(--gradient-brand);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

h1 {
  font-size: 22px;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}
</style>
