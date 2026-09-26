FROM node:20-alpine

LABEL maintainer="darkver8"
LABEL description="Cosmo 2FA - Modern Self-hosted Multi-device 2FA Authenticator"

WORKDIR /app

# 安装 curl 用于健康检查
RUN apk add --no-cache curl

# 复制必要文件
COPY package.json ./
COPY server.js db.js index.html style.css app.js ./

# 创建持久化数据目录并赋予非 root 的 node 用户权限
RUN mkdir -p /app/data && chown -R node:node /app

VOLUME ["/app/data"]

USER node

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
