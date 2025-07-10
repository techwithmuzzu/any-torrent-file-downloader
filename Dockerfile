FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p /app/downloads && chmod -R 777 /app/downloads

EXPOSE 3000 3001

CMD ["node", "index.js"]