<template>
  <div class="page auth-page">
    <div class="auth-card">
      <header class="auth-head">
        <h1>注册账号</h1>
        <p class="text-muted">注册即可观看直播、解锁点播，主播身份还能创建自己的直播间</p>
      </header>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" size="large" placeholder="4-20 位字母、数字或下划线" />
        </el-form-item>
        <el-form-item label="昵称" prop="nickname">
          <el-input v-model="form.nickname" size="large" placeholder="2-20 个字符，展示在弹幕与礼物榜" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" size="large" type="password" show-password placeholder="8-32 位，需包含字母与数字" />
        </el-form-item>
        <el-form-item label="确认密码" prop="confirm">
          <el-input v-model="form.confirm" size="large" type="password" show-password placeholder="再输入一次密码" />
        </el-form-item>
        <el-form-item label="账号身份">
          <el-radio-group v-model="form.role">
            <el-radio-button label="viewer">观众</el-radio-button>
            <el-radio-button label="anchor">主播</el-radio-button>
          </el-radio-group>
          <p class="role-hint text-muted">
            {{ form.role === 'anchor' ? '主播可创建直播间、获取推流地址、开播/下播' : '观众可观看直播、送礼物、购买点播内容' }}
          </p>
        </el-form-item>

        <el-button class="auth-submit" type="primary" size="large" round :loading="loading" @click="submit">
          注册并登录
        </el-button>
      </el-form>

      <footer class="auth-foot">
        <span class="text-muted">已有账号？</span>
        <RouterLink to="/login">直接登录</RouterLink>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();

const formRef = ref<FormInstance>();
const loading = ref(false);

const form = reactive({
  username: '',
  nickname: '',
  password: '',
  confirm: '',
  role: 'viewer' as 'viewer' | 'anchor',
});

const rules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { pattern: /^[a-zA-Z0-9_]{4,20}$/, message: '4-20 位字母、数字或下划线', trigger: 'blur' },
  ],
  nickname: [
    { required: true, message: '请输入昵称', trigger: 'blur' },
    { min: 2, max: 20, message: '昵称长度为 2-20 位', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { pattern: /^(?=.*[A-Za-z])(?=.*\d)[\S]{8,32}$/, message: '8-32 位且需同时包含字母与数字', trigger: 'blur' },
  ],
  confirm: [
    { required: true, message: '请再次输入密码', trigger: 'blur' },
    {
      validator: (_rule, value: string, callback: (error?: Error) => void) => {
        if (value !== form.password) callback(new Error('两次输入的密码不一致'));
        else callback();
      },
      trigger: 'blur',
    },
  ],
};

async function submit() {
  if (!formRef.value) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;
  loading.value = true;
  try {
    await auth.register({
      username: form.username,
      password: form.password,
      nickname: form.nickname,
      role: form.role,
    });
    ElMessage.success('注册成功，已自动登录');
    router.replace('/');
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
  padding-top: 32px;
  padding-bottom: 48px;
}

.auth-card {
  width: 100%;
  max-width: 460px;
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
  line-height: 1.6;
}

.auth-submit {
  width: 100%;
  margin-top: 4px;
}

.role-hint {
  margin-top: 6px;
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
