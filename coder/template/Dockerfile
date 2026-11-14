# Workspace image for Scammer's View: Node 22 (process.loadEnvFile, tsx --test), git, curl.
FROM node:22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends git curl ca-certificates sudo \
  && rm -rf /var/lib/apt/lists/*

# Coder runs the agent as this user; uid 1000 already exists as "node" in the base image.
RUN usermod -l coder -d /home/coder -m node \
  && groupmod -n coder node \
  && echo "coder ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/coder

USER coder
WORKDIR /home/coder
