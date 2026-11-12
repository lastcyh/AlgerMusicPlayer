<script lang="ts" setup>
import { useMessage } from 'naive-ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { getLoginStatusWithCookie } from '@/api/login';
import VipBorrowModal from '@/components/settings/VipBorrowModal.vue';
import {
  clearVipBorrow,
  parseLoginProfile,
  saveVipBorrow,
  vipBorrowConfig,
  vipLevelKey
} from '@/utils/vipBorrow';
import SBtn from '@/views/set/SBtn.vue';
import SettingItem from '@/views/set/SettingItem.vue';

defineOptions({
  name: 'VipBorrowSettings'
});

const { t } = useI18n();
const message = useMessage();

const config = computed(() => vipBorrowConfig.value);
const showModal = ref(false);
const verifying = ref(false);

const levelLabel = computed(() =>
  t(`settings.playback.vipBorrow.${vipLevelKey(config.value.vipType)}`)
);

const bindLabel = computed(() =>
  config.value.cookie
    ? t('settings.playback.vipBorrow.rebind')
    : t('settings.playback.vipBorrow.bind')
);

const statusText = computed(() => {
  const current = config.value;
  if (!current.cookie) return t('settings.playback.vipBorrow.statusUnset');
  if (current.verified === false) return t('settings.playback.vipBorrow.statusInvalid');
  if (!current.enabled) return t('settings.playback.vipBorrow.statusOff');
  return t('settings.playback.vipBorrow.statusConnected', {
    name: current.nickname || 'VIP',
    level: levelLabel.value
  });
});

const statusClass = computed(() => {
  const current = config.value;
  if (!current.cookie) return 'text-gray-500';
  if (current.verified === false) return 'text-red-500';
  if (!current.enabled) return 'text-amber-500';
  return 'text-emerald-500';
});

const handleToggle = (value: boolean) => {
  saveVipBorrow({ enabled: value });
};

const handleVerify = async () => {
  if (!config.value.cookie) return;
  verifying.value = true;
  try {
    const res = await getLoginStatusWithCookie(config.value.cookie);
    const profile = parseLoginProfile(res);
    if (!profile) {
      saveVipBorrow({ verified: false });
      message.error(t('settings.playback.vipBorrow.verifyFailed'));
      return;
    }
    const vipType = Number(profile.vipType) || 0;
    saveVipBorrow({
      nickname: profile.nickname || '',
      userId: profile.userId ?? null,
      vipType,
      verified: true
    });
    message.success(
      t('settings.playback.vipBorrow.verifySuccess', {
        name: profile.nickname || 'VIP',
        level: t(`settings.playback.vipBorrow.${vipLevelKey(vipType)}`)
      })
    );
  } catch (error) {
    console.error('VIP 令牌校验失败:', error);
    saveVipBorrow({ verified: false });
    message.error(t('settings.playback.vipBorrow.verifyFailed'));
  } finally {
    verifying.value = false;
  }
};

const handleClear = () => {
  clearVipBorrow();
  message.success(t('settings.playback.vipBorrow.cleared'));
};

const handleUpgradeToggle = (value: boolean) => {
  saveVipBorrow({ useForNormalTracks: value });
};
</script>

<template>
  <setting-item :title="t('settings.playback.vipBorrow.enableTitle')">
    <template #description>
      <div class="space-y-1">
        <div>{{ t('settings.playback.vipBorrow.enableDesc') }}</div>
        <div class="text-xs" :class="statusClass">{{ statusText }}</div>
      </div>
    </template>
    <template #action>
      <div class="flex items-center gap-2 max-md:w-full max-md:flex-wrap max-md:justify-end">
        <SBtn :variant="config.cookie ? 'default' : 'primary'" @click="showModal = true">
          {{ bindLabel }}
        </SBtn>
        <SBtn v-if="config.cookie" :loading="verifying" @click="handleVerify">
          {{ t('settings.playback.vipBorrow.verify') }}
        </SBtn>
        <SBtn v-if="config.cookie" variant="danger" @click="handleClear">
          {{ t('settings.playback.vipBorrow.clear') }}
        </SBtn>
        <n-switch :value="config.enabled" :disabled="!config.cookie" @update:value="handleToggle" />
      </div>
    </template>
  </setting-item>

  <setting-item
    v-if="config.cookie && config.enabled"
    :title="t('settings.playback.vipBorrow.upgrade')"
    :description="t('settings.playback.vipBorrow.upgradeDesc')"
  >
    <n-switch :value="config.useForNormalTracks" @update:value="handleUpgradeToggle" />
  </setting-item>

  <vip-borrow-modal v-model:show="showModal" />
</template>
