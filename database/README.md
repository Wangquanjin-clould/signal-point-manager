# 本地数据库快照

local-snapshot.db 是 2026-10-23 本机 data/signal-points.db 的 SQLite 在线一致性备份，包含 WAL 中的已提交业务数据。它不是 VPS 当前数据库。

用于公开仓库的快照已删除全部账号、登录会话并清空模块创建者引用，然后执行 secure_delete 和 VACUUM。原本机数据库没有修改。

重新生成：在项目目录运行 node deploy/snapshot-local-db.cjs。
恢复：停用本地应用，将快照复制为 data/signal-points.db；不要覆盖仍在运行的数据库及其 WAL。首次启动会按应用现有规则重新创建默认账号，请按部署说明修改密码。
