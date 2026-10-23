# 部署说明

零第三方依赖的 Node.js 应用。所有依赖均为 Node 内置模块，无需 `npm install`。

## 环境要求

- **Node.js ≥ 22.5**（需要内置 `node:sqlite`）
  - 检查：`node -v`
  - 若版本过低：到 https://nodejs.org 下载 22.x LTS

无需数据库服务、无需构建、无需联网。

## 启动

```bash
# Linux / macOS
node server.js

# Windows
node server.js
```

看到这行即启动成功：

```
现场设备点位表系统已启动 → http://localhost:8787
```

浏览器打开 `http://<服务器IP>:8787`

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8787` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址（已允许外部访问） |
| `DATA_DIR` | `./data` | 数据库目录 |
| `ALLOW_REGISTER` | `1` | 设为 `0` 可关闭自助注册 |

示例：

```bash
PORT=80 DATA_DIR=/var/lib/spt node server.js
```

## 数据库

- 首次启动自动在 `data/` 下创建 `signal-points.db`
- 自动建表并写入初始数据（原 Excel 的 24 行示例点位 + 31 条信号类型配置 + 默认账号）
- 备份 = 复制整个 `data/` 目录

---

## 生产部署

### 方式一：systemd（Linux 推荐）

`/etc/systemd/system/spt.service`：

```ini
[Unit]
Description=Signal Point Manager
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/signal-point-manager
ExecStart=/usr/bin/node server.js
Environment=PORT=8787
Environment=HOST=0.0.0.0
Environment=DATA_DIR=/opt/signal-point-manager/data
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now spt
sudo systemctl status spt
```

### 方式二：PM2

```bash
npm i -g pm2
pm2 start server.js --name spt --time
pm2 save
pm2 startup
```

### 方式三：Windows / 计划任务

```bash
node server.js
```

或用 [nssm](https://nssm.cc/) 注册为 Windows 服务。

---

## Nginx 反向代理（推荐，用于 HTTPS）

```nginx
server {
    listen 80;
    server_name spt.example.com;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

配 HTTPS：

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d spt.example.com
```

### 反代注意事项

- 登录 IP 限流依赖 `X-Forwarded-For`，务必透传（上面配置已包含）
- 应用默认绑定 `0.0.0.0:8787`，若前面有 Nginx，建议改为 `HOST=127.0.0.1` 只对本机开放

---

## 防火墙

开放端口（若直接对外访问）：

```bash
# Ubuntu
sudo ufw allow 8787/tcp

# CentOS / firewalld
sudo firewall-cmd --add-port=8787/tcp --permanent
sudo firewall-cmd --reload
```

用 Nginx 反代时，只需开放 80/443。

---

## 首次登录后必做

1. 用 `admin` / `admin123` 登录，系统会强制改密
2. 在「用户与权限」中为同事创建账号，或让他们自助注册
3. 在「基础配置」中按实际情况维护项目名称、柜子号、模块号、模块类型、**设备部位对照**、模块型号
4. 正式使用前建议将 `ALLOW_REGISTER=0` 关闭自助注册

---

## 升级

1. 停止服务
2. 备份 `data/` 目录
3. 覆盖代码文件（保留 `data/`）
4. 重启服务

数据结构变更会自动迁移（`CREATE TABLE IF NOT EXISTS`），不会丢数据。

---

## 常见问题

**Q：提示 `node:sqlite` 找不到**
Node 版本低于 22.5。升级 Node，或改用支持版本。

**Q：端口被占用**
`PORT=9000 node server.js` 换一个端口。

**Q：忘记管理员密码**
删除 `data/signal-points.db` 重启会重置为初始数据（**会丢失全部业务数据，务必先备份**）。
更稳妥的方式是用管理员之外的账号登录后，在「用户与权限」中重置。

**Q：数据存在哪**
`DATA_DIR` 指定目录下的 `signal-points.db`。直接复制该文件即可备份。

**Q：能支持多少人同时用**
SQLite + WAL 模式，几十人规模的项目现场使用没有问题。更大并发建议换 PostgreSQL。

---

## 目录清单

```
signal-point-manager/
├── server.js       # HTTP 服务 + API + 鉴权
├── db.js           # 建表 / 种子数据 / 编号规则
├── package.json
├── data/           # SQLite 数据库（运行时自动创建）
└── public/
    ├── index.html
    ├── styles.css
    ├── app.js
    ├── manifest.webmanifest
    ├── sw.js
    └── icons/

test.js             # API 测试（112 项）
verify-ui.js        # 浏览器 UI 测试（92 项）
README.md           # 功能与规则说明
DEPLOY.md           # 本文件
```

部署时只需上传除 `data/`、`test.js`、`verify-ui.js` 外的文件。