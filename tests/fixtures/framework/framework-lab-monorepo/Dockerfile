FROM oven/bun:1.1
WORKDIR /repo
COPY package.json bunfig.toml ./
COPY . .
RUN bun install --frozen-lockfile || bun install
CMD ["bun", "test"]
