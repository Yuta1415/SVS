# Build stage
FROM node:20-alpine AS build
WORKDIR /app
# The API origin is baked into the JS bundle at build time, so it has to be a
# build arg, not a runtime env var. Vite only exposes the VITE_ prefixed vars.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Production stage
FROM nginx:stable-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
