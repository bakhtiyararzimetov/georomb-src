# API для WhatsApp-бота (server/). Сборка: docker build -t georomb-api .
# Запуск: docker run -p 3000:3000 -e API_KEYS=<ключ> georomb-api
FROM node:26-slim
WORKDIR /srv
ENV NODE_ENV=production PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
# сервер берёт чертёж и расчёты из app/src — копируем только нужное
COPY app/src app/src
COPY server/src server/src
COPY server/openapi.json server/openapi.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--no-experimental-webstorage", "server/src/main.ts"]
