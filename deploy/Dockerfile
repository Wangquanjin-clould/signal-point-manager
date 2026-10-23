FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
WORKDIR /app
COPY package.json server.js db.js ./
COPY public ./public
ENV HOST=0.0.0.0 PORT=8787 DATA_DIR=/data ALLOW_REGISTER=0
USER node
EXPOSE 8787
CMD ["node", "server.js"]
