/**
 * VIP 音源借用
 *
 * 主账号只负责登录、歌单、每日推荐；另存一份朋友的 VIP 令牌，仅在
 * 「主账号取不到播放地址」或「需要升码率」时临时用于请求 /song/url。
 *
 * 安全约束：
 *  - 令牌只写 localStorage，绝不进入 settings 的 setData —— 后者会被
 *    electron-store 明文落盘到 %APPDATA%/AlgerMusicPlayer/config.json。
 *  - 所有借用请求都带 noLogin=1，令牌过期时不会被 request 拦截器判成
 *    主账号 301 而触发登出。
 */
import { ref } from 'vue';

export type VipBorrowConfig = {
  /** 总开关 */
  enabled: boolean;
  /** VIP 账号令牌（MUSIC_U 为主） */
  cookie: string;
  nickname: string;
  userId: number | null;
  /** 0 非会员 / 10 音乐包 / 11 黑胶VIP / 110 黑胶SVIP */
  vipType: number;
  /** 上次校验是否通过，false 时不再发起借用请求 */
  verified: boolean;
  /** 普通歌曲码率不足时是否也借用升级 */
  useForNormalTracks: boolean;
  updatedAt: number;
};

const STORAGE_KEY = 'vipBorrow';

const DEFAULT_CONFIG: VipBorrowConfig = {
  enabled: false,
  cookie: '',
  nickname: '',
  userId: null,
  vipType: 0,
  verified: false,
  useForNormalTracks: false,
  updatedAt: 0
};

/** 音质档位：从高到低，对应 /song/url/v1 的 level 取值 */
export const QUALITY_LADDER = [
  'jymaster',
  'dolby',
  'sky',
  'jyeffect',
  'hires',
  'lossless',
  'exhigh',
  'higher',
  'standard'
] as const;

/** 各档位标称码率（bps），用于判断主账号返回的码率是否够 */
export const QUALITY_BITRATE: Record<string, number> = {
  jymaster: 1999000,
  dolby: 1999000,
  sky: 1999000,
  jyeffect: 1999000,
  hires: 1999000,
  lossless: 999000,
  exhigh: 320000,
  higher: 192000,
  standard: 128000
};

/** 会员等级对应的 i18n 键后缀（settings.playback.vipBorrow.level*） */
export const vipLevelKey = (vipType: number): string => {
  if (vipType >= 110) return 'level110';
  if (vipType === 11) return 'level11';
  if (vipType === 10) return 'level10';
  return 'level0';
};

const normalizeConfig = (raw: unknown): VipBorrowConfig => {
  const source = raw && typeof raw === 'object' ? (raw as Partial<VipBorrowConfig>) : {};
  return {
    ...DEFAULT_CONFIG,
    ...source,
    nickname: typeof source.nickname === 'string' ? source.nickname : '',
    cookie: typeof source.cookie === 'string' ? source.cookie : '',
    vipType: Number(source.vipType) || 0,
    userId: source.userId === null || source.userId === undefined ? null : Number(source.userId)
  };
};

const readConfig = (): VipBorrowConfig => {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_CONFIG };
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeConfig(JSON.parse(raw)) : { ...DEFAULT_CONFIG };
  } catch (error) {
    console.warn('[vipBorrow] 读取配置失败:', error);
    return { ...DEFAULT_CONFIG };
  }
};

/** 响应式配置：设置页直接读它，播放链路读函数取值 */
export const vipBorrowConfig = ref<VipBorrowConfig>(readConfig());

export const saveVipBorrow = (patch: Partial<VipBorrowConfig>): VipBorrowConfig => {
  const next = normalizeConfig({ ...vipBorrowConfig.value, ...patch, updatedAt: Date.now() });
  vipBorrowConfig.value = next;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  } catch (error) {
    console.warn('[vipBorrow] 保存配置失败:', error);
  }
  return next;
};

export const clearVipBorrow = () => saveVipBorrow({ ...DEFAULT_CONFIG, updatedAt: Date.now() });

/**
 * 令牌归一化：粘贴整段 cookie 时只保留鉴权相关字段，
 * 纯 MUSIC_U 值时自动补上键名。
 */
export const normalizeVipCookie = (raw: string): string => {
  const text = String(raw || '')
    .replace(/[\r\n\t]/g, ' ')
    .trim();
  if (!text) return '';

  if (!text.includes('=')) return `MUSIC_U=${text}`;

  const kept = text
    .split(';')
    .map((item) => item.trim())
    .filter((item) => /^(MUSIC_U|__csrf|NMTID|os)=/i.test(item));

  return kept.length ? kept.join('; ') : text;
};

export const isVipBorrowEnabled = (): boolean => vipBorrowConfig.value.enabled;

/** 只有启用 + 有令牌 + 上次校验未被判定失效时才参与取址 */
export const isVipBorrowReady = (): boolean => {
  const config = vipBorrowConfig.value;
  return Boolean(config.enabled && config.cookie && config.verified !== false);
};

export const getVipCookie = (): string => vipBorrowConfig.value.cookie;

export const shouldUpgradeNormalTracks = (): boolean =>
  isVipBorrowReady() && vipBorrowConfig.value.useForNormalTracks;

export const qualityToBitrate = (quality?: string): number =>
  QUALITY_BITRATE[String(quality || '')] || 0;

/**
 * 接口返回的 br 单位不稳定（部分版本给 kbps，部分给 bps），统一成 bps。
 */
export const normalizeBitrate = (br?: number | string): number => {
  const value = Number(br) || 0;
  if (!value) return 0;
  return value < 10000 ? value * 1000 : value;
};

/** 从 /song/url 响应里取可用播放地址；空地址与试听片段都算失败 */
export const pickPlayableDetail = (res: any): any | null => {
  const detail = res?.data?.data?.[0];
  if (!detail || !detail.url) return null;
  // freeTrialInfo 非空表示只有 30 秒试听片段
  if (detail.freeTrialInfo) return null;
  return detail;
};

/** /login/status 的响应结构在不同版本里多包一层，两种都兼容 */
export const parseLoginProfile = (res: any): any | null => {
  const payload = res?.data?.data ?? res?.data;
  const profile = payload?.profile ?? res?.data?.profile;
  return profile && profile.userId ? profile : null;
};
