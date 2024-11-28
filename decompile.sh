#!/bin/bash

# 进入工作目录
cd /app

# 检查 pak01_dir.vpk 文件是否存在
if [ -f "./temp/pak01_dir.vpk" ]; then
    # 赋予 Decompiler 可执行权限
    chmod +x ./Decompiler
    # 执行 Decompiler 解包操作
    ./Decompiler -i "./temp/pak01_dir.vpk" -o "./static" -e "vtex_c" -d -f "panorama/images/econ"
else
    echo "pak01_dir.vpk not found, skipping decompilation"
fi
