FROM node:22.23.4-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY app.mjs node.mjs ./
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "node.mjs"]
