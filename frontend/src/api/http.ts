import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { ElMessage } from 'element-plus';
import type { ApiEnvelope } from './types';

const ACCESS_KEY = 'lc_access_token';
const REFRESH_KEY = 'lc_refresh_token';

export const tokenStore = {
  get access(): string {
    return localStorage.getItem(ACCESS_KEY) ?? '';
  },
  get refresh(): string {
    return localStorage.getItem(REFRESH_KEY) ?? '';
  },
  set(access: string, refresh: string): void {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export interface HttpError extends Error {
  code?: number;
  status?: number;
  details?: unknown;
}

const http: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStore.access;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * 401 自动刷新：Access Token 只有 15 分钟，这里用「单飞 + 队列」避免并发刷新
 * 把同一个 refresh token 用两次（后端 refresh 是轮换式的，第二次会 1005）。
 */
let refreshing: Promise<string> | null = null;
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

async function doRefresh(): Promise<string> {
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) throw new Error('no refresh token');
  const { data } = await axios.post<ApiEnvelope<{ accessToken: string; refreshToken: string }>>(
    '/api/auth/refresh',
    { refreshToken },
  );
  tokenStore.set(data.data.accessToken, data.data.refreshToken);
  return data.data.accessToken;
}

http.interceptors.response.use(
  (res) => {
    // 回调类接口（微信/支付宝）是纯文本，这里只处理 JSON 信封
    const payload = res.data as ApiEnvelope<unknown> | string;
    if (typeof payload === 'string') return res;
    if (payload && typeof payload === 'object' && 'code' in payload && payload.code !== 0) {
      const err: HttpError = new Error(payload.message || '请求失败');
      err.code = payload.code;
      throw err;
    }
    return res;
  },
  async (error: AxiosError<ApiEnvelope<unknown>>) => {
    const status = error.response?.status;
    const payload = error.response?.data;
    const code = payload && typeof payload === 'object' ? payload.code : undefined;
    const config = error.config as (InternalAxiosRequestConfig & { __retried?: boolean }) | undefined;

    // access token 过期 → 刷新后重放一次
    if (status === 401 && config && !config.__retried && code !== 1005 && code !== 1002) {
      config.__retried = true;
      try {
        refreshing = refreshing ?? doRefresh().finally(() => (refreshing = null));
        const token = await refreshing;
        config.headers.Authorization = `Bearer ${token}`;
        return http.request(config);
      } catch {
        tokenStore.clear();
        onUnauthorized?.();
        ElMessage.error('登录已过期，请重新登录');
        return Promise.reject(error);
      }
    }

    const message =
      (payload && typeof payload === 'object' && payload.message) ||
      error.message ||
      `请求失败（HTTP ${status ?? '网络错误'}）`;
    // 回调查询等轮询场景不希望刷屏，交由调用方 silent 处理
    if (!(config as { silent?: boolean } | undefined)?.silent) {
      ElMessage.error(message);
    }
    const err: HttpError = new Error(message);
    err.code = code;
    err.status = status;
    err.details = payload && typeof payload === 'object' ? payload.data : undefined;
    return Promise.reject(err);
  },
);

/** 统一解包 `{code,message,data}`，组件里只拿业务数据 */
export async function unwrap<T>(promise: Promise<{ data: ApiEnvelope<T> }>): Promise<T> {
  const res = await promise;
  return res.data.data;
}

export default http;
