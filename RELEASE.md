# Release Guide

本文档描述 fluss-hook 插件的版本管理与发布流程。

## 版本号规范

遵循 [Semantic Versioning](https://semver.org/):

```
MAJOR.MINOR.PATCH
```

- **PATCH** (0.1.0 -> 0.1.1): 向后兼容的 bug 修复
- **MINOR** (0.1.0 -> 0.2.0): 向后兼容的新功能
- **MAJOR** (0.1.0 -> 1.0.0): 不兼容的 API 变更

Git tag 格式: `v{VERSION}`, 如 `v0.2.0`。

## main 分支版本号约定

`main` 分支 `package.json` 中的版本号始终等于最新发布的版本。
日常开发期间不做版本号变更，仅在准备发版时 bump 一次。

```
v0.1.0 已发布 → main 上保持 0.1.0
日常开发提交...
准备发版 → 修改为 0.1.5 → 提交 → 创建 Release v0.1.5
main 上保持 0.1.5 → 继续开发...
```

## 发布流程

### 1. 确认代码就绪

确保 `main` 分支上所有变更已合并，CI 通过:

```bash
pnpm typecheck
pnpm test
```

### 2. 修改版本号

编辑 `package.json` 中的 `version` 字段:

```json
{
  "version": "0.2.0"
}
```

### 3. 提交版本变更

```bash
git add package.json
git commit -m "chore: release v0.2.0"
git push origin main
```

### 4. 在 GitHub 上创建 Release

1. 打开 [GitHub Releases 页面](https://github.com/beryllw/openclaw-fluss-hook/releases/new)
2. 点击 **Choose a tag**, 输入新 tag (如 `v0.2.0`), 选择 **Create new tag on publish**
3. **Target**: 选择 `main` 分支
4. **Release title**: `v0.2.0`
5. **Release notes**: 填写本次变更内容, 例如:
   ```
   ## What's Changed
   - feat: 新增 xxx 功能
   - fix: 修复 xxx 问题
   ```
6. 点击 **Publish release**

### 5. CI 自动完成

Release 发布后, GitHub Actions ([release.yml](.github/workflows/release.yml)) 会自动:

1. 运行 `scripts/package-release.sh` 打包
2. 生成 `fluss-hook-v0.2.0.tar.gz`
3. 将 tarball 上传到 Release Assets

### 6. 验证

- 检查 [Actions](https://github.com/beryllw/openclaw-fluss-hook/actions) 确认 workflow 成功
- 检查 Release 页面确认 tarball 已上传
- 下载 tarball 验证内容完整性:
  ```bash
  tar tzf fluss-hook-v0.2.0.tar.gz
  ```

## 产物说明

每次发版生成一个通用安装包 (无平台差异):

```
fluss-hook-v{VERSION}.tar.gz
├── index.ts
├── package.json
├── tsconfig.json
├── openclaw.plugin.json
├── install.sh
├── README.md
└── src/
    ├── sink.ts
    ├── config.ts
    ├── event-mappers.ts
    ├── fluss-client.ts
    ├── message-buffer.ts
    ├── schema.ts
    └── types.ts
```

用户安装方式:

```bash
tar xzf fluss-hook-v0.2.0.tar.gz
cd fluss-hook-v0.2.0
./install.sh ~/.openclaw --gateway-url http://your-gateway:8080
```

## Checklist

发版前对照检查:

- [ ] CI 全部通过 (typecheck + test)
- [ ] `package.json` 中 `version` 已更新
- [ ] 版本变更已提交并推送到 `main`
- [ ] GitHub Release 创建, tag 格式为 `v{VERSION}`
- [ ] Release workflow 执行成功, tarball 已上传
