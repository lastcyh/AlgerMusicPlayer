<script lang="ts" setup>
import { useMessage } from 'naive-ui';
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { getLoginStatusWithCookie } from '@/api/login';
import {
  normalizeVipCookie,
  parseLoginProfile,
  saveVipBorrow,
  vipLevelKey
} from '@/utils/vipBorrow';

defineOptions({
  name: 'VipBorrowModal'
});

const props = defineProps<{ show: boolean }>();

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void;
  (e: 'saved'): void;
}>();

const { t } = useI18n();
const message = useMessage();

const cookieInput = ref('');
const isLoading = ref(false);

watch(
  () => props.show,
  (show) => {
    if (show) {
      cookieInput.value = '';
      isLoading.value = false;
    }
  }
);

const handleClose = () => emit('update:show', false);

const handlePaste = async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) cookieInput.value = text;
  } catch (error) {
    console.error('粘贴失败:', error);
  }
};

const handleSave = async () => {
  const cookie = normalizeVipCookie(cookieInput.value);
  if (!cookie) {
    message.error(t('settings.playback.vipBorrow.cookieRequired'));
    return;
  }
  if (!cookie.includes('MUSIC_U=')) {
    message.error(t('settings.playback.vipBorrow.invalidFormat'));
    return;
  }

  isLoading.value = true;
  try {
    // 校验走独立请求，不改动主账号登录态
    const res = await getLoginStatusWithCookie(cookie);
    const profile = parseLoginProfile(res);

    if (!profile) {
      message.error(t('settings.playback.vipBorrow.verifyFailed'));
      return;
    }

    const vipType = Number(profile.vipType) || 0;
    saveVipBorrow({
      cookie,
      nickname: profile.nickname || '',
      userId: profile.userId ?? null,
      vipType,
      verified: true,
      enabled: true
    });

    message.success(
      t('settings.playback.vipBorrow.verifySuccess', {
        name: profile.nickname || 'VIP',
        level: t(`settings.playback.vipBorrow.${vipLevelKey(vipType)}`)
      })
    );
    emit('saved');
    handleClose();
  } catch (error) {
    console.error('VIP 令牌校验失败:', error);
    message.error(t('settings.playback.vipBorrow.verifyFailed'));
  } finally {
    isLoading.value = false;
  }
};
</script>

<template>
  <n-modal :show="show" preset="dialog" @update:show="emit('update:show', $event)">
    <template #header>
      <div class="flex items-center gap-2">
        <i class="ri-vip-crown-line text-amber-500"></i>
        <span>{{ t('settings.playback.vipBorrow.modalTitle') }}</span>
      </div>
    </template>

    <div class="space-y-4">
      <div class="text-sm text-gray-600 dark:text-gray-400">
        {{ t('settings.playback.vipBorrow.modalDesc') }}
      </div>

      <div class="relative">
        <n-input
          v-model:value="cookieInput"
          type="textarea"
          :placeholder="t('settings.playback.vipBorrow.modalPlaceholder')"
          :autosize="{ minRows: 4, maxRows: 8 }"
          style="font-family: monospace; font-size: 12px"
        />
        <div class="absolute top-2 right-2 flex gap-1">
          <n-button size="tiny" quaternary @click="handlePaste">
            <i class="ri-clipboard-line"></i>
          </n-button>
          <n-button size="tiny" quaternary @click="cookieInput = ''">
            <i class="ri-delete-bin-line"></i>
          </n-button>
        </div>
      </div>

      <div class="text-xs text-gray-500 space-y-1">
        <p>• {{ t('settings.playback.vipBorrow.modalHelpScope') }}</p>
        <p>• {{ t('settings.playback.vipBorrow.modalHelpExpire') }}</p>
      </div>
    </div>

    <template #action>
      <div class="flex gap-2">
        <n-button @click="handleClose">{{ t('common.cancel') }}</n-button>
        <n-button
          type="primary"
          :loading="isLoading"
          :disabled="!cookieInput.trim()"
          @click="handleSave"
        >
          {{ t('settings.playback.vipBorrow.save') }}
        </n-button>
      </div>
    </template>
  </n-modal>
</template>
