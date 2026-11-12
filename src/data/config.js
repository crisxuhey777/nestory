/**
 * Nestory · 产品配置数据
 *
 * 这里只放「数据」：导航、业务枚举、文案标签、默认值、限制与展示配置。
 * 组件与业务逻辑放在 src/pages / src/lib / src/data/store.tsx 中。
 *
 * 修改本文件即可调整产品结构，不需要动页面逻辑。
 */

export const APP = {
  name: 'Nestory',
  version: '3.0',
  year: 2026,
  tagline: 'A little nest. A lifetime of stories.',
  taglineZh: '为每一个家庭，珍藏成长的每一天。',
}

export const API = {
  state: '/api/state',
  dailyQuote: '/api/daily-quote',
  aiSummary: '/api/ai/summary',
  aiAnalysis: '/api/ai/analysis',
  aiStory: '/api/ai/story',
}

export const STORAGE_KEYS = {
  state: 'nestory.state.v4',
  prefs: 'nestory.prefs.v1',
  mediaDb: 'nestory.media',
}

export const NAV_TABS = [
  { route: 'home', label: '首页', icon: 'home' },
  { route: 'growth', label: '成长', icon: 'growth' },
  { route: 'album', label: '相册', icon: 'album' },
  { route: 'profile', label: '我的', icon: 'profile' },
]

export const QUICK_ACTIONS = [
  { key: 'feed', label: '喂奶', icon: 'feed', target: 'feed' },
  { key: 'sleep', label: '睡眠', icon: 'sleep', target: 'sleep' },
  { key: 'diaper', label: '尿布', icon: 'diaper', target: 'diaper' },
  { key: 'growth', label: '成长数据', icon: 'growth', target: 'growth' },
]

export const HERO = {
  maxPhotos: 4,
  intervalMs: 6000,
  pauseMs: 10000,
  quote: '不着急，我们有一整个童年，慢慢来。',
  brandTag: 'Family Stories',
}

export const HOME = {
  recentPhotos: 4,
  milestones: 3,
}

export const FEED_METHODS = [
  { key: 'breast', label: '母乳亲喂', icon: 'timer' },
  { key: 'bottle', label: '瓶喂母乳', icon: 'feed' },
  { key: 'formula', label: '配方奶', icon: 'formula' },
]

export const FEED_PRESETS = [60, 90, 120, 150]

export const FEED_DEFAULTS = {
  bottleMl: 120,
  formulaMl: 90,
}

export const REMINDER_INTERVALS = [120, 150, 180, 210, 240]

export const FONT_OPTIONS = [
  { key: 'small', label: '小', scale: 0.94, sample: 12 },
  { key: 'normal', label: '标准', scale: 1, sample: 13.5 },
  { key: 'large', label: '大', scale: 1.08, sample: 15 },
  { key: 'xlarge', label: '特大', scale: 1.16, sample: 16.5 },
]

export const PERMISSIONS = [
  {
    key: 'admin',
    short: '家庭管理员',
    label: '可管理成员与全部记录',
    desc: '可管理成员、权限与全部记录',
  },
  { key: 'edit', short: '可记录与编辑', label: '可记录与编辑', desc: '可添加与修改记录、照片' },
  { key: 'read', short: '只读', label: '仅可查看', desc: '仅可查看，不必担心误改' },
]

export const MEDIA_LIMITS = {
  videoMaxMB: 120,
  photoMaxEdge: 1200,
  photoQuality: 0.82,
  posterMaxEdge: 1200,
  posterQuality: 0.8,
}

export const MEDIA_GROUPS = [
  {
    key: 'photo',
    label: 'PHOTO · 照片',
    options: [
      {
        key: 'photo-library',
        trigger: 'photoLibrary',
        icon: 'album',
        tone: 'default',
        title: '从相册选择照片',
        desc: 'JPG · PNG · HEIC',
        mode: 'photo',
      },
      {
        key: 'photo-camera',
        trigger: 'photoCamera',
        icon: 'camera',
        tone: 'default',
        title: '拍一张照片',
        desc: '直接打开相机',
        mode: 'photo',
      },
    ],
  },
  {
    key: 'video',
    label: 'VIDEO · 视频',
    options: [
      {
        key: 'video-library',
        trigger: 'videoLibrary',
        icon: 'video',
        tone: 'default',
        title: '从相册选择视频',
        desc: 'MP4 · MOV',
        limit: 'videoMaxMB',
        mode: 'video',
      },
      {
        key: 'video-camera',
        trigger: 'videoCamera',
        icon: 'play',
        tone: 'default',
        title: '录制视频',
        desc: '用相机记录一小段',
        mode: 'video',
      },
    ],
  },
  {
    key: 'live',
    label: 'LIVE · 会动的照片',
    options: [
      {
        key: 'live-library',
        trigger: 'liveLibrary',
        icon: 'live',
        tone: 'live',
        title: '导入 Live 照片',
        desc: '选择 Live Photo 导出的短片',
        mode: 'live',
      },
      {
        key: 'live-camera',
        trigger: 'liveCamera',
        icon: 'live',
        tone: 'live',
        title: '拍一段 Live',
        desc: '录 3 秒，成为会动的照片',
        mode: 'live',
      },
    ],
  },
]

export const PROFILE_MENU = [
  {
    key: 'settings',
    icon: 'settings',
    title: '通用设置',
    sub: '字体大小、存储空间与通知权限',
  },
  { key: 'reminders', icon: 'bell', title: '提醒中心', sub: '喂养间隔与夜间安静' },
  { key: 'share', icon: 'family', title: '家庭共享', sub: '共同记录 · 权限可设置为只读' },
  { key: 'backup', icon: 'sync', title: '数据与备份', sub: '本机记录与手动同步' },
  { key: 'privacy', icon: 'shield', title: '隐私与安全', sub: '家庭成员可见 · 默认不公开' },
  { key: 'about', icon: 'leaf', title: '关于 Nestory', sub: '名字、信念，和这间小屋的由来' },
]

export const NOTIFICATION_LABELS = {
  default: { text: '尚未开启', hint: '当前只在应用内提示', action: '去开启' },
  granted: { text: '已开启', hint: '提醒会以系统通知送达', action: '' },
  denied: { text: '已拒绝', hint: '可在浏览器设置中重新允许', action: '' },
  unsupported: { text: '不可用', hint: '当前浏览器不支持系统通知', action: '' },
}
