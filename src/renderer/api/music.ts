import { musicDB } from '@/hooks/MusicHook';
import { resolveSong } from '@/services/musicSource/resolver';
import { useSettingsStore, useUserStore } from '@/store';
import type { ILyric } from '@/types/lyric';
import type { SongResult } from '@/types/music';
import request from '@/utils/request';
import { normalizeBitrate, pickPlayableDetail, QUALITY_LADDER } from '@/utils/vipBorrow';

type MusicParseResult = {
  data: {
    code: number;
    message: string;
    data?: { url: string; type?: string; br?: number; [key: string]: any };
  };
};

// musicDB 通过顶层 await 初始化，单 chunk 打包下模块作用域直接解构会命中
// TDZ（Cannot access 'musicDB' before initialization），改为惰性访问。
const saveData = (...args: any[]) => (musicDB as any).saveData(...args);
const getData = (...args: any[]) => (musicDB as any).getData(...args);

// 将 FM 歌曲移至垃圾桶（不喜欢）
export const fmTrash = (id: number) => {
  return request.post('/fm_trash', null, {
    params: { id, timestamp: Date.now() }
  });
};

// 获取音乐音质详情
export const getMusicQualityDetail = (id: number) => {
  return request.get('/song/music/detail', { params: { id } });
};

export type GetMusicUrlOptions = {
  /** 显式指定的 cookie（VIP 借用），缺省沿用主账号登录态 */
  cookie?: string;
  /** 覆写音质档位，缺省用设置里的 musicQuality */
  quality?: string;
};

/** lossless 走 aac 容器、其余走 flac，沿用原有映射 */
const resolveEncodeType = (quality?: string) => (quality === 'lossless' ? 'aac' : 'flac');

// 根据音乐Id获取音乐播放URl
export const getMusicUrl = async (
  id: number,
  isDownloaded: boolean = false,
  options: GetMusicUrlOptions = {}
) => {
  const userStore = useUserStore();
  const settingStore = useSettingsStore();
  const quality = options.quality || settingStore.setData.musicQuality || 'higher';
  const explicitCookie = options.cookie?.trim();
  // 借用令牌过期时接口可能返回 301，带 noLogin 可避免拦截器把主账号登出
  const baseParams = {
    level: quality,
    encodeType: resolveEncodeType(quality),
    ...(explicitCookie ? { noLogin: true } : {})
  };

  // 下载走 VIP 下载口：主账号本身是会员，或显式借用 VIP 令牌
  const canUseDownloadEndpoint =
    isDownloaded &&
    (explicitCookie ? true : Boolean(userStore.user && userStore.user.vipType !== 0));
  try {
    if (canUseDownloadEndpoint) {
      const mainCookie = localStorage.getItem('token') || '';
      const cookie = explicitCookie ? `${explicitCookie} os=pc;` : `${mainCookie} os=pc;`;
      const res = await request.get('/song/download/url/v1', {
        params: { id, ...baseParams, cookie }
      });

      if (res.data?.data?.url) {
        return { data: { data: [{ ...res.data.data }] } };
      }
    }
  } catch (error) {
    console.error('error', error);
  }

  return await request.get('/song/url/v1', {
    params: {
      id,
      ...baseParams,
      ...(explicitCookie ? { cookie: explicitCookie } : {})
    }
  });
};

export type VipLadderResult = { detail: any | null; authFailed: boolean };

const isAuthFailureCode = (value: unknown) => [301, 401, 403].includes(Number(value));

const isAuthFailureError = (error: any) =>
  isAuthFailureCode(error?.response?.status) ||
  isAuthFailureCode(error?.response?.data?.code) ||
  isAuthFailureCode(error?.response?.data?.data?.code);

/**
 * 借用 VIP 令牌取址：从设定档位开始逐级向下试，取到哪档算哪档。
 * 等价于"自己就是该等级会员"，避免凭空猜会员可用音质。
 */
export const getMusicUrlByVipBorrow = async (
  id: number,
  cookie: string,
  startQuality: string,
  isDownloaded: boolean = false
): Promise<VipLadderResult> => {
  const startIndex = Math.max(0, (QUALITY_LADDER as readonly string[]).indexOf(startQuality));

  for (let index = startIndex; index < QUALITY_LADDER.length; index += 1) {
    const level = QUALITY_LADDER[index];
    try {
      const res = await getMusicUrl(id, isDownloaded, { cookie, quality: level });
      const detail = pickPlayableDetail(res);
      if (detail) {
        return { detail: { ...detail, br: normalizeBitrate(detail.br) }, authFailed: false };
      }

      const code = res?.data?.code ?? res?.data?.data?.code;
      if (isAuthFailureCode(code)) return { detail: null, authFailed: true };
    } catch (error) {
      if (isAuthFailureError(error)) return { detail: null, authFailed: true };
      // 单档失败不阻断后续降档
    }
  }

  return { detail: null, authFailed: false };
};

// 获取歌曲详情
export const getMusicDetail = (ids: Array<number>) => {
  return request.get('/song/detail', { params: { ids: ids.join(',') } });
};

// 根据音乐Id获取音乐歌词
export const getMusicLrc = async (id: number): Promise<{ data: ILyric }> => {
  const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000; // 10天的毫秒数

  try {
    // 尝试获取缓存的歌词
    const cachedLyric = await getData('music_lyric', id);
    if (cachedLyric?.createTime && Date.now() - cachedLyric.createTime < TEN_DAYS_MS) {
      return { ...cachedLyric, data: cachedLyric.data };
    }

    // 获取新的歌词数据
    const res = await request.get<ILyric>('/lyric/new', { params: { id } });

    if (res?.data) {
      try {
        // 歌词面板和预加载可能并发请求同一首歌，使用 put 避免重复主键。
        await saveData('music_lyric', { id, data: res.data, createTime: Date.now() });
      } catch (error) {
        console.warn('保存歌词缓存失败:', error);
      }
    }

    return res;
  } catch (error) {
    console.error('获取歌词失败:', error);
    throw error; // 向上抛出错误，让调用者处理
  }
};

/**
 * 获取解析后的音乐URL（兼容薄包装：内部走统一解析器）
 * @param id 歌曲ID
 * @param data 歌曲数据
 * @returns 解析结果（旧 MusicParseResult 形状）
 */
export const getParsingMusicUrl = async (
  _id: number,
  data: SongResult
): Promise<MusicParseResult> => {
  const result = await resolveSong(data);
  if (!result) {
    return { data: { code: 404, message: '所有解析方式都失败了', data: undefined } };
  }
  return {
    data: {
      code: 200,
      message: 'success',
      data: {
        url: result.media.url,
        type: result.media.format,
        br: result.media.br,
        pluginName: result.providerName
      }
    }
  };
};

// 收藏歌曲
export const likeSong = (id: number, like: boolean = true) => {
  return request.get('/like', { params: { id, like } });
};

// 将每日推荐中的歌曲标记为不感兴趣，并获取一首新歌
export const dislikeRecommendedSong = (id: number | string) => {
  return request.get('/recommend/songs/dislike', {
    params: { id }
  });
};
// 获取用户喜欢的音乐列表
export const getLikedList = (uid: number) => {
  return request.get('/likelist', {
    params: { uid, noLogin: true }
  });
};

// 创建歌单
export const createPlaylist = (params: { name: string; privacy: number }) => {
  return request.post('/playlist/create', params);
};

// 添加或删除歌单歌曲
export const updatePlaylistTracks = (params: {
  op: 'add' | 'del';
  pid: number;
  tracks: string;
}) => {
  return request.post('/playlist/tracks', params);
};

/**
 * 根据类型获取列表数据
 * @param type 列表类型 album/playlist
 * @param id 列表ID
 */
export function getMusicListByType(type: string, id: string) {
  if (type === 'album') {
    return getAlbumDetail(id);
  } else if (type === 'playlist') {
    return getPlaylistDetail(id);
  }
  return Promise.reject(new Error('未知列表类型'));
}

/**
 * 获取专辑详情
 * @param id 专辑ID
 */
export function getAlbumDetail(id: string) {
  return request({
    url: '/album',
    method: 'get',
    params: {
      id
    }
  });
}

/**
 * 获取歌单详情
 * @param id 歌单ID
 */
export function getPlaylistDetail(id: string) {
  return request({
    url: '/playlist/detail',
    method: 'get',
    params: {
      id
    }
  });
}

export function subscribePlaylist(params: { t: number; id: number }) {
  return request({
    url: '/playlist/subscribe',
    method: 'post',
    params
  });
}

/**
 * 收藏/取消收藏专辑
 * @param params t: 1 收藏, 2 取消收藏; id: 专辑id
 */
export function subscribeAlbum(params: { t: number; id: number }) {
  return request({
    url: '/album/sub',
    method: 'post',
    params
  });
}

/**
 * 获取历史日推可用日期列表
 */
export function getHistoryRecommendDates() {
  return request({
    url: '/history/recommend/songs',
    method: 'get'
  });
}

/**
 * 获取历史日推详情数据
 * @param date 日期，格式：YYYY-MM-DD
 */
export function getHistoryRecommendSongs(date: string) {
  return request({
    url: '/history/recommend/songs/detail',
    method: 'get',
    params: { date }
  });
}

/**
 * 心动模式/智能播放
 * @param params id: 歌曲id, pid: 歌单id, sid: 要开始播放的歌曲id(可选)
 */
export function getIntelligenceList(params: { id: number; pid: number; sid?: number }) {
  return request({
    url: '/playmode/intelligence/list',
    method: 'get',
    params
  });
}
