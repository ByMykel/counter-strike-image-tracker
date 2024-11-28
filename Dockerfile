# 使用官方的 Ubuntu 镜像
FROM ubuntu:latest

# 设置工作目录
WORKDIR /app

# 安装所需的工具和依赖
RUN apt-get update && apt-get install -y \
    libicu-dev \
    curl \
    wget \
    vim \
    git \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 复制你的脚本到容器内
COPY ./libSkiaSharp.so /app/libSkiaSharp.so
COPY ./Decompiler /app/Decompiler
COPY ./decompile.sh /app/decompile.sh
RUN chmod +x /app/decompile.sh

# 设置容器启动时执行的命令
CMD ["bash", "/app/decompile.sh"]
