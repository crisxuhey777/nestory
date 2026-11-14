# Nestory 上线教程：一台小 VPS，一年 300 块以内

> 面向场景：**5 人以内的小家庭**，主要放宝宝照片/视频、成长记录，家人分散在不同手机和电脑上。
> 目标：从「没有服务器」到「家人手机点开就能用」，**大约 30 分钟**，一年成本 100～400 元。

这份文档和 `deploy/README.md`（Ubuntu + Nginx + systemd 手工版）是两条路：

| | 本文（容器版，推荐） | `deploy/README.md`（手工版） |
|---|---|---|
| 需要装的东西 | 只要 Docker | Python、MySQL、Nginx 各装一遍 |
| 升级 | `git pull` + 一条 compose 命令 | 传包、装依赖、重启、reload nginx |
| HTTPS | Caddy 全自动 | 自己 certbot |
| 出问题排查 | 三个容器看日志 | 三个系统服务分别看 |

---

## 0. 先看结论

**推荐：一台 2C2G 的香港/新加坡轻量服务器 + 本目录的 Docker Compose。**
不用备案、国内访问 30～80ms、一年 ¥100～300。

### 方案对比（2025～2026 行情，价格看促销，仅供决策）

| 方案 | 一年费用 | 国内速度 | 要备案 | 上手难度 | 评价 |
|---|---|---|---|---|---|
| **香港/新加坡轻量 VPS 2C2G** | ¥99～360 | 快 | 否 | ★★ | **首选**，今天就能上线 |
| 国内轻量 VPS 2C2G | ¥99～199 | 最快 | 是（7～20 天） | ★★★ | 家里老人多、长期用值得 |
| 家里旧电脑/NAS + Cloudflare Tunnel | 0（域名 ¥10～60） | 看家宽上行 | 否 | ★★★ | 零月费，但要保证不断电不断网 |
| Oracle Cloud 永久免费 ARM | 0 | 一般（150ms+） | 否 | ★★★★ | 能折腾可用，有被回收的先例 |
| Railway / Render / Fly.io | ¥400～800 | 差 | 否 | ★ | 不推荐：MySQL 另收费，国内访问慢 |
| Sealos 等 K8s 平台 | 按量 | 中 | 否 | ★★ | 免费额度用完了，性价比不如 VPS |

> 结论：**家庭规模只有几个人，一台 2C2G 的小机器绰绰有余**（应用本体常驻内存约 60MB，MySQL 约 350MB），不需要对象存储、不需要负载均衡、不需要 K8s。

---

## 1. 准备清单

- [ ] 一台 **Ubuntu 22.04 / 24.04** 的 VPS，2 核 2G，20G 以上硬盘，**香港/新加坡/日本**地域
- [ ] 一个域名（`.top`/`.xyz` 首年 ¥10 左右；也可以用已有的二级域名）
- [ ] 智谱 API Key（免费档够用；本地 `backend/llm.env` 里那个可以直接复用）
- [ ] 30 分钟

> 为什么强调**不要选国内地域**：国内服务器绑定域名走 80/443 必须先备案，备案要域名实名 + 服务器购买满 3 个月 + 7～20 天审核。香港/新加坡不用备案，代价是延迟高一点点。

---

## 2. 第一步：买服务器

### 买什么

| 商家 | 型号 | 参考价 | 备注 |
|---|---|---|---|
| 腾讯云 轻量应用服务器 | 香港/新加坡 2C2G 3M | 新客 ¥99～199/年，续费 ¥28/月起 | 最省心，控制台中文 |
| 阿里云 轻量应用服务器 | 香港 2C2G | ¥24/月起 | 与腾讯云二选一 |
| RackNerd / BandwagonHost | 1C1G / 2C1G | $12～$50/年 | 便宜，但延迟 150ms+，客服英文 |

系统镜像选 **Ubuntu 22.04 LTS**（24.04 也行），**不要装宝塔/预装面板**，干净系统最好。

### 买完马上做两件事

1. **记下公网 IP**。
2. **放行端口**：在云厂商控制台的「防火墙/安全组」里放行 **22、80、443**。
   （80 是 Let's Encrypt 签证用的，443 是访问用的，缺一个证书就签不下来。）

### 登录

```bash
ssh root@你的服务器IP
```

第一次会问 `yes/no`，输 `yes`，再输密码（或直接用密钥）。

---

## 3. 第二步：域名解析

在域名服务商（阿里云/腾讯云/Cloudflare/Namecheap）添加一条 **A 记录**：

| 主机记录 | 类型 | 值 |
|---|---|---|
| `nestory`（或 `@`） | A | 你的服务器 IP |

等 1～10 分钟，在**你自己的电脑**上验证：

```bash
nslookup nestory.example.com
# 或者
ping nestory.example.com
```

必须解析到你的服务器 IP 才能继续，否则后面证书一定签不下来。

> **用 Cloudflare 托管 DNS 的话**：第一次先点成灰色云朵（DNS only），等证书签好、站点能打开后，再按需开橙色云朵。
> 开了代理后，Cloudflare 的 SSL/TLS 模式必须选 **Full (strict)**，否则会「重定向次数过多」。

---

## 4. 第三步：初始化服务器

一次性复制粘贴执行（约 3 分钟）：

```bash
# 1) 更新系统 + 基础工具
apt update && apt upgrade -y
apt install -y curl git ufw ca-certificates

# 2) 时区（备份时间、日志时间都是北京时间，方便对账）
timedatectl set-timezone Asia/Shanghai

# 3) 装 Docker（官方脚本，含 compose 插件）
curl -fsSL https://get.docker.com | sh

# 4) 2G 内存的机器加 2G swap：构建前端时 npm 容易冲到 1.5G，
#    没有 swap 会被 OOM Killer 杀掉，表现为 docker compose build 莫名中断
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# 5) 防火墙：只开 SSH 和 Web
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

验证 Docker：

```bash
docker version        # 有 Server 段（不是只有 Client）
docker compose version
```

> **国内机器装不上 Docker？** 把第 3 步换成阿里云镜像脚本：
> `curl -fsSL https://get.docker.com | sh -s -- --mirror Aliyun`
> 拉镜像慢的话，在 `/etc/docker/daemon.json` 里加镜像加速地址后 `systemctl restart docker`（加速地址经常变，以云厂商文档为准）。

---

## 5. 第四步：拉代码 + 填配置

```bash
mkdir -p /opt && cd /opt
git clone --depth 1 https://github.com/crisxuhey777/nestory.git
cd /opt/nestory/deploy/vps
cp .env.example .env
chmod 600 .env
```

先生成两个强密码（记到密码管理器里）：

```bash
openssl rand -base64 24
openssl rand -base64 24
```

然后编辑：

```bash
nano .env
```

**至少要改这 5 处**：

```ini
DOMAIN=nestory.你的域名.com            # 第 3 步解析的那个域名
NESTORY_DB_PASSWORD=<第一串随机密码>
MYSQL_ROOT_PASSWORD=<第二串随机密码>
NESTORY_DEMO_EMAIL=                    # 留空！关掉演示账号特权
NESTORY_LLM_KEY=<智谱 Key>
NESTORY_VISION_KEY=<智谱 Key，视觉用，可以同上>
```

几个**容易填错**的点：

- `NESTORY_DEMO_EMAIL=` 后面**必须是空的**，不能删掉这一行、也不能写成 `#` 注释——空字符串才是「关闭」。
- 密码里**不要有** `$`、`'`、`"`、空格，它们在 compose 文件里会被转义，容易出现「数据库密码错误」。
- `NESTORY_COOKIE_SECURE=1` 保持原样，这是 HTTPS 部署必须的。

保存：`Ctrl+O` → 回车 → `Ctrl+X`。

---

## 6. 第五步：启动

```bash
cd /opt/nestory/deploy/vps
docker compose up -d --build
```

第一次会拉镜像 + 在容器里编译前端，**3～8 分钟**，看到类似这样就完成了：

```
 ✔ Container nestory-db-1      Healthy
 ✔ Container nestory-app-1     Healthy
 ✔ Container nestory-caddy-1   Started
```

检查三个容器：

```bash
docker compose ps
```

`app` 和 `db` 要是 `healthy`，`caddy` 是 `running`。

还会看到一个 `nestory-init-1` 处于 `Exited (0)`，这是正常的：它只负责把 `data/media` 的属主改成容器用户（uid 10001），跑完就退出。没有它，第一次上传照片会因为目录是 root 所有而报 500。

### 第一次健康检查

```bash
curl -fsS https://nestory.你的域名.com/api/health
```

期望输出（`status` 必须是 `ok`，`db.ok` 必须是 `true`）：

```json
{"status":"ok","version":"3.0.0","time":1763140000000,
 "db":{"ok":true},"ai":{"configured":true},"vision":{"configured":true}}
```

`ai.configured=false` 说明 Key 没填对（不影响照片功能，只影响 AI 文案）。

### 证书是不是真的签下来了

```bash
docker compose logs caddy | grep -i "certificate obtained"
curl -I https://nestory.你的域名.com
```

浏览器打开域名，能看到登录页 → **部署完成**。

---

## 7. 第六步：上线验收清单（10 分钟）

刚部署完别急着发链接给家人，先把这 12 条走一遍：

- [ ] **1. 注册第一个账号**：邮箱 + 8 位以上密码；注册后自动成为家庭管理员
- [ ] **2. 能进首页**：看到首页/记录页，不是白屏
- [ ] **3. Cookie 是 Secure 的**：F12 → Application → Cookies → `nestory_session` 有 `HttpOnly` + `Secure`
- [ ] **4. 演示账号登不上**：用 `demo@nestory.local` 随便试一个密码 → 应提示账号或密码错误
- [ ] **5. 上传一张照片**：能显示、能放大
- [ ] **6. 换手机打开同一个账号**：照片在
- [ ] **7. 重启应用照片还在**：`docker compose restart app` 后再刷新
- [ ] **8. 邀请链接能生成**：设置 → 家庭 → 邀请 → 复制链接
- [ ] **9. 用另一个浏览器（无痕）打开邀请链接**：能注册并加入同一个家庭，能看到第 5 步的照片
- [ ] **10. 两台设备同时编辑**：一台改记录，另一台用旧页面保存 → 应提示冲突而不是覆盖
- [ ] **11. 备份能跑**：`./backup.sh` 之后 `ls -lh data/backup`
- [ ] **12. 手机添加到主屏幕**：iPhone Safari「共享 → 添加到主屏幕」，安卓 Chrome「安装应用」

用到的运维命令都收在 `ops.sh` 里：

```bash
cd /opt/nestory
./deploy/vps/ops.sh status     # 容器 + 磁盘 + 最近备份
./deploy/vps/ops.sh logs       # 实时日志
./deploy/vps/ops.sh smoke      # 健康检查 + 首页 + 未登录 401
./deploy/vps/ops.sh update     # 升级
```

---

## 8. 第七步：把家人拉进来

1. **你**先在设置里把宝宝资料填好（昵称、生日）——后面所有记录都以它为准。
2. 设置 → **家庭** → **邀请成员** → 选权限：
   - **管理员**：能删照片、管理成员（只给自己和配偶）
   - **可编辑**：能发记录、传照片（大多数家人）
   - **只读**：只能看（爷爷奶奶）
3. 点「复制邀请链接」，**有效期 7 天**。
4. 微信发给家人，让他们**自己注册**（链接里带着家庭 ID，注册完自动加入，不需要你再手动合并）。
5. 让家人在手机上「添加到主屏幕」，用起来跟 App 一样。
6. 提醒家人：**账号密码没有找回功能**，让他们自己存好；忘了只能你重建账号再邀请。

> 邀请链接 7 天后失效，重新生成一个即可。已加入的成员不受影响。

---

## 9. 数据备份（这一步别跳过）

照片都在 `deploy/vps/data/media`，数据库在 `data/mysql`，**它们都在同一块硬盘上**——硬盘挂了就全没了，所以必须有第二份。

### 每天自动备份

```bash
chmod +x /opt/nestory/deploy/vps/backup.sh
crontab -e
# 在最后加一行（每天凌晨 3:30，北京时间）
30 3 * * * /opt/nestory/deploy/vps/backup.sh >> /var/log/nestory-backup.log 2>&1
```

产物在 `deploy/vps/data/backup/`：`db-YYYYMMDD-HHMMSS.sql.gz`（每天）+ `media-*.tar.gz`（每周日），保留 14 天。

第二天检查：

```bash
tail -20 /var/log/nestory-backup.log
ls -lh /opt/nestory/deploy/vps/data/backup
```

### 一定要做一次「恢复演练」

只备份不演练，等于没备份。找个周末：

```bash
cd /opt/nestory/deploy/vps

# 1) 先备份当前状态（万一恢复错了还能回来）
./backup.sh

# 2) 恢复数据库
gunzip -c data/backup/db-20260101-033000.sql.gz \
  | docker compose exec -T db sh -c \
    'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'

# 3) 恢复媒体（如果媒体包也在）
docker compose stop app
tar -xzf data/backup/media-20260104-033000.tar.gz -C data
docker compose start app
```

### 再存一份到异地（强烈建议）

VPS 和备份放一起，遇到「服务商跑路/欠费删机」就一起没了。用 `rclone` 同步到 Cloudflare R2（10GB 免费）或你的 OneDrive：

```bash
apt install -y rclone
rclone config          # 按提示建一个 remote，比如叫 r2
```

然后编辑 `backup.sh`，把最后两行注释取消：

```bash
rclone copy data/backup/ r2:nestory-backup/ --max-age 2d --transfers 2
```

---

## 10. 升级与回滚

```bash
cd /opt/nestory
./deploy/vps/backup.sh          # 先备份
./deploy/vps/ops.sh update      # git pull + 重新构建 + 重启
```

本项目的数据表是**启动时自动创建**的（`CREATE TABLE IF NOT EXISTS`），正常升级不需要手动跑 SQL。但如果哪天升级后起不来：

```bash
cd /opt/nestory
git log --oneline -5            # 找到升级前的提交
git checkout <上一个提交的 sha>
cd deploy/vps && docker compose up -d --build
```

数据库结构升级是向前兼容的，回滚代码一般不会坏数据；**但回滚前仍然要备份**。

---

## 11. 排错手册

先看日志，90% 的问题日志里写着：

```bash
cd /opt/nestory/deploy/vps
docker compose logs --tail=100 app
docker compose logs --tail=100 caddy
docker compose logs --tail=50  db
```

| 现象 | 原因 | 解决 |
|---|---|---|
| 打不开，`curl` 超时 | 安全组/防火墙没放 80、443；或 DNS 没生效 | 检查云控制台安全组 + `nslookup` |
| 502 Bad Gateway | `app` 没起来或 crash | `docker compose logs app`，多半是数据库连不上 |
| 证书签不下来 | 80 端口不通 / DNS 不对 / 开了 Cloudflare 代理 | 先把 CF 云朵点灰，确认 `curl http://域名` 能访问，再 `docker compose restart caddy` |
| 登录后立刻退出 | 用 `http://` 访问，而 `NESTORY_COOKIE_SECURE=1` | 必须走 `https://` |
| 上传照片直接 **500**，日志有 `PermissionError: [Errno 13] '/data/media/nestory'` | `data/media` 是 Docker 用 root 建的，容器里以 uid 10001 跑，写不进去 | `sudo chown -R 10001:10001 data/media && docker compose restart app`（compose 里的 `init` 服务会在每次启动时自动修） |
| 家人登录后看不到宝宝资料/照片 | 他注册时自动建了自己的「单人家庭」，邀请链接只打开了、没点「加入家庭」 | 重新发邀请 → 家人登录后点页面上的「加入家庭」；用 `households` 表核对两人是否同一个 `household_id` |
| 上传大视频失败（413） | 反向代理请求体上限 | `Caddyfile` 的 `max_size 300MB` 要大于 `NESTORY_MEDIA_MAX_MB` |
| 上传后照片 404 | 媒体目录没挂对 | `docker compose exec app ls /data/media` 应该有文件 |
| 容器反复重启，`dmesg` 有 oom | 内存不足 | 加 swap；或把 compose 里 `--innodb-buffer-pool-size=128M` 降到 `96M` |
| 改过 `.env` 里的数据库密码后连不上 | MySQL 数据卷里还是旧密码 | 改回旧密码，或（新站、无数据时）`docker compose down -v` 重建 |
| 页面样式错乱/白屏 | 构建产物没更新 | `docker compose up -d --build --force-recreate app` |
| 家人说「打不开」 | 海外 IP 偶发阻断 | 换 DNS（114.114.114.114）、或考虑国内备案机 |

> `docker compose down -v` 会**删掉数据库和照片**，只在新站没数据时用。

---

## 12. 费用清单（一家 5 口，一年）

| 项目 | 费用 | 说明 |
|---|---|---|
| 香港轻量 2C2G | ¥99～360/年 | 促销价 ¥99～199，续费按原价 |
| 域名 `.top`/`.xyz` | ¥10～60/年 | 首年便宜，续费略涨 |
| TLS 证书 | ¥0 | Caddy 自动续期 |
| 对象存储 | ¥0 | 照片存本机；量大再上 R2（10GB 免费） |
| AI 文案 | ¥0 | 智谱 glm-4-flash 免费档 |
| **合计** | **约 ¥110～420/年** | 5 人分摊，每人每年 20～80 元 |

对比：iCloud 200GB ¥252/年、Google One 100GB 约 ¥130/年——这是一整套**属于自己**的记录 App，数据在自己手里。

---

## 附 A：零成本方案（家里旧电脑 / NAS）

不想付月费，家里有台常年开机的旧笔记本/小主机/NAS（2G 内存以上）也行，用 **Cloudflare Tunnel** 把内网服务暴露成 HTTPS 域名，**不需要公网 IP、不需要路由器端口映射**。

前提：一个**托管在 Cloudflare** 的域名（免费套餐即可）。

```bash
# 1) 在服务器（家里的机器）上装 Docker，部署本目录（同第 4～6 步，只是 DOMAIN 先随便填）
# 2) 装 cloudflared
curl -fsSL https://pkg.cloudflare.com/cloudflared/install.sh | bash

# 3) 浏览器登录 Cloudflare，授权一个域名
cloudflared tunnel login

# 4) 建隧道
cloudflared tunnel create nestory
# 输出里有一串 UUID，配置文件要用

# 5) 写配置 /etc/cloudflared/config.yml
```

```yaml
tunnel: <上一步的 UUID>
credentials-file: /root/.cloudflared/<UUID>.json
ingress:
  - hostname: nestory.你的域名.com
    service: http://127.0.0.1:8000    # 直接连 app 容器映射出来的端口
  - service: http_status:404
```

```bash
# 6) 绑定域名 + 开机自启
cloudflared tunnel route dns nestory nestory.你的域名.com
cloudflared service install
systemctl enable --now cloudflared

# 7) 验证
curl -fsS https://nestory.你的域名.com/api/health
```

这个方案下，把 compose 里 `caddy` 服务去掉、`app` 改成 `ports: ["127.0.0.1:8000:8000"]`，其余不变。
注意：家里**断电、断网、重启**都会让站点暂时打不开；家宽**上行带宽**决定家人上传照片的速度（30Mbps 上行 ≈ 3.75MB/s，够用）。

**没有域名也不想买**：用 Tailscale Funnel，免费给你一个 `https://xxx.ts.net` 的公网 HTTPS 地址，同样不需要公网 IP。缺点是别人看到的是 `*.ts.net` 域名，且流量走 Tailscale 中转。

---

## 附 B：国内服务器 + 备案（国内访问最快）

步骤和上面**完全一样**，只差两步前置条件：

1. **域名实名认证**（个人身份证，1～3 天）。
2. **ICP 备案**：在服务器厂商的备案系统里提交（需要服务器购买满 3 个月、域名已实名、拍摄核验视频），审核 **7～20 个工作日**。备案通过后 80/443 才能用域名访问。

备案期间可以先用 **IP + 端口** 自测（`http://IP:8000`，把 compose 里 app 的 8000 端口临时暴露出来），但**不要**把这种地址发给家人——HTTP 明文 + Cookie 不安全。

备案下来后，回到第 5 步填域名、启动，一切照旧。

---

## 附 C：把照片放到 Cloudflare R2（可选）

好处：照片不占 VPS 硬盘、有异地冗余、家人看图更快（R2 有全球边缘缓存）。免费额度 10GB 存储 + 无限出站。

1. Cloudflare 控制台 → R2 → 创建桶 `nestory`。
2. 创建 **API 令牌**（权限：Object Read & Write，只限这个桶），记下 Access Key / Secret Key 和 S3 端点 `https://<账号ID>.r2.cloudflarestorage.com`。
3. **桶的 CORS 必须配**，否则浏览器直传会失败（R2 → 桶 → Settings → CORS Policy）：

```json
[
  {
    "AllowedOrigins": ["https://nestory.你的域名.com"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

4. 在 `.env` 里填 `NESTORY_S3_*` 五项（`NESTORY_S3_REGION=auto`），重启：

```bash
docker compose up -d --force-recreate app
curl -fsS https://你的域名/api/health
```

5. 验证：上传一张新照片，看 R2 桶里出现 `nestory/<用户ID>/<媒体ID>.jpg`。

> 切换存储驱动**不会**自动搬旧照片：已经存在本地磁盘的仍从本地读，新上传的进 R2。想全搬过去，把 `data/media/nestory/` 下的文件用 rclone 传到桶里同名前缀即可。

---

## 附 D：这个目录里有什么

```
deploy/vps/
├── docker-compose.yml   # app + mysql + caddy 三个容器
├── Caddyfile            # 自动 HTTPS + 反代 + 300MB 上传上限
├── .env.example         # 配置模板（复制成 .env）
├── backup.sh            # 每日 mysqldump + 每周媒体包，保留 14 天
├── ops.sh               # status / logs / update / smoke
└── data/                # 运行时数据（mysql / media / backup / caddy），不进仓库
```

相关文档：

- `deploy/go-live-checklist.md` —— 上线验收的完整版（含回滚、48 小时观察）
- `deploy/README.md` —— 不用 Docker 的 Ubuntu + Nginx + systemd 手工部署
- `backend/README.md` —— 本地开发怎么跑、环境变量全表
