# 广域网部署指南

这个项目是 **单进程 Node.js + WebSocket** 游戏，HTTP 和 `/ws` 必须指向同一个实例、同一个端口。**不要部署成多副本**，除非另外做房间路由和共享状态；当前对局数据存在进程内存里。

生产启动方式：

```bash
npm ci
npm run build
npm start
```

默认监听 `0.0.0.0:3000`，健康检查：`GET /api/status`。

生产静态服务已经内置 gzip：主 JS 约 605KB → 162KB，CSS 约 29KB → 7KB；`/assets/*` 使用一年 immutable 缓存。前置 Caddy/Nginx 不需要再强制压缩。

## 方案一：临时公网地址（最快）

本机服务已启动后，在 Windows PowerShell 里执行：

```powershell
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:127.0.0.1:3000 nokey@localhost.run
```

终端会输出一个 `https://xxxx.lhr.life` 地址，发给朋友即可。它支持 WebSocket，但属于免费临时隧道，**SSH 重连后会换一个新域名，旧地址直接变成 “no tunnel”**。只适合临时试玩，不能作为正式入口。

Serveo 免费版还会先弹一个浏览器安全警告页，Cloudflare Quick Tunnel 同样是随机临时域名。免费隧道没有稳定性承诺。

Cloudflare Quick Tunnel 也可以：

```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://127.0.0.1:3000 --no-autoupdate
```

会得到一个 `https://xxxx.trycloudflare.com` 地址，同样是临时地址。

## 方案二：Render（推荐给不想维护服务器的人）

仓库根目录已经包含 `render.yaml`。

1. 把项目推到 GitHub。
2. 在 Render 新建 **Blueprint**，选择这个仓库。
3. Render 会读取 `render.yaml`，执行 `npm ci && npm run build`，再启动 `node server/index.js --prod`。
4. 部署完成后使用 Render 提供的 HTTPS 域名，WebSocket 会自动走同源 `wss://域名/ws`。

注意事项：

- Render 免费实例会休眠，休眠时 WebSocket 会断开；正式对战建议升级到常驻实例。
- 必须保持单实例；当前没有 Redis / 房间总线。
- 如果平台要求设置 Node 版本，使用 Node 22。

## 方案三：自己的 VPS（Docker + Caddy，最适合长期运行）

服务器安装 Docker 和 Caddy，把项目放上去：

```bash
docker compose up -d --build
curl http://127.0.0.1:3000/api/status
```

然后把 `deploy/Caddyfile` 里的 `blade.example.com` 改成你的域名，DNS A 记录指向服务器，执行：

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy 会自动申请 HTTPS 证书，并自动代理 WebSocket Upgrade。对外只需要开放 **80/443**，3000 端口不需要暴露到公网。

如果使用 Nginx，可以参考 `deploy/nginx.conf`；关键点是 `Upgrade` / `Connection` 头和长连接超时。

## 方案四：Cloudflare Named Tunnel（固定域名，不暴露端口）

适合没有公网 IP 或不想开放 80/443 的机器。

```bash
cloudflared tunnel login
cloudflared tunnel create blade-storm
cloudflared tunnel route dns blade-storm blade.example.com
```

把 `deploy/cloudflared.yml` 里的 tunnel id 和 credentials 路径改好，然后：

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

同一个域名会同时代理 HTTP 和 WebSocket，无需额外配置 Upgrade。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `BOTS` | `3` | AI 补位数量 |
| `MOBS` | `38` | 刀傀数量 |
| `NODE_ENV` | - | 生产环境设为 `production` |

## 上线前检查

1. 页面能打开，`/api/status` 返回 200。
2. HTTPS 页面能建立 `wss://域名/ws` 连接，能进入同一个擂台。
3. 反向代理保留 WebSocket Upgrade，且读超时足够长。
4. 只运行一个应用实例。
5. 用 `?quality=low` 可以给低端设备强制性能模式。

## 当前临时地址

本次会话已经通过 localhost.run 建立了临时公网隧道。地址只在该隧道进程运行期间有效，重启后会变化。
