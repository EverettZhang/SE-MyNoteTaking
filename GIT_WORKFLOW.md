# Git 工作流程

本仓库使用 `Dev` 汇集日常开发，`main` 保存准备发布的版本。现有提交历史采用 `Dev` → `main` 的 Pull Request（PR）合并方式。每项功能或修复从 `Dev` 创建独立分支，完成后先向 `Dev` 提 PR；准备发布时，再由 `Dev` 向 `main` 提 PR。

以下命令适用于 Windows PowerShell，并假设远程仓库名为 `origin`。运行命令前先进入仓库根目录。

## 1. 开始一项工作

先检查本地是否有未提交的修改：

```powershell
git status --short --branch
```

如果输出列出了修改，先完成并提交当前工作，或用 `git stash push -u -m "暂存当前工作"` 暂存；切换分支后可以用 `git stash pop` 取回。不要在不清楚改动归属时丢弃它们。

先获取远程更新，检查 `main` 中是否有尚未进入 `Dev` 的提交：

```powershell
git fetch origin
git log --oneline origin/Dev..origin/main
```

`Dev` 在一次发布合并后可能落后于 `main`；如果列出的提交包含本次工作需要的改动，先通过 PR 将 `main` 同步到 `Dev`，再继续。

从远程 `Dev` 创建自己的工作分支：

```powershell
git fetch origin
git switch -c feat/short-description origin/Dev
```

将 `feat/short-description` 换成具体名称，例如 `feat/note-tags`。修复问题可用 `fix/issue-name`，文档更新可用 `docs/topic-name`。如果同名本地分支已存在，使用 `git switch <分支名>`，不要重复创建，也不要直接在 `main` 上开发。

## 2. 开发、检查和提交

保持一次提交只解决一个清晰的问题。提交前检查改动范围：

```powershell
git status --short
git diff --check
git diff
```

Python 环境已配置时，可运行项目的单元测试：

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

应用导入时需要 `DATABASE_URL`，可由仓库根目录的 `.env` 提供。真实 Neon 集成测试需要自己的测试数据库和 `RUN_NEON_INTEGRATION=1`，不要对生产库运行测试或初始化命令。

只暂存本次任务的文件，再提交：

```powershell
git add path/to/changed-file
git diff --cached
git commit -m "feat: add note tags"
```

提交信息建议用 `feat:`、`fix:`、`docs:`、`test:` 或 `chore:` 开头，后面用一句话说明结果。`.env`、`.env.local`、虚拟环境和 `node_modules` 已被忽略；不要强制添加密钥或本地依赖目录。

## 3. 同步并提交 PR

在推送前同步目标分支，解决可能出现的冲突：

```powershell
git fetch origin
git merge origin/Dev
```

如果 Git 报冲突，编辑冲突文件并检查最终内容，然后运行 `git add <冲突文件>` 和 `git commit` 完成合并。再次运行相关测试。不要用 `git reset --hard` 或强制推送来跳过冲突。

推送你的工作分支：

```powershell
git push -u origin feat/short-description
```

在 GitHub 创建 PR，**base 选 `Dev`，compare 选你的工作分支**。PR 描述写清改动目的、主要行为、测试结果，以及是否涉及数据库或环境变量。完成审查并合并后，下一项工作重新从最新的 `origin/Dev` 建分支。

## 4. 从 `Dev` 发布到 `main`

确认 `Dev` 中准备发布的改动和测试结果，然后在 GitHub 创建 **base 为 `main`、compare 为 `Dev`** 的 PR。合并后先确认线上部署和核心功能，再将 `main` 新产生的提交同步回 `Dev`，避免两个长期分支逐渐分叉。

## 常用检查命令

```powershell
git status --short --branch   # 当前分支及未提交改动
git log --oneline -5          # 最近五次提交
git diff --check              # 空白和补丁格式问题
git branch -vv                # 本地分支及其跟踪的远程分支
```
