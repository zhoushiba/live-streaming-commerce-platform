import http, { unwrap } from './http';
import type {
  AdminStats,
  BalanceTransaction,
  CreatedPayment,
  DanmakuItem,
  EntitlementView,
  EpisodePlayResult,
  GiftItem,
  LeaderboardItem,
  NotifyOutcome,
  OrderView,
  PageResult,
  PaymentProviderCode,
  PlayInfo,
  ProviderInfo,
  RoomCard,
  RoomCategory,
  RoomDetail,
  SendGiftResult,
  TokenPair,
  UserProfile,
  VideoDetail,
  VideoListItem,
  WalletInfo,
} from './types';

/* ------------------------------------------------------------------ 认证 */
export const authApi = {
  register: (payload: { username: string; password: string; nickname?: string; role?: 'viewer' | 'anchor' }) =>
    unwrap<TokenPair>(http.post('/auth/register', payload)),
  login: (payload: { username: string; password: string }) => unwrap<TokenPair>(http.post('/auth/login', payload)),
  refresh: (refreshToken: string) => unwrap<TokenPair>(http.post('/auth/refresh', { refreshToken })),
  logout: (refreshToken?: string) => unwrap<{ ok: boolean }>(http.post('/auth/logout', { refreshToken })),
  profile: () => unwrap<UserProfile>(http.get('/auth/profile')),
  updateProfile: (payload: { nickname?: string; avatar?: string }) => unwrap<UserProfile>(http.patch('/auth/profile', payload)),
};

/* ------------------------------------------------------------------ 直播间 */
export interface RoomListQuery {
  page?: number;
  pageSize?: number;
  categoryId?: number;
  status?: string;
  keyword?: string;
  sort?: 'hot' | 'new' | 'price_asc' | 'price_desc';
}

export const roomApi = {
  categories: () => unwrap<RoomCategory[]>(http.get('/rooms/categories')),
  list: (params: RoomListQuery = {}) => unwrap<PageResult<RoomCard>>(http.get('/rooms', { params })),
  mine: () => unwrap<PageResult<RoomCard>>(http.get('/rooms/mine') as never),
  detail: (id: number) => unwrap<RoomDetail>(http.get(`/rooms/${id}`)),
  create: (payload: { title: string; categoryId?: number; coverUrl?: string; priceType: string; price: number }) =>
    unwrap<RoomDetail>(http.post('/rooms', payload)),
  update: (id: number, payload: Record<string, unknown>) => unwrap<RoomDetail>(http.patch(`/rooms/${id}`, payload)),
  startLive: (id: number) => unwrap<{ status: string }>(http.post(`/rooms/${id}/live/start`)),
  endLive: (id: number) => unwrap<{ status: string }>(http.post(`/rooms/${id}/live/end`)),
  like: (id: number) => unwrap<{ likes: number }>(http.post(`/rooms/${id}/like`)),
  enter: (id: number) => unwrap<{ viewers: number }>(http.post(`/rooms/${id}/enter`)),
  history: (id: number, limit = 30) => unwrap<DanmakuItem[]>(http.get(`/rooms/${id}/danmaku`, { params: { limit } })),
};

/* ------------------------------------------------------------------ 推拉流 */
export const streamApi = {
  playInfo: (roomId: number, quality?: string) =>
    unwrap<PlayInfo>(http.get(`/streams/${roomId}/play-info`, { params: quality ? { quality } : {} })),
  pushInfo: (roomId: number) => unwrap<Record<string, unknown>>(http.get(`/streams/${roomId}/push-info`)),
  stats: (roomId: number) => unwrap<Record<string, unknown>>(http.get(`/streams/${roomId}/stats`)),
  health: (roomId: number) => unwrap<{ healthy: boolean; mode: string }>(http.get(`/streams/${roomId}/health`)),
};

/* ------------------------------------------------------------------ 礼物 */
export const giftApi = {
  list: () => unwrap<GiftItem[]>(http.get('/gifts')),
  leaderboard: (roomId: number, limit = 10) => unwrap<LeaderboardItem[]>(http.get(`/gifts/leaderboard/${roomId}`, { params: { limit } })),
  send: (payload: { roomId: number; giftId: number; count: number; requestId: string }) =>
    unwrap<SendGiftResult>(http.post('/gifts/send', payload)),
  mine: (page = 1, pageSize = 10) => unwrap<PageResult<Record<string, unknown>>>(http.get('/gifts/mine', { params: { page, pageSize } })),
};

/* ------------------------------------------------------------------ 订单 */
export const orderApi = {
  create: (payload: { bizType: 'room' | 'video' | 'recharge'; targetId?: number; amount?: number; idempotencyKey: string }) =>
    unwrap<OrderView>(http.post('/orders', payload)),
  list: (params: { page?: number; pageSize?: number; status?: string } = {}) =>
    unwrap<PageResult<OrderView>>(http.get('/orders', { params })),
  detail: (orderNo: string) => unwrap<OrderView>(http.get(`/orders/${orderNo}`)),
  cancel: (orderNo: string) => unwrap<OrderView>(http.post(`/orders/${orderNo}/cancel`)),
};

/* ------------------------------------------------------------------ 支付 */
export const paymentApi = {
  providers: () => unwrap<ProviderInfo[]>(http.get('/payments/providers')),
  create: (payload: { orderNo: string; provider: PaymentProviderCode; openId?: string }) =>
    unwrap<CreatedPayment>(http.post('/payments/create', payload)),
  query: (outTradeNo: string) => unwrap<Record<string, unknown>>(http.get(`/payments/${outTradeNo}`)),
  refund: (orderNo: string, reason: string) => unwrap<Record<string, unknown>>(http.post(`/payments/refund/${orderNo}`, { reason })),
  /** Mock 回调：把后端下发的报文原样 POST 回去（演示用，真实场景由渠道服务器调用） */
  mockNotify: (body: Record<string, unknown>) => unwrap<NotifyOutcome>(http.post('/payments/mock/notify', body)),
};

/* ------------------------------------------------------------------ 钱包 & 权益 */
export const walletApi = {
  me: () => unwrap<WalletInfo>(http.get('/wallet/me')),
  transactions: (page = 1, pageSize = 10) =>
    unwrap<PageResult<BalanceTransaction>>(http.get('/wallet/transactions', { params: { page, pageSize } })),
};

export const entitlementApi = {
  mine: () => unwrap<EntitlementView[]>(http.get('/entitlements/mine')),
  videos: () => unwrap<Record<string, unknown>[]>(http.get('/entitlements/videos')),
};

/* ------------------------------------------------------------------ 点播 */
export const videoApi = {
  list: (params: { page?: number; pageSize?: number; keyword?: string; categoryId?: number } = {}) =>
    unwrap<PageResult<VideoListItem>>(http.get('/videos', { params })),
  detail: (id: number) => unwrap<VideoDetail>(http.get(`/videos/${id}`)),
  play: (videoId: number, episodeId: number) =>
    unwrap<EpisodePlayResult>(http.post(`/videos/${videoId}/episodes/${episodeId}/play`)),
};

/* ------------------------------------------------------------------ 管理后台 */
export const adminApi = {
  stats: () => unwrap<AdminStats>(http.get('/admin/stats')),
  users: (page = 1, pageSize = 10, keyword?: string) =>
    unwrap<PageResult<Record<string, unknown>>>(http.get('/admin/users', { params: { page, pageSize, keyword } })),
  setUserStatus: (id: number, status: 'active' | 'disabled') =>
    unwrap<Record<string, unknown>>(http.patch(`/admin/users/${id}/status`, { status })),
  orders: (page = 1, pageSize = 10, status?: string) =>
    unwrap<PageResult<Record<string, unknown>>>(http.get('/admin/orders', { params: { page, pageSize, status } })),
  rooms: (page = 1, pageSize = 10, status?: string) =>
    unwrap<PageResult<Record<string, unknown>>>(http.get('/admin/rooms', { params: { page, pageSize, status } })),
  closeRoom: (id: number) => unwrap<Record<string, unknown>>(http.post(`/admin/rooms/${id}/close`)),
  hideDanmaku: (id: number) => unwrap<Record<string, unknown>>(http.post(`/admin/danmaku/${id}/hide`)),
  reconciliation: (payload: { billDate?: string; provider?: string }) =>
    unwrap<Record<string, unknown>>(http.post('/admin/reconciliation', payload)),
};
