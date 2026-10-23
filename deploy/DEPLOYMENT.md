# VPS 上线记录

上线日期：2026-10-13（Asia/Shanghai）

- 地址：https://www.engineer-service-report.top:10443/
- VPS：107.173.154.48
- 容器：`signal-point-manager`，镜像 `signal-point-manager:20261013-1`
- 发布源码：`/opt/signal-point-manager/releases/20261013-1`
- 持久数据库：`/opt/signal-point-manager/data/signal-points.db`
- Nginx：`/etc/nginx/conf.d/signal-point-manager.conf`
- 应用端口：仅本机 `127.0.0.1:8787`，由 Nginx 提供公网 HTTPS
- 容器自动重启：`unless-stopped`，Docker 和 Nginx 已启用开机启动
- 自助注册：生产环境关闭；当前账号与全部业务数据已导入

使用现有 Let's Encrypt 证书，域名包含 `www.engineer-service-report.top`，有效期至 2027-01-08 09:43:43 UTC（北京时间 17:43:43）。已确认 `certbot.timer` 和 `reload-nginx` 续期钩子存在。

## 数据校验

使用 SQLite 在线备份生成一致性快照，没有直接复制正在运行的 WAL 数据库。线上数据库与发布快照中业务及账号表的摘要一致，SQLite `quick_check` 返回 `ok`。

- 项目：5；柜子号：110；模块：5；点位：40；信号类型：38；设备部位：2；账号：1。
- 业务及账号表摘要：`418cc86cec703e1b9c86be3e1573c92f0ee3aec01dba97913eeef20f87f3d239`
- 发布包 SHA256：`753d471c20721c6225f5c1206dc9a78915eebf7fca56ba156617a508541e58f5`
- 会话表仍按应用正常逻辑清理过期会话，不纳入数据摘要。

## 验证

本地接口与浏览器回归通过。公网严格 TLS 校验返回 HTTP 200，真实浏览器验证匿名首页、项目→柜子→模块导航、点位读取、基础配置登录弹窗和窄屏导航通过，未修改线上数据。8443 与 9443 原有站点配置保留。

## 维护

查看日志：`docker logs --tail 100 signal-point-manager`

重启应用：`docker restart signal-point-manager`

检查代理：`nginx -t && systemctl reload nginx`

升级代码时应保留持久数据库目录。`deploy/install.sh` 是本次首次部署脚本，会拒绝覆盖已有数据库；不要直接用它覆盖线上版本。

本机数据库和线上数据库从发布快照之后各自独立，后续正式数据请在上述线上地址维护。

## 窄屏点位表更新（20261013-2）

当前运行镜像已更新为 `signal-point-manager:20261013-2`，源码目录为 `/opt/signal-point-manager/releases/20261013-2`。模块点位表在窄屏保持完整表格，使用表格内部横向滚动，序号列固定在左侧。

仅更新代码，没有上传或覆盖本地数据库。更新前备份位于 `/opt/signal-point-manager/data/backups/before-20261013-2.db`；前一版本容器保留为 `signal-point-manager-before-20261013-2`（已停止）。更新前后业务及账号数据摘要一致：`ad91f8c0d7e8405ccaa9d30611b6fc2138c777ececcd4014d5f5bab60c2bb3ca`，点位为 41 条，SQLite 完整性检查通过。

320、390、820px 本地浏览器布局测试通过，公网 HTTPS 浏览器已验证表头、通道行结构和横向滚动。

## 最窄模式列宽更新（20261013-3）

当前镜像为 `signal-point-manager:20261013-3`，源码目录 `/opt/signal-point-manager/releases/20261013-3`。≤480px 时表格最小宽度缩至 729px，设备部位 55px、序号 30px、信号类型 82px、编号与 PLC 点位各 113px。信号名称按四字符宽度、最多两行显示，字号与传感器类型一致，保留原生下拉选择。

线上备份：`/opt/signal-point-manager/data/backups/before-20261013-3.db`。仅替换代码，保留同一个持久数据库；原版本容器为 `signal-point-manager-before-20261013-3`（已停止）。本地布局和编辑回归以及公网浏览器验证均通过。

## 项目拖放排序更新（20261013-4）

当前镜像为 `signal-point-manager:20261013-4`，源码目录 `/opt/signal-point-manager/releases/20261013-4`。基础配置的项目名称支持鼠标拖放、触屏长按后拖动和拖动手柄上的上下方向键，松开后保存到 `projects.sort_order`。排序同步到项目结构、项目总览及新增模块下拉框。

新增管理员接口 `POST /api/config/projects/reorder`，校验完整项目列表并在事务中保存；并发增删造成列表不一致时拒绝排序并提示刷新。鼠标、真实触摸、键盘和接口权限回归测试通过。

备份位置：`/opt/signal-point-manager/data/backups/before-20261013-4.db`；前一版本容器为 `signal-point-manager-before-20261013-4`（已停止）。更新仅替换代码，保留持久数据库。

## 项目及控制柜 CSV 导出（20261014-1）

当前镜像为 `signal-point-manager:20261014-1`，源码目录 `/opt/signal-point-manager/releases/20261014-1`。移除新增通道点位按钮，项目总览和控制柜总览新增 CSV 导出。项目范围导出全部柜子和模块配置，控制柜范围同时按项目和柜子筛选；点位行带项目、柜子、模块和型号信息，序号按模块分别计算。

接口范围隔离与真实浏览器下载测试通过，公网项目和控制柜导出验证通过。线上数据保留，备份在 `/opt/signal-point-manager/data/backups/before-20261014-1.db`；更新前后摘要一致：`40c4f1678df23684189ced5637b5a212f2a5c36fdc75dd14fbc341b02b918756`，SQLite 完整性检查通过。

## 项目结构树柜子拖放排序（20261014-2）

当前镜像为 `signal-point-manager:20261014-2`，源码目录 `/opt/signal-point-manager/releases/20261014-2`。柜子编号支持鼠标拖动与触屏长按后拖动，柜子及其模块整体移动，松开后保存。顺序通过新增表 `project_cabinet_order` 按项目单独记录，不修改全局柜子号顺序；项目总览同步显示新顺序。

新增公开现场业务接口 `POST /api/projects/:id/cabinets/reorder`，验证当前项目的完整柜子集合，拒绝重复、漏项或不属于该项目的柜子。搜索过滤时不启用拖放。鼠标、真实触摸、刷新保存和跨项目隔离测试通过，公网浏览器验证通过。

备份：`/opt/signal-point-manager/data/backups/before-20261014-2.db`。原有业务数据摘要和更新前一致，SQLite 完整性检查通过；前一版本容器为 `signal-point-manager-before-20261014-2`（已停止）。

## 点位列名称更新（20261014-3）

当前镜像为 `signal-point-manager:20261014-3`。模块点位表的 PLC 列改为「PLC点位表达式」，搜索提示和单元格标识同步更新。公网页面和脚本已验证新名称；保留线上数据库，备份位于 `/opt/signal-point-manager/data/backups/before-20261014-3.db`。

## 信号类型程序名称列（20261014-4）

当前镜像为 `signal-point-manager:20261014-4`，源码目录 `/opt/signal-point-manager/releases/20261014-4`。信号类型配置在「传感器类型」后新增「程序名称」，支持行内编辑和新增时填写。数据库新增 `signal_types.program_name`，历史记录默认空白；局部更新其他字段保留程序名称。

接口创建/更新和浏览器列位置、编辑保存测试通过，公网新列及字段验证通过。数据库备份位于 `/opt/signal-point-manager/data/backups/before-20261014-4.db`，SQLite 完整性检查通过，原有记录数量保留。备份和线上库对比发现信号 ID 6 的简写与传感器类型有编辑差异，无记录删除；这些列不在本次字段迁移的写入范围。

## PLC 赋值表达式（20261014-5）

当前镜像为 `signal-point-manager:20261014-5`，源码目录 `/opt/signal-point-manager/releases/20261014-5`。输入 DI/AI 模块显示 `程序名称_设备点位:=PLC地址;`，输出 DO/AO 模块显示 `PLC地址:=程序名称_设备点位;`。星号按用户确认仅为占位说明，变量使用下划线连接。

地址仍存于 `points.plc_point`，表达式按最新信号程序名称、设备点位及模块类型在读取时推导为 `plc_expression`，不覆写原地址。缺少程序名称或设备点位时回退显示地址。点位表显示只读表达式，CSV 导出同步使用表达式；修改设备点位或选择信号后即时更新。

DI/DO/AI/AO 接口测试、编辑回显、导出与窄屏浏览器回归通过。备份 `/opt/signal-point-manager/data/backups/before-20261014-5.db`，升级前后数据库摘要一致：`486d3eebe4abc0cf1af4abb93e319ab948a2f0139cd844da1fb4c220f8deea3a`。

## 输出模块地址改用 O（20261014-6）

当前镜像为 `signal-point-manager:20261014-6`。点位表达式的地址段 `:Q.` 改为 `:O.`，模拟输出 `:QW.` 同步为 `:OW.`，页面和各范围 CSV 导出使用同一规则；保留原始地址数据及变量名称。

DI/DO/AI/AO 接口测试及公网 HTTPS 页面、CSV 验证通过。备份 `/opt/signal-point-manager/data/backups/before-20261014-6.db`，升级前后数据摘要一致：`df76cfc39998d8e774480d7d9841eec275a447ab69ae713cba3b68e732e95bd5`；SQLite 完整性检查通过。

## 表达式设备点位编号补零（20261014-7）

当前镜像为 `signal-point-manager:20261014-7`。按用户确认，单字母加数字的设备点位在 PLC 表达式中将数字补足 5 位：`G6 → G00006`、`P1032 → P01032`。原始设备点位和编号列保持原样；已有 5 位及更长数字完整保留，其他命名保持原样。页面及 CSV 共用规则。

DI/DO/AI/AO 接口与 CSV 测试通过。备份 `/opt/signal-point-manager/data/backups/before-20261014-7.db`，升级前后数据库摘要一致：`df76cfc39998d8e774480d7d9841eec275a447ab69ae713cba3b68e732e95bd5`，SQLite 完整性检查通过。

## 同柜模块号防重复（20261014-8）

当前镜像为 `signal-point-manager:20261014-8`。新增模块按项目、柜子和模块号判重，不再允许通过更换模块类型新增相同编号。返回 409 并提示「柜子…的模块号…已存在，请使用其他模块号」。不同柜子及不同项目仍可复用编号。数据库新增索引及插入、改号触发器，历史记录不删除。

同类型、跨类型、前后空格、不同柜子、不同项目、并发提交及数据库约束测试通过。备份 `/opt/signal-point-manager/data/backups/before-20261014-8.db`。部署前后均为 0 个模块、0 个点位，无历史重复模块；完整性检查通过。部署期间模块号配置从 20 条变为 21 条，其余业务表记录数量保持一致。公网无模块状态的 HTTPS 启动和配置接口验证通过，点位导航检查跳过。

## 信号配置移除两列（20261014-9）

当前镜像为 `signal-point-manager:20261014-9`。信号类型配置表移除「无传感器」「启用」表头、单元格及开关，编号说明改为未填写时显示 Reserved。数据库中的原有标记及计算、筛选规则保留。

脚本语法与公网表头、开关移除、HTTPS 验证通过。备份 `/opt/signal-point-manager/data/backups/before-20261014-9.db`。部署前后数据摘要一致：`6e30cc7d1b2b86d7a7208cfcf4b259248b2897880fa9c46bf7171e88b115e5f4`；SQLite 完整性检查通过。

## 信号配置窄屏横向滚动（20261014-10）

当前镜像为 `signal-point-manager:20261014-10`。信号配置表在所有宽度下保留表头、行和单元格，最小宽度 900px，通过表格容器左右滚动查看列。移除该表的移动端卡片转换规则，其他表布局保持原样。

隔离浏览器在 768px、390px 下验证表格结构、横向滚动和页面无横向溢出；编辑保存回归通过。公网 390px 布局与 HTTPS 验证通过。备份 `/opt/signal-point-manager/data/backups/before-20261014-10.db`。部署前后数据库摘要一致：`896f70ba13cba8ebf92f7d9f71b13e12546c5b227b73d972293ec3bf71794691`，SQLite 完整性检查通过。

## DI/DO 信号名称后缀筛选（20261014-11）

当前镜像为 `signal-point-manager:20261014-11`。模块点位页中，DI 模块只能选择名称以 DI 结尾的信号，DO 模块只能选择名称以 DO 结尾的信号（忽略大小写及名称末尾空格）。设备部位与启用筛选继续生效；AI/AO 不增加后缀限制。信号名称不自动修改，历史点位选择不批量重写。新增点位和修改信号的接口同步校验，返回明确的 400 提示。

DI/DO 接口拒绝不匹配后缀、AI/AO 兼容性、设备部位、表达式及 CSV 回归通过；隔离浏览器下拉筛选和编辑保存通过。公网 HTTPS 和配置页面检查通过，当前无模块，点位导航检查跳过。备份 `/opt/signal-point-manager/data/backups/before-20261014-11.db`。部署前后数据库摘要一致：`dbeb0c0c1ac091dd3d11b4a616aeb652ade7a8f26d275715fd9e1bf67447c52b`，完整性检查通过。

## 设备点位自动大写（20261014-12）

当前镜像为 `signal-point-manager:20261014-12`。设备点位输入时自动转为大写并保留光标位置，输入法组合期间不转换，组合结束后统一处理。新增和修改点位接口保存时也统一大写，原有点位不批量迁移。`g6` 输入为 `G6`，PLC 表达式使用 `G00006`。

接口大写保存、表达式、CSV 与浏览器输入即转换、失焦保存验证通过，公网点位页面和 HTTPS 验证通过。备份 `/opt/signal-point-manager/data/backups/before-20261014-12.db`；部署前后各表记录数量一致，保留当前持久数据库，SQLite 完整性检查通过。部署期间数据摘要发生变化，本次部署不执行业务数据迁移。

## DI/DO 未配置点位 Spare 表达式（20261014-13）

当前镜像为 `signal-point-manager:20261014-13`。设备点位为空（包括纯空格）或信号类型未选择时，DI 显示 `//Spare:=PLC地址;`，DO 显示 `//PLC地址:=Spare;`。补齐配置后恢复普通赋值表达式。仅程序名称为空不触发本规则；AI/AO 保持原有规则。点位页和 CSV 共用派生表达式，不改写原始地址数据。

接口验证未配置、清空设备点位、清空信号、恢复配置与 CSV 导出通过。公网 Spare 表达式和点位页面、CSV、HTTPS 验证通过。备份 `/opt/signal-point-manager/data/backups/before-20261014-13.db`；部署前后数据库摘要一致：`8f06df3629ba0238a91f7f78b22dc14ccf1e6a57cfe404a37a1d8a13ffaf81cf`，SQLite 完整性检查通过。

## 项目与控制柜 Excel 双工作表导出（20261014-14）

项目总览及控制柜总览导出为 Excel 工作簿，含「DI模块」「DO模块」两个工作表。输入模块 DI/AI 收录在 DI 表，输出模块 DO/AO 收录在 DO 表；每个模块包含独立模块信息行和点位表，模块之间留一空行。单模块页面仍导出 CSV。总览导出按钮更新为「导出 Excel」。

使用零外部依赖的 XLSX 工作簿生成器，数据库及现有业务数据未迁移。更新前后各表记录数、摘要一致，SQLite 完整性检查通过；发布版本为 `signal-point-manager:20261014-14`，备份位于 `/opt/signal-point-manager/data/backups/before-20261014-14.db`。

## 导出工作表列宽适配内容（20261014-15）

Excel 导出按每列最长内容计算工作表列宽，中文按双字符宽度估算，换行文本按最长单行计算；同时保留表头与内容列宽，并限制在 Excel 支持的最大列宽范围内。

发布版本为 `signal-point-manager:20261014-15`。更新前后数据库摘要一致：`3bdbbcce09cf898ea6d92c591aea1386b1874908891f68f258c4a30b747866b3`；SQLite 完整性检查通过。备份位于 `/opt/signal-point-manager/data/backups/before-20261014-15.db`。

## 导出工作表移除重复模块表头（20261014-16）

每张 DI/DO 工作表只保留首个模块的模块信息行和点位列标题行。后续模块点位数据直接接续，模块之间保留空行；每个点位行继续包含项目、柜子和模块信息，便于识别数据归属。

发布版本为 `signal-point-manager:20261014-16`。更新前后业务数据库摘要一致：`78ded16c82d6253b690e20205144b152060c746e395d0c9dc5a7afabf6d526f6`，SQLite 完整性检查通过。备份位于 `/opt/signal-point-manager/data/backups/before-20261014-16.db`。

## 模块卡片显示已用与备用通道（20261014-17）

模块卡片将「通道 / 点位」改为「已用 / 备用」。已用按设备部位、设备点位、信号类型三项均已填写的通道数统计；备用为模块总通道数减去已用，最低为 0。进度条和完成状态按已用/总通道数计算。

发布版本为 `signal-point-manager:20261014-17`。数据库摘要更新前后相同：`78ded16c82d6253b690e20205144b152060c746e395d0c9dc5a7afabf6d526f6`；SQLite 完整性检查通过。备份位于 `/opt/signal-point-manager/data/backups/before-20261014-17.db`。

## 控制柜卡片按 DI/DO 统计（20261014-18）

控制柜卡片分别显示 DI/DO 模块数量、已使用点位数和空余点位数。已使用点位沿用模块卡片的完整配置定义；空余为对应类型全部模块的通道容量减去已用数。项目总览卡片保留原统计。

发布版本为 `signal-point-manager:20261014-18`。数据库摘要更新前后相同：`78ded16c82d6253b690e20205144b152060c746e395d0c9dc5a7afabf6d526f6`，SQLite 完整性检查通过。备份位于 `/opt/signal-point-manager/data/backups/before-20261014-18.db`。

## 柜内模块改为表格列表（20261014-19）

进入控制柜总览后，柜内模块改为可横向滚动的紧凑表格，按行显示模块号、类型、型号、已用/备用、使用率、创建者和操作，方便查看较多模块。点击行或「查看明细」进入点位页面；有管理权限时保留删除按钮。项目和项目列表视图保持卡片。

发布版本为 `signal-point-manager:20261014-19`。部署前后数据库摘要一致：`78ded16c82d6253b690e20205144b152060c746e395d0c9dc5a7afabf6d526f6`，SQLite 完整性检查通过。备份位于 `/opt/signal-point-manager/data/backups/before-20261014-19.db`。

## 控制柜模块表格扩展到可用宽度（20261014-20）

控制柜总览中的模块表格现在切换为全宽布局，填满右侧可用空间；项目和控制柜卡片仍使用原有网格布局。窄屏下表格保留横向滚动能力。

发布版本为 `signal-point-manager:20261014-20`。部署前后业务数据库摘要一致，SQLite 完整性检查通过。备份位于 `/opt/signal-point-manager/data/backups/before-20261014-20.db`。

## 点位表改为手动保存整个模块（20261015-1）

通道编辑时，部位、设备点位、信号类型、排序、删除和批量设置仅修改前端草稿。用户点击「保存」后，服务端在单个 SQLite 事务中提交本模块全部点位并同步删除已移除行；保存失败时回滚整批写入。未保存时离开或切换模块会提示确认，关闭/刷新页面会触发浏览器提醒。

发布版本为 `signal-point-manager:20261015-1`。部署前后业务数据库摘要一致，SQLite 完整性检查通过。备份位于 `/opt/signal-point-manager/data/backups/before-20261015-1.db`。

该功能后续补充：存在未保存草稿时，新建模块会先提醒处理草稿，导出会提示先保存或放弃，避免误将旧数据库数据当成当前编辑结果。

发布版本为 `signal-point-manager:20261015-2`。部署前后业务数据库摘要一致，SQLite 完整性检查通过。备份位于 `/opt/signal-point-manager/data/backups/before-20261015-2.db`。

## 柜子总览移除创建者列（20261015-3）

柜子总览的模块表格移除「创建者」列，并将表格最小宽度从 720px 调整为 620px。Service Worker 缓存版本升至 `spt-v35`，确保页面更新后重新获取最新脚本。发布镜像为 `signal-point-manager:20261015-3`；应用继续挂载原持久数据库目录，升级前在线备份位于 `/opt/signal-point-manager/data/backups/before-20261015-3.db`。

发布后通过严格 TLS 校验的真实浏览器访问 HTTPS 页面，状态码 200；柜内模块表头为「模块号 / 模块类型 / 模块型号 / 已用 / 备用 / 使用率 / 操作」，不再显示「创建者」。

## 信号类型配置表拖动排序（20261015-4）

信号类型配置表支持按住行上下拖动排序，触屏设备可长按拖动，键盘用户可聚焦排序手柄后按上下方向键。松开后顺序写入 SQLite；服务端要求提交完整且无重复的信号类型 ID 列表，并在事务中更新。Service Worker 缓存版本升至 `spt-v36`。

发布镜像为 `signal-point-manager:20261015-4`，数据库持续使用原有持久卷，升级前在线备份为 `/opt/signal-point-manager/data/backups/before-20261015-4.db`。线上 HTTPS 状态码为 200，浏览器证书校验通过；页面脚本、排序提示、缓存版本和信号类型读取接口均已核对。

## 信号类型表鼠标按住拖动修正（20261015-5）

将桌面排序改为按住行 180 毫秒后移动鼠标，避免表格原生拖放在输入控件附近不稳定；触屏仍使用长按拖动，键盘仍支持排序手柄的上下方向键。拖动结束自动保存顺序。Service Worker 缓存版本升至 `spt-v37`。

发布镜像为 `signal-point-manager:20261015-5`，继续使用原数据库持久卷，升级前在线备份为 `/opt/signal-point-manager/data/backups/before-20261015-5.db`。线上 HTTPS 返回 200 且浏览器证书校验通过；新脚本、缓存版本、38 行信号配置及对应排序手柄均已核对。隔离数据库真实鼠标事件测试确认排序成功写入数据库。
