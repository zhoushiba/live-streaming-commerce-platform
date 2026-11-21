import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { authApi } from '@/api';
import { tokenStore } from '@/api/http';
import type { UserProfile } from '@/api/types';

/**
 * 登录态：token 落 localStorage，用户信息每次刷新页面拉一次 /auth/profile。
 * 这样即使改了昵称/余额，重新进入页面也是最新的。
 */
export const useAuthStore = defineStore('auth', () => {
  const user = ref<UserProfile | null>(null);
  const loading = ref(false);

  const isLogin = computed(() => Boolean(user.value));
  const isAdmin = computed(() => user.value?.role === 'admin');
  const isAnchor = computed(() => user.value?.role === 'anchor' || user.value?.role === 'admin');
  const balance = computed(() => user.value?.balance ?? 0);

  function applyToken(pair: { accessToken: string; refreshToken: string; user?: UserProfile }) {
    tokenStore.set(pair.accessToken, pair.refreshToken);
    if (pair.user) user.value = pair.user;
  }

  async function login(username: string, password: string) {
    loading.value = true;
    try {
      const pair = await authApi.login({ username, password });
      applyToken(pair);
      user.value = pair.user;
      return pair;
    } finally {
      loading.value = false;
    }
  }

  async function register(payload: { username: string; password: string; nickname?: string; role?: 'viewer' | 'anchor' }) {
    loading.value = true;
    try {
      const pair = await authApi.register(payload);
      applyToken(pair);
      user.value = pair.user;
      return pair;
    } finally {
      loading.value = false;
    }
  }

  async function fetchProfile() {
    if (!tokenStore.access) return null;
    try {
      user.value = await authApi.profile();
      return user.value;
    } catch {
      clear();
      return null;
    }
  }

  async function logout() {
    try {
      if (tokenStore.access) await authApi.logout(tokenStore.refresh || undefined);
    } catch {
      /* 网络失败也要清本地态 */
    } finally {
      clear();
    }
  }

  function clear() {
    tokenStore.clear();
    user.value = null;
  }

  return { user, loading, isLogin, isAdmin, isAnchor, balance, login, register, fetchProfile, logout, clear, applyToken };
});
