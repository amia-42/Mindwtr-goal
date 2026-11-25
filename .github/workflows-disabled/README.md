# 已临时停用的 workflow

GitHub 只读取 `.github/workflows/` 目录，因此本目录下的文件**不会被执行**。

## 当前生效的流程

只有一个：[`windows-ci.yml`](../workflows/windows-ci.yml)，内部两条互斥路径：

| 触发 | Job | 行为 | 产物 |
|---|---|---|---|
| `pull_request` → `master` / `main` | `verify` | 只做 Windows 端构建验证（原 `ci.yml` 的 `desktop-native-windows`）：`cargo test --locked`，`RUSTFLAGS=-C target-feature=-crt-static` | **无**（不上传、不发布） |
| `push` 标签 `v*-rc.*` | `preview` | `tauri build` 出 Windows 预览包 | `windows-preview-<label>` artifact（NSIS + 便携 zip，未签名，保留 14 天） |

即：**PR 只验证，不发布；预览包只由 `v*-rc.*` 标签触发。**

其余全部构建 / 发布 / 商店 / 定时 / 审计流程均在此目录中停用：

- 发布链路：`release.yml`、`release-rc.yml`、`release-windows.yml`、`release-macos.yml`、`release-linux.yml`、`release-android*.yml`、`release-ios-appstore.yml`、`release-macos-appstore.yml`、`release-msstore-flight.yml`
- 分发链路：`publish-repo.yml`、`publish-mcp.yml`、`update-flathub.yml`、`update-aur-beta.yml`、`bump-homebrew-cask.yml`、`docker-image-*.yml`
- 质量门禁：`ci.yml`、`native-platform-ci.yml`、`dependency-audit.yml`、`performance-baselines.yml`、`clock-shift.yml`、`wiki-sync.yml`
- 运维按钮：`rollout.yml`、`promote-rn-play-testing.yml`、`appstore-status.yml`、`msstore-flight-id.yml`、`debug-notary.yml`、`android-debug-build.yml`、`notify-release-confirmations.yml`

## 如何恢复

恢复全部（bash）：

```bash
git mv .github/workflows-disabled/*.yml .github/workflows/
```

恢复全部（PowerShell）：

```powershell
Get-ChildItem .github\workflows-disabled -Filter *.yml | ForEach-Object {
  git mv $_.FullName ".github\workflows\$($_.Name)"
}
```

只恢复单个（例如发布链路）：

```bash
git mv .github/workflows-disabled/release.yml .github/workflows/
git mv .github/workflows-disabled/release-windows.yml .github/workflows/
```

## 恢复前请注意

1. **恢复即生效**：这些 workflow 会立刻按各自的原始触发器工作——推送 `v*` 标签会真实发版，推送代码到 `main` 会真实跑全量门禁，定时任务会真实操作商店灰度。
2. **恢复后标签冲突**：`release-rc.yml` 也订阅 `v*-rc.*`，与 `windows-ci.yml` 的 `preview` job 会同时被触发。
3. **需要 Secrets**：官方发布链路依赖 Android keystore、GPG、Apple 证书、微软 Partner Center 凭据等；本仓库（`amia-42/Mindwtr-goal`）没有这些 secret，恢复后相关 job 会在 validate 阶段失败。
4. **仓库标识守卫**：`rollout.yml`、`release.yml` 的 `rollout-preflight`、`notify-release-confirmations.yml` 等带 `github.repository == 'dongdongbh/Mindwtr'` 判断，在本 fork 上会被跳过。
5. **治理脚本会缺文件**：`bun run governance` / `bun run test:governance` 中的 workflow 校验脚本读取 `.github/workflows/`，本目录启用期间这些检查会因缺少被检文件而失败。
6. **默认分支是 `master`**：本仓库没有 `main`；`windows-ci.yml` 已同时订阅 `master` 与 `main`。
