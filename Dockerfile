# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app

# El repo se versiona con bun.lock (sin package-lock.json) -> npm instala
# desde package.json directamente.
COPY package.json ./
RUN npm install --legacy-peer-deps --no-audit --no-fund

COPY . .

# Variables de Supabase — build-time: Vite las hornea en el bundle.
# En Dokploy se configuran como Environment Variables (se pasan como build args).
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID

RUN npm run build

# ---- Serve stage ----
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
