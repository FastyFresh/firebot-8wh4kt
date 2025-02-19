# Stage 1: Rust Builder
FROM rust:1.70-slim-bullseye as rust-builder

# Install essential build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    pkg-config \
    libssl-dev \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set up cargo configuration for optimized builds
ENV RUSTFLAGS="-C target-cpu=native -C opt-level=3 -C lto=thin"
ENV CARGO_NET_GIT_FETCH_WITH_CLI=true

# Create build directory
WORKDIR /build

# Copy Rust project files
COPY Cargo.toml rust-toolchain.toml ./
COPY src ./src
COPY crates ./crates

# Build release version with optimizations
RUN cargo build --release --all-features \
    && strip target/release/solana_trading_bot

# Stage 2: Python Builder
FROM python:3.11-slim-bullseye as python-builder

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Set up Python environment
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PIP_NO_CACHE_DIR=1

WORKDIR /build

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && python -m compileall -o 2 /usr/local/lib/python3.11

# Copy and compile Python source files
COPY strategy_engine ./strategy_engine
RUN python -m compileall -o 2 ./strategy_engine

# Stage 3: Runtime
FROM debian:bullseye-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl1.1 \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -r -s /bin/false trading-bot

# Set up environment variables
ENV RUST_LOG=info
ENV RUST_BACKTRACE=1
ENV PYTHONUNBUFFERED=1
ENV PATH="/usr/local/bin:$PATH"

# Copy Python runtime
COPY --from=python-builder /usr/local/lib/python3.11 /usr/local/lib/python3.11
COPY --from=python-builder /usr/local/bin/python3.11 /usr/local/bin/python3.11
RUN ln -s /usr/local/bin/python3.11 /usr/local/bin/python

# Copy compiled artifacts
COPY --from=rust-builder /build/target/release/solana_trading_bot /usr/local/bin/
COPY --from=python-builder /build/strategy_engine /app/strategy_engine

# Set up working directory and permissions
WORKDIR /app
RUN chown -R trading-bot:trading-bot /app

# Switch to non-root user
USER trading-bot

# Expose ports for API and metrics
EXPOSE 8000 9090

# Set up health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Configure container capabilities
RUN setcap 'cap_net_bind_service=+ep' /usr/local/bin/solana_trading_bot

# Set security options
SECURITY_OPT="no-new-privileges:true"

# Set resource limits
ULIMIT nofile=65535
ULIMIT nproc=65535

# Configure TCP optimizations
ENV TCP_NODELAY=1
ENV TCP_NOPUSH=1

# Start the trading bot
CMD ["solana_trading_bot"]