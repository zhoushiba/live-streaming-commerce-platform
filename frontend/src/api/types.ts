/** 与后端 src/modules/** 的返回结构一一对应；改后端时要同步这里 */

export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
  requestId: string;
  timestamp: string;
}

export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type UserRole = 'viewer' | 'anchor' | 'admin';
export type RoomStatus = 'idle' | 'living' | 'ended';
export type PriceType = 'free' | 'monthly' | 'yearly';

export interface UserProfile {
  id: number;
  username: string;
  nickname: string;
  role: UserRole;
  avatar: string | null;
  status: 'active' | 'disabled';
  balance: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
  user: UserProfile;
}

export interface RoomCategory {
  id: number;
  name: string;
  icon?: string;
  sort?: number;
}

export interface RoomCard {
  id: number;
  title: string;
  coverUrl: string | null;
  status: RoomStatus;
  priceType: PriceType;
  price: number;
  viewers: number;
  likes: number;
  startedAt: string | null;
  anchor: { id: number; displayName: string; userId: number };
  category: { id: number; name: string } | null;
}

export interface RoomAccess {
  requiresPurchase: boolean;
  owned: boolean;
  canWatch: boolean;
  isOwner: boolean;
}

export interface RoomDetail extends RoomCard {
  streamKey?: string;
  anchor: { id: number; displayName: string; userId: number; introduce?: string | null; followers?: number };
  access: RoomAccess;
}

export interface PlaySource {
  id: string;
  protocol: 'hls' | 'flv';
  quality: string;
  url: string;
  isDefault: boolean;
}

export interface PlayInfo {
  roomId: number;
  status: RoomStatus;
  mode: 'live' | 'demo' | 'offline';
  sources: PlaySource[];
  fallbackOrder: string[];
  retry: { max: number; baseDelay: number; maxDelay: number };
  token: string;
  expiresAt: string;
  locked: boolean;
  lockReason: string | null;
  price: { priceType: PriceType; amount: number } | null;
  poster: string | null;
  notice: string;
}

export interface DanmakuItem {
  id: number;
  roomId: number;
  userId: number | null;
  nickname: string;
  content: string;
  color: string;
  sentAt: number;
  createdAt?: string;
}

export interface GiftItem {
  id: number;
  name: string;
  icon: string;
  price: number;
  effect: 'none' | 'float' | 'rocket' | 'fullscreen' | string;
}

export type OrderBizType = 'room' | 'video' | 'recharge';
export type OrderStatus = 'pending' | 'paid' | 'closed' | 'refunded';

export interface OrderView {
  id: number;
  orderNo: string;
  bizType: OrderBizType;
  targetId: number | null;
  amount: number;
  status: OrderStatus;
  title: string;
  expireAt: string | null;
  paidAt: string | null;
  closedAt: string | null;
  createdAt: string;
  idempotent?: boolean;
  payProvider?: string | null;
  payStatus?: string | null;
  outTradeNo?: string | null;
}

export type PaymentProviderCode = 'mock' | 'wechat' | 'alipay';

export interface ProviderInfo {
  code: PaymentProviderCode;
  displayName: string;
  sandbox: boolean;
  notice: string;
}

export interface MockNotifyBody {
  outTradeNo: string;
  amount: string;
  status: 'success' | 'failed';
  timestamp: number;
  nonce: string;
  providerTradeNo: string;
  signature: string;
}

export interface CreatedPayment {
  provider: PaymentProviderCode;
  outTradeNo: string;
  amount: number;
  payParams: Record<string, string>;
  orderNo: string;
  orderAmount: number;
  expireAt: string;
  mockNotifyBody?: MockNotifyBody;
  sandboxNotice?: string;
  raw?: unknown;
}

export interface NotifyOutcome {
  provider: string;
  success: boolean;
  duplicate: boolean;
  outTradeNo: string;
  orderNo: string;
  amount?: number;
  granted?: string[];
  message: string;
}

export interface WalletInfo {
  userId: number;
  balance: number;
  totalRecharge: number;
  totalConsume: number;
  updatedAt?: string;
}

export interface BalanceTransaction {
  id: number;
  bizType: 'recharge' | 'consume' | 'refund';
  amount: number;
  balanceAfter: number;
  bizNo: string;
  remark: string | null;
  createdAt: string;
}

export interface EntitlementView {
  id: number;
  targetType: 'room' | 'video';
  targetId: number;
  source: string;
  startAt: string;
  expireAt: string | null;
  status: string;
  /** 后端 listMine 会给出是否仍在有效期内的计算字段 */
  active: boolean;
  title?: string | null;
}

export interface VideoListItem {
  id: number;
  title: string;
  coverUrl: string | null;
  description: string | null;
  price: number;
  free: boolean;
  categoryId: number | null;
  playCount: number;
  episodeCount: number;
  createdAt: string;
}

export interface VideoEpisode {
  id: number;
  episodeNo: number;
  title: string;
  duration: number;
  free: boolean;
  locked: boolean;
  price: number;
  playUrl: string | null;
}

export interface VideoDetail {
  id: number;
  title: string;
  coverUrl: string | null;
  description: string | null;
  price: number;
  free: boolean;
  playCount: number;
  episodes: VideoEpisode[];
  ownedAll: boolean;
}

export interface EpisodePlayResult {
  locked: boolean;
  reason?: string;
  price?: number;
  purchaseHint?: string;
  videoId?: number;
  episodeId?: number;
  title?: string;
  playUrl?: string;
  protocol?: 'hls' | 'flv';
}

export interface SendGiftResult {
  recordId?: number;
  giftName: string;
  count: number;
  amount: number;
  balance: number;
  idempotent: boolean;
}

export interface LeaderboardItem {
  userId: number;
  nickname: string;
  totalAmount: number;
  giftCount: number;
}

export interface AdminStats {
  users: { total: number; today: number };
  rooms: { total: number; living: number };
  orders: { total: number; today: number; paidToday: number; revenueToday: number };
  revenue: { orderToday: number; giftToday: number };
  danmakuToday: number;
  paymentChannels: Array<{ provider: string; count: number }>;
  generatedAt: string;
}

/** 运营后台用户列表行（后端为宽表，这里只声明页面用到的字段） */
export interface AdminUserRow {
  id: number;
  username: string;
  nickname: string;
  role: string;
  status: string;
  balance: number;
  createdAt: string;
  lastLoginAt?: string | null;
}

/** 运营后台订单列表行 */
export interface AdminOrderRow {
  orderNo: string;
  username?: string;
  bizType: string;
  amount: number;
  status: string;
  title?: string;
  createdAt: string;
  paidAt?: string | null;
}

/** 运营后台直播间列表行 */
export interface AdminRoomRow {
  id: number;
  title: string;
  anchorName?: string;
  status: string;
  priceType: string;
  price: number;
  viewers: number;
  createdAt: string;
}

/** 对账结果（POST /admin/reconciliation） */
export interface ReconciliationResult {
  billDate: string;
  provider: string;
  localCount: number;
  channelCount: number;
  totalLocal: number;
  totalChannel: number;
  diffCount: number;
  diffs: Array<Record<string, unknown>>;
}
