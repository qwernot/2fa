FROM nginx:alpine

# 拷贝静态资源到 Nginx 默认静态目录
COPY . /usr/share/nginx/html/

# 暴露 80 端口
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
