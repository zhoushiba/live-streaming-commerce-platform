<template>
  <div class="page auth-page">
    <div class="auth-card">
      <header class="auth-head">
        <h1>登录星播 Live</h1>
        <p class="text-muted">直播播放 · 付费解锁 · 微信/支付宝支付链路演示</p>
      </header>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" size="large" placeholder="4-20 位字母、数字或下划线" autocomplete="username">
            <template #prefix><el-icon><User /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            size="large"
            type="password"
            show-password
            placeholder="8-32 位，需包含字母与数字"
            autocomplete="current-password"
            @keyup.enter="submit"
          >
            <template #prefix><el-icon><Lock /></el-icon></template>
          </el-input>
        </el-form-item>

        <el-button class="auth-submit" type="primary" size="large" round :loading="loading" @click="submit">
          登录
        </el-button>
      </el-form>

      <div class="auth-quick">
        <span class="text-muted">演示账号一键填充：</span>
        <el-button v-for="a in demoAccounts" :key="a.username" size="small" round @click="fill(a.username, a.password)">
          {{ a.label }}
        </el-button>
      </div>

      <footer class="auth-foot">
        <span class="text-muted">还没有账号？</span>
        <RouterLink to="/register">免费注册</RouterLink>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { Lock, User } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const formRef = ref<FormInstance>();
const loading = ref(false);

const form = reactive({ username: 'viewer', password: 'Viewer@123456' });

const rules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 4, max: 20, message: '用户名长度为 4-20 位', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 8, max: 32, message: '密码长度为 8-32 位', trigger: 'blur' },
  ],
};

const demoAccounts = [
  { label: '观众 viewer', username: 'viewer', password: 'Viewer@123456' },
  { label: '主播 anchor', username: 'anchor', password: 'Anchor@123456' },
  { label: '运营 admin', username: 'admin', password: 'Admin@123456' },
];

function fill(username: string, password: string) {
  form.username = username;
  form.password = password;
}

async function submit() {
  if (!formRef.value) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;
  loading.value = true;
  try {
    await auth.login(form.username, form.password);
    ElMessage.success('登录成功');
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    router.replace(redirect);
  } catch {
    /* 错误提示由 axios 拦截器统一弹出 */
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.auth-page {
  display: grid;
  place-items: center;
  min-height: calc(100vh - var(--header-h) - 120px);
}

.auth-card {
  width: 100%;
  max-width: 420px;
  padding: 32px;
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  border: 1px solid var(--border-soft);
  box-shadow: var(--shadow-card);
}

.auth-head {
  margin-bottom: 22px;
}

.auth-head h1 {
  font-size: 24px;
  margin-bottom: 6px;
}

.auth-head p {
  font-size: 13px;
}

.auth-submit {
  width: 100%;
  margin-top: 4px;
}

.auth-quick {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px dashed var(--border-soft);
  font-size: 12px;
}

.auth-foot {
  margin-top: 18px;
  text-align: center;
  font-size: 13px;
}

.auth-foot a {
  color: var(--brand);
  margin-left: 6px;
}
</style>
