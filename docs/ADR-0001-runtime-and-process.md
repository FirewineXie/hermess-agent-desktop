# ADR-0001：I0 Windows 运行时与进程边界

日期：2026-10-24。状态：I0 验证中；只适用于锁定的上游提交 `5894e750c3dba980d43b25aa29e3958149ba2c61`。

## 当前选择

- 产品仓库以 Git submodule 固定上游，不在其工作树修改源码。`pnpm verify:upstream` 校验锁文件、submodule 指针、HEAD 与工作树。
- Windows 样机使用 `hermes serve --host 127.0.0.1 --port 0 --isolated`。Rust 进程创建子进程，提供每次启动的随机 WS 凭据、独立 `HERMES_HOME`、私有锁目录与就绪文件；只持有并停止自己创建的子进程。
- 开发态可在产品 `.build` 内用已有 CPython 3.14 构建隔离 venv。上游 `pm.operations.build_environment` 负责依赖同步，`uv.lock` 固定应用依赖；该路径已在 Windows 实测。
- 上游 `pm bundle` 已在 Windows 生成包含仓库快照、固定工具、PM runtime、venv、离线 uv 缓存和启动器的完整 payload。`scripts/verify-payload.py` 用固定提交的 Git archive 对比 payload 的发行源码。

## 已核实的边界

1. `HERMES_DESKTOP_READY_FILE` 只公布端口。端口本身不是归属证明；必须结合本进程持有的子进程句柄与每次启动凭据。
2. 固定提交的专用 `serve` 路线通过 loopback `/api/ws` 接受 `HERMES_DASHBOARD_SESSION_TOKEN`。正确凭据通过、错误凭据被拒绝；正式产品还需验证多实例、残留进程和官方 Hermes 并行共存。
3. WS 断线时上游可停放会话。恢复必须使用 `session.create` 返回的 `stored_session_id` 调 `session.resume`，其结果返回运行时 `session_id`。开发态 UI 提供手动重连；脚本在流式输出中途断线后重附着同一运行时会话。
4. `session.events.since` 提供序号、epoch、截断标记与未完成请求。脚本已验证水位；当前 UI 尚未按序号渲染重放，因此不宣称无缝重放。
5. 当前完整 Windows payload 为 6,181,600,280 字节、117,396 个文件：`tools` 3,809,950,489、`venv` 1,237,231,531、`uv-cache` 991,590,926、`hermes-agent` 141,523,794、`pm-runtime` 2,577,494 字节。这是上游全量 bundle，不是首版最小核心包。
6. payload 内置 CPython 3.14.9；开发态复用本机 CPython 3.14.0 的隔离 venv 是另一条路径。不能把全量 bundle 的成功冒充“payload 复用了本机解释器”。
7. 首次全量 bundle 直接执行 `pm.cli`，其构建入口使用了这台机器现有的 Hermes PM runtime。`scripts/build-payload.py` 已将后续构建入口指向产品 `.build/pm-bootstrap` 的私有 `HERMES_HOME` 和 `HERMES_RUNTIME_DIR`；私有入口的 `pm status` 已运行，工具和 PM 状态落在该私有目录。这个新入口尚未完成一次全量 bundle 验证。

## 验证证据与剩余决策

- payload 启动器在独立临时数据根、`HERMES_DISABLE_LAZY_INSTALLS=1`、不可达公共代理条件下，通过鉴权、流式对话、文件工具、审批拒绝、澄清、运行中断和断线重附着脚本测试。假模型仅通过 loopback 提供回答；该实验没有证明系统物理断网。
- 需用上游 PM/组装接口把核心包与可选工具分层，保持可离线修复和锁定版本。拆分后的每种布局都要重新执行源码、manifest、启动、工具和更新验收。
- 需验证中文、空格、非默认存储位置、权限、多实例和现有官方 Hermes 并行。macOS arm64、Linux x64 与 Intel Mac 仍待原生设备或 CI 资源。
- 正式构建应记录上游 SHA、manifest 摘要、工具 facts、Python/Node 来源、平台和签名材料；当前上游 manifest 的 `ref` 为 `HEAD`，不能单独当作提交身份。
