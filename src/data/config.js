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
  aiDescribe: '/api/ai/describe',
  aiCaption: '/api/ai/caption',
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
  thumbMaxEdge: 480,
  thumbQuality: 0.78,
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
        desc: 'JPG · PNG · HEIC · Live 短片',
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
]

export const PROFILE_MENU = [
  {
    key: 'settings',
    icon: 'settings',
    title: '通用设置',
    sub: '字体大小、存储空间与通知权限',
  },
  { key: 'reminders', icon: 'bell', title: '提醒中心', sub: '喂养间隔与夜间安静' },
  { key: 'privacy', icon: 'shield', title: '隐私与安全', sub: '家庭成员可见 · 默认不公开' },
  { key: 'about', icon: 'leaf', title: '关于 Nestory', sub: '名字、信念，和这间小屋的由来' },
]

export const NOTIFICATION_LABELS = {
  default: { text: '尚未开启', hint: '当前只在应用内提示', action: '去开启' },
  granted: { text: '已开启', hint: '提醒会以系统通知送达', action: '' },
  denied: { text: '已拒绝', hint: '可在浏览器设置中重新允许', action: '' },
  unsupported: { text: '不可用', hint: '当前浏览器不支持系统通知', action: '' },
}


export const ONBOARDING = {
  skippable: true,
  welcome: {
    eyebrow: 'WELCOME',
    title: '欢迎来到 Nestory',
    body: '这里不会自动替你写好任何记录。先认识宝宝，再慢慢把小屋布置起来。',
    primary: '开始设置',
    skip: '跳过引导，直接使用',
  },
  steps: [
    {
      key: 'baby',
      eyebrow: 'STEP 01 / 03',
      title: '先认识一下宝宝',
      body: '名字和生日只用来计算月龄，其他资料可以以后再补。',
    },
    {
      key: 'photo',
      eyebrow: 'STEP 02 / 03',
      title: '放进第一张照片',
      body: '选一张现在的照片做首页。没有也没关系，随时可以在相册添加。',
    },
    {
      key: 'reminder',
      eyebrow: 'STEP 03 / 03',
      title: '要不要提醒你',
      body: '提醒只是辅助。宝宝想吃的时候，随时都可以喂。',
    },
  ],
  genders: [
    { value: 'girl', label: '女孩' },
    { value: 'boy', label: '男孩' },
    { value: '', label: '暂不填写' },
  ],
  intervals: [
    { value: 180, label: '每 3 小时' },
    { value: 240, label: '每 4 小时' },
    { value: 0, label: '先不提醒' },
  ],
  photoCaption: '来到家的第一天',
  finish: '进入 Nestory',
}
