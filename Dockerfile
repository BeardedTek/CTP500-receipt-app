FROM node:22-alpine AS build
WORKDIR /app

COPY CTP500-React/package.json CTP500-React/package-lock.json ./
RUN npm ci

COPY CTP500-React/ ./
RUN npm run build

FROM nginx:1.27-alpine AS runtime
WORKDIR /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist ./

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
