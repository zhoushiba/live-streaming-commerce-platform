import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
import { tokenStore } from '@/api/http';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/HomeView.vue'),
    meta: { title: '发现直播' },
  },
  {
    path: '/room/:id',
    name: 'room',
    component: () => import('@/views/RoomView.vue'),
    meta: { title: '直播间' },
  },
  {
    path: '/videos',
    name: 'videos',
    component: () => import('@/views/VideoListView.vue'),
    meta: { title: '点播专区' },
  },
  {
    path: '/videos/:id',
    name: 'video-detail',
    component: () => import('@/views/VideoDetailView.vue'),
    meta: { title: '点播详情' },
  },
  {
    path: '/orders',
    name: 'orders',
    component: () => import('@/views/OrdersView.vue'),
    meta: { title: '我的订单', requiresAuth: true },
  },
  {
    path: '/checkout/:orderNo',
    name: 'checkout',
    component: () => import('@/views/CheckoutView.vue'),
    meta: { title: '收银台', requiresAuth: true },
  },
  {
    path: '/pay/mock',
    name: 'mock-pay',
    component: () => import('@/views/MockPayView.vue'),
    meta: { title: '模拟支付' },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { title: '登录', guestOnly: true },
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/views/RegisterView.vue'),
    meta: { title: '注册', guestOnly: true },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('@/views/ProfileView.vue'),
    meta: { title: '个人中心', requiresAuth: true },
  },
  {
    path: '/studio',
    name: 'studio',
    component: () => import('@/views/StudioView.vue'),
    meta: { title: '主播后台', requiresAuth: true },
  },
  {
    path: '/admin',
    name: 'admin',
    component: () => import('@/views/AdminView.vue'),
    meta: { title: '运营后台', requiresAuth: true, requiresAdmin: true },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { title: '页面不存在' },
  },
];

/**
 * 使用 hash 路由：静态托管（含 headless 截图 / 直接双击 dist/index.html）时
 * 不需要服务端 rewrite 回退，`/#/room/1` 这类地址刷新也不会 404。
 */
const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

/**
 * 只做「有没有 token」的粗粒度拦截，角色校验交给后端（避免前端 token 被改就当管理员）。
 * 真正的管理员校验在 AdminView 里等 /auth/profile 回来后再判断。
 */
router.beforeEach((to) => {
  const hasToken = Boolean(tokenStore.access);
  if (to.meta.requiresAuth && !hasToken) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (to.meta.guestOnly && hasToken) {
    return { name: 'home' };
  }
  document.title = `${(to.meta.title as string) ?? '直播间'} · 星播 Live`;
  return true;
});

export default router;
