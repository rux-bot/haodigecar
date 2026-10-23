# 后台接口与部署

网站使用 Express 5 与 Node.js 内置 SQLite。要求 Node.js 24.15 或更高版本。数据库在 `data/catalog.sqlite`，首次启动时从 `data/vehicles.json` 导入；以后的重启不会覆盖后台编辑。

## 本地运行

安装依赖后运行 `npm run dev`。Vite 前台将 `/api` 代理到 `127.0.0.1:3001`。单独运行后端可使用 `node server/index.mjs`。默认只监听 `127.0.0.1`，端口可通过 `API_PORT` 或 `PORT` 修改。

首次访问 `/admin` 时，在服务器本机用 localhost 或 127.0.0.1 创建管理员。账号为 3–64 位字母、数字或 `_ @ . -`。密码需为 12–128 个 Unicode 字符，并至少包含一个字母和一个数字；支持中文、空格和符号，不允许控制字符。不存在预设密码。初始化完成后关闭创建入口。密码使用随机盐 scrypt 保存，会话使用随机令牌，数据库中只保存令牌哈希。

## 生产部署

先执行 `npm run build`，再设置 `NODE_ENV=production`、`PUBLIC_ORIGIN=https://你的域名`、`COOKIE_SECURE=true` 并运行 `npm start`。反向代理将 HTTPS 流量转发到本机 3001 端口。`PUBLIC_ORIGIN` 必须与浏览器地址完全一致（协议、域名和端口），不带末尾斜线。开发默认允许 `localhost` 和 `127.0.0.1` 的 5173、3001 端口。更改开发端口时也可通过 `PUBLIC_ORIGIN` 指定实际地址。

建议在正式部署前完成本地管理员初始化，再将数据库随应用部署；也可在服务器本地通过临时开发配置初始化，之后改回正式 HTTPS 配置。`NODE_ENV=production` 时创建管理员入口关闭，防止反向代理误把公网请求识别为本机请求。登录入口正常工作。

`HOST=0.0.0.0` 可用于容器部署；常规反向代理继续使用默认的 `127.0.0.1`。数据库、`public/vehicles` 和 `public/uploads` 必须使用可写的持久存储。SQLite 适合本项目单服务实例运行，不要让多个主机共享同一数据库文件。备份时停服务并复制 `data` 与这两个图片目录，或使用 SQLite 备份功能，不能只复制运行中的 `.sqlite` 主文件而遗漏 WAL 数据。精简部署包与步骤见 `DEPLOYMENT.md`。

## 接口

公开接口：

- `GET /api/catalog`：`{vehicles, settings}`，只包含上架车型。
- `GET /api/vehicles/:id`：`{vehicle}`，下架或不存在返回 404。
- `GET /api/auth/status`：`{setupRequired, authenticated, csrfToken?}`。
- `POST /api/auth/setup`、`POST /api/auth/login`：请求 `{username,password}`，返回登录状态和 `csrfToken`。
- `POST /api/auth/logout`：需要有效登录、可信 `Origin` 和 `x-csrf-token`，撤销当前会话并清除登录 Cookie。

管理接口全部要求有效管理员会话；写接口还要求 `Origin` 及 `x-csrf-token`：

- `POST /api/admin/password`：请求 `{currentPassword,newPassword}`；验证当前密码后更新密码并撤销所有登录会话，清除当前登录 Cookie，返回 `{changed:true,requiresLogin:true}`。之后必须使用新密码重新登录。
- `GET /api/admin/vehicles`：`{vehicles}`，包含已下架车型和来源文件名。
- `POST /api/admin/vehicles`：完整车型数据，`id` 可省略自动生成，返回 `{vehicle}`。
- `PATCH /api/admin/vehicles/:id`：部分字段更新，返回 `{vehicle}`。不能改编号。
- `DELETE /api/admin/vehicles/:id`：永久删除车型，并清理没有其他车型或公司图标引用的图片，返回 `{deleted:true,id}`。
- `GET /api/admin/settings`：`{settings}`。
- `PUT /api/admin/settings`：网站名称、说明、电话、微信、地址、公司图标，返回 `{settings}`；保存后清理不再引用的旧图标。
- `POST /api/admin/uploads`：multipart 字段名 `file`，返回 `{url}`。支持 JPEG、PNG、WebP，最大 8 MB。
- `POST /api/admin/uploads/discard`：请求 `{urls:[...]}`，丢弃本会话上传且尚未保存引用的图片，返回 `{discarded:[...]}`。已被车型（包括下架车型）或图标引用的文件会保留。

移除或更换已保存图片时，只有提交车型/网站设置成功后才清理旧文件。取消编辑会回收此次未保存的上传；异常关闭页面留下的无引用上传，在 24 小时后由启动/定期清理回收。

所有错误统一为 `{error: "可读说明"}`。登录会话有效期 12 小时，Cookie 为 HttpOnly、SameSite=Strict；生产部署还需启用 Secure。所有 SQL 参数化，图片路径仅允许本站 `vehicles` 与 `uploads` 目录。

## 修改密码与尝试限制

后台「账号安全」可修改密码。新密码采用上述初始化强度规则，且不得与当前密码相同。已有账号登录不强制套用新规则，旧密码仍可登录后主动修改。密码更新和全部会话撤销在同一个数据库事务中完成，其他设备的旧会话也会失效。

改密接口的 `400` 表示字段格式、新密码强度或新旧密码相同；`403` 表示当前密码不正确，或来源/CSRF 校验失败；`401` 表示会话已失效；`429` 表示尝试过多，响应中的 `Retry-After` 给出剩余等待秒数。响应丢失时不能直接断定改密失败，应退出旧会话后尝试使用新密码登录；若不成功，再尝试原密码。前端会保留这项提示。

失败计数保存在 SQLite 的 `auth_throttle` 表，重启服务不会重置。计数窗口为首次失败起 15 分钟：

- 初始化：按连接 IP 最多允许 5 次凭据格式/强度失败。
- 登录：按连接 IP 与账号组合最多允许 10 次失败，同时同一连接 IP 合计最多允许 30 次失败，更换账号名也受总次数限制。
- 修改密码：按管理员账号累计 5 次当前密码错误，跨登录会话和 IP 共享。

成功登录不会清除此前失败次数，其他接口的成功请求也不会重置计数。窗口到期后自动恢复；伪造 `X-Forwarded-For` 不能改变连接 IP。反向代理部署时，后端看到的同一代理连接 IP 共享登录总次数限制。公开车型浏览及已有会话的其他管理操作不受登录计数限制。

发布与库存分别使用 `published` 和 `availability`。新增车型默认下架，现车情况默认“待确认”；无论是否上架，都不能由车型资料推断现车状态。

## 验证

运行 `node --test tests/api.test.mjs`。测试使用隔离的临时数据库，验证公开可见性、初始化、认证、CSRF、上下架、输入校验、图片上传、设置、重启持久化、退出登录、密码变更及所有会话撤销、持久限流，不接触正式数据。
