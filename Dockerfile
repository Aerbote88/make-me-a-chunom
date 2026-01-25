# Dockerfile for make-me-a-hanzi-tool
# Uses Meteor 3.1 with Node.js 20

FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies for Meteor
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    python3 \
    build-essential \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Meteor 3.1
ENV METEOR_ALLOW_SUPERUSER=1
RUN curl https://install.meteor.com/ | sh

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package.json ./
COPY .meteor .meteor/

# Install npm dependencies
RUN meteor npm install

# Copy application files
COPY . .

# Expose port
EXPOSE 3000

# Start Meteor
CMD ["meteor", "run", "--port", "3000"]
