# Build stage
FROM node:20-alpine as build
WORKDIR /app
# The API origin is baked into the JS bundle at build time, so it has to be a
# build arg, not a runtime env var.
ARG REACT_APP_API_URL
ENV REACT_APP_API_URL=$REACT_APP_API_URL
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Production stage
FROM nginx:stable-alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
