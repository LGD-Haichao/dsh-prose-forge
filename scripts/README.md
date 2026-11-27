# 在受限网络下推送

有些网络里 `github.com:443` 会被切断，`git push` 一直超时，但 `api.github.com` 还能通。
这种情况下用这个脚本，它走 GitHub 的 Git 数据 API 提交：建 blob、建 tree、建 commit、更新 ref，
效果和 `git push` 一样，只是提交由服务端生成。

```powershell
powershell -File scripts/push-via-api.ps1
```

前提：

- 本机 `git credential` 里已经存了能写这个仓库的 token（`git push` 成功过一次就有）
- 能连上 `api.github.com`

脚本做的事：

1. 从 `git credential fill` 读 token，不打印、不落盘
2. 取远端 `main` 的当前提交作为父提交
3. 把本地最新一次提交改到的文件逐个上传成 blob（base64，避免转义问题）
4. 以远端的 tree 为底，拼出新 tree
5. 建 commit，更新 `refs/heads/main`

注意两点：

- **提交号会不一样。** 服务端生成的提交和本地那个内容相同、哈希不同。本地会显示「领先远端」，
  等网络恢复后跑一次 `git fetch origin` 再 `git reset --hard origin/main` 就对齐了。
- **只提交最近一次提交涉及的文件。** 如果本地攒了好几个没推的提交，先把它们的内容整理到一次提交里，
  或者逐个提交分别推。

`api.github.com` 本身也可能被解析到无效地址。脚本里没有写死 IP，如果你的网络需要指定 IP，
在调用 `curl.exe` 的那几行前面加上 `--resolve api.github.com:443:<可用的IP>`。
