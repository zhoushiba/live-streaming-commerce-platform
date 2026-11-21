<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="header-inner">
        <RouterLink to="/" class="brand">
          <span class="brand-mark">
            <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
              <defs>
                <linearGradient id="brandGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stop-color="#5b8cff" />
                  <stop offset="100%" stop-color="#b06bff" />
                </linearGradient>
              </defs>
              <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#brandGrad)" />
              <path d="M13 10.5 L23 16 L13 21.5 Z" fill="#fff" />
            </svg>
          </span>
          <span class="brand-text">
            <strong>星播 Live</strong>
            <em>直播 · 点播 · 付费内容</em>
          </span>
        </RouterLink>

        <nav class="nav">
          <RouterLink to="/" class="nav-link" active-class="is-active">发现直播</RouterLink>
          <RouterLink to="/videos" class="nav-link" active-class="is-active">点播专区</RouterLink>
          <RouterLink v-if="auth.isAdmin" to="/admin" class="nav-link" active-class="is-active">运营后台</RouterLink>
        </nav>

        <div class="header-right">
          <template v-if="auth.isLogin">
            <RouterLink to="/profile" class="wallet-chip" title="我的余额">
              <el-icon><Wallet /></el-icon>
              <span class="mono">¥{{ auth.balance.toFixed(2) }}</span>
            </RouterLink>
            <el-dropdown trigger="click" @command="onCommand">
              <span class="user-chip">
                <el-avatar :size="28" :src="auth.user?.avatar || undefined">
                  {{ auth.user?.nickname?.slice(0, 1) ?? 'U' }}
                </el-avatar>
                <span class="user-name">{{ auth.user?.nickname }}</span>
                <el-icon class="is-rotate"><ArrowDown /></el-icon>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="profile">个人中心</el-dropdown-item>
                  <el-dropdown-item command="orders">我的订单</el-dropdown-item>
                  <el-dropdown-item v-if="auth.isAnchor" command="studio">主播控制台</el-dropdown-item>
                  <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
          <template v-else>
            <RouterLink to="/login"><el-button text>登录</el-button></RouterLink>
            <RouterLink to="/register"><el-button type="primary" round>免费注册</el-button></RouterLink>
          </template>
        </div>
      </div>
    </header>

    <main class="app-main">
      <RouterView v-slot="{ Component }">
        <Transition name="fade" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>

    <footer class="app-footer">
      <div class="footer-inner">
        <span>星播 Live · 直播电商与付费内容演示项目</span>
        <span class="dot">·</span>
        <span>NestJS + Vue3 + hls.js/flv.js + 微信/支付宝支付对接</span>
        <span class="dot">·</span>
        <a href="/api/docs" target="_blank" rel="noreferrer">API 文档</a>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { ArrowDown, Wallet } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth';
import { tokenStore } from '@/api/http';

const auth = useAuthStore();
const router = useRouter();

onMounted(async () => {
  if (tokenStore.access && !auth.user) {
    await auth.fetchProfile();
  }
});

async function onCommand(command: string) {
  if (command === 'logout') {
    await auth.logout();
    ElMessage.success('已退出登录');
    router.push({ name: 'home' });
    return;
  }
  if (command === 'studio') {
    router.push({ name: 'studio' });
    return;
  }
  if (command === 'orders') {
    router.push({ name: 'orders' });
    return;
  }
  router.push({ name: 'profile' });
}
</script>

<style scoped>
.app-shell {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.app-header {
  position: sticky;
  top: 0;
  z-index: 100;
  backdrop-filter: blur(16px);
  background: rgba(11, 15, 26, 0.74);
  border-bottom: 1px solid var(--border-soft);
}

.header-inner {
  max-width: 1280px;
  margin: 0 auto;
  height: var(--header-h);
  padding: 0 24px;
  display: flex;
  align-items: center;
  gap: 28px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.brand-mark {
  display: grid;
  place-items: center;
  filter: drop-shadow(0 6px 14px rgba(91, 140, 255, 0.4));
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.brand-text strong {
  font-size: 16px;
  letter-spacing: 0.5px;
}

.brand-text em {
  font-style: normal;
  font-size: 11px;
  color: var(--text-muted);
}

.nav {
  display: flex;
  gap: 6px;
  flex: 1;
}

.nav-link {
  padding: 7px 14px;
  border-radius: 999px;
  color: var(--text-secondary);
  font-size: 14px;
  transition: all 0.18s ease;
}

.nav-link:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.05);
}

.nav-link.is-active {
  color: #fff;
  background: rgba(91, 140, 255, 0.16);
  box-shadow: inset 0 0 0 1px rgba(91, 140, 255, 0.35);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.wallet-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 13px;
  color: #ffd08a;
  background: rgba(255, 181, 71, 0.1);
  border: 1px solid rgba(255, 181, 71, 0.24);
}

.user-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 10px 4px 4px;
  border-radius: 999px;
  transition: background 0.18s ease;
}

.user-chip:hover {
  background: rgba(255, 255, 255, 0.06);
}

.user-name {
  font-size: 13px;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.is-rotate {
  transform: rotate(180deg);
  font-size: 12px;
  color: var(--text-muted);
}

.app-main {
  flex: 1;
}

.app-footer {
  border-top: 1px solid var(--border-soft);
  padding: 22px 24px 30px;
  color: var(--text-muted);
  font-size: 12px;
}

.footer-inner {
  max-width: 1280px;
  margin: 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.footer-inner a {
  color: var(--brand);
}

.dot {
  opacity: 0.4;
}
</style>
