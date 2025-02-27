#!/bin/bash


# 配置自动合并不进行交互
git config --global pull.rebase false
git config --global push.default simple

# 获取最新的远程数据
git fetch origin

# 强制合并远程分支到本地
git merge origin/main --no-edit
