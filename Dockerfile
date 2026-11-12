# Nestory —— 一个镜像 = 前端 dist + Python 后端，单端口 8000。
#
# 本地开发不受影响（仍是 npm run dev + python backend/server.py）；
# 这个镜像是给 Sealos / 任何容器平台用的：容器起来后 / 是前端，/api/* 是后端。
#
#   docker build -t nestory:latest .
#   docker run -p 8000:8000 \
#     -e NESTORY_DB_HOST=... -e NESTORY_DB_USER=... -e NESTORY_DB_PASSWORD=... \
#     -e NESTORY_DB_NAME=nestory -e NESTORY_COOKIE_SECURE=1 \
#     -e NESTORY_LLM_API_KEY=... nestory:latest

# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- 1) 前端
FROM node:22-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run build

# ---------------------------------------------------------------- 2) 运行
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    NESTORY_STATIC_DIR=/app/dist

WORKDIR /app
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend ./backend
COPY --from=web /app/dist ./dist

# 不用 root 跑；日志走 stdout（--no-log-file），交给平台收集
RUN useradd --system --create-home --uid 10001 nestory \
 && chown -R nestory:nestory /app
USER nestory

EXPOSE 8000

# 表结构会在启动时自动建（db.init_schema），托管 MySQL 只需一个空库 + 有权限的账号
CMD ["python", "backend/server.py", "--host", "0.0.0.0", "--port", "8000", "--no-log-file"]
