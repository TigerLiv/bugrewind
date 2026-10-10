FROM node:24-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production HOST=127.0.0.1
EXPOSE 4177
CMD ["node","src/server.js"]
# Local-only by design: do not expose using Docker -p or a public proxy before adding production authentication.
