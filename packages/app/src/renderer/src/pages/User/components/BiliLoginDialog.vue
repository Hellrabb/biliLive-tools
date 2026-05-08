<!-- 登录弹框 -->
<template>
  <n-modal v-model:show="showModal" :mask-closable="false" auto-focus>
    <n-card
      style="width: calc(100% - 60px)"
      :bordered="false"
      size="huge"
      role="dialog"
      aria-modal="true"
      class="card"
    >
      <div style="text-align: center">
        <h2>{{ text }}</h2>
        <h2>使用b站app扫码完成登录<br /></h2>
        <n-qr-code v-if="url" :value="url" color="#409eff" background-color="#F5F5F5" :size="250" />
      </div>
      <template #footer>
        <div class="footer">
          <n-button class="btn" @click="close">取消</n-button>
          <n-button type="primary" class="btn" @click="confirm"> 确认 </n-button>
        </div>
      </template>
    </n-card>
  </n-modal>
</template>

<script setup lang="ts">
import { biliApi } from "@renderer/apis";

const showModal = defineModel<boolean>({ required: true, default: false });
const emits = defineEmits<{
  close: [];
  confirm: [];
}>();

const notice = useNotification();

const url = ref("");
const id = ref("");
const text = ref("");
const interval = ref<number | null>(null);

const clearLoginInterval = () => {
  if (interval.value !== null) {
    clearInterval(interval.value);
    interval.value = null;
  }
};
const onOpen = async () => {
  text.value = "";
  try {
    const res = await biliApi.qrcode();
    url.value = res.url;
    id.value = res.id;
  } catch (e: any) {
    const msg = e?.message || e?.toString() || "未知错误";
    text.value = `获取二维码失败：${msg}`;
    notice.error({
      title: "获取二维码失败",
      description: msg,
      duration: 5000,
    });
    return;
  }

  // @ts-ignore
  interval.value = setInterval(async () => {
    try {
      const res = await biliApi.loginPoll(id.value);
      console.log(res);
      if (res.status === "completed") {
        clearLoginInterval();
        text.value = "登录成功，请关闭本窗口";
        notice.success({
          title: "登录成功",
          duration: 1000,
        });
        confirm();
      } else if (res.status === "error") {
        clearLoginInterval();
        notice.error({
          title: "登录失败",
          description: res.failReason,
        });
        text.value = res.failReason;
      }
    } catch (e: any) {
      clearLoginInterval();
      const msg = e?.message || e?.toString() || "未知错误";
      text.value = `轮询失败：${msg}`;
      notice.error({
        title: "登录轮询失败",
        description: msg,
        duration: 5000,
      });
    }
  }, 2000);
};

const close = () => {
  showModal.value = false;
};

const confirm = () => {
  emits("confirm");
  showModal.value = false;
};

watch(
  () => showModal.value,
  () => {
    if (showModal.value) {
      onOpen();
    } else {
      clearLoginInterval();
      biliApi.loginCancel(id.value);
      emits("close");
    }
  },
);
</script>

<style scoped lang="less">
.footer {
  text-align: right;
  .btn + .btn {
    margin-left: 10px;
  }
}
</style>
