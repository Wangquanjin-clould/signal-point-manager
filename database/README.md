# 本地数据库快照

local-snapshot.db 是 2026-10-23 本机 data/signal-points.db 的 SQLite 在线一致性备份，包含 WAL 中的已提交业务数据。它不是 VPS 当前数据库。

用于公开仓库的快照已删除全部账号、登录会话并清空模块创建者引用，然后执行 secure_delete 和 VACUUM。原本机数据库没有修改。

重新生成：在项目目录运行 node deploy/snapshot-local-db.cjs。
恢复：停用本地应用，将快照复制为 data/signal-points.db；不要覆盖仍在运行的数据库及其 WAL。首次启动会按应用现有规则重新创建默认账号，请按部署说明修改密码。

## VPS 数据库备份（2026-10-23）

- 文件：vps-snapshot-20261023.db
- 生成时间：2026-10-23 09:06:06（北京时间）
- 来源：生产容器 signal-point-manager 的 /data/signal-points.db；通过 SQLite 在线备份接口生成一致性快照，包含当时 WAL 中的已提交数据。
- 内容：7 个项目、10 个模块、80 个点位。与本目录的 local-snapshot.db 分开保存。
- 公开仓库脱敏：仅对快照删除全部账号、登录会话，并将模块创建者引用置空；开启 secure_delete 后 VACUUM，切换 DELETE 日志模式，备份无需 WAL/SHM 文件。
- 清除账号前后业务数据摘要一致，完整性和外键检查通过；下载后 SHA-256 与服务器端一致。校验记录见同名 JSON 文件。
- VPS 原数据库和服务没有修改。备份不保留原账号，恢复后需按应用规则创建账号、修改默认密码；业务数据恢复前先停止目标应用并单独备份目标数据，避免与旧 WAL 混用。

生成脚本 deploy/backup-vps-public.cjs 可在容器内执行：node backup-vps-public.cjs /tmp/snapshot.db。输出 JSON 校验记录；脚本只读打开源数据库，写入独立快照。
