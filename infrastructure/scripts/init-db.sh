#!/bin/bash

# Database initialization script for AI-powered Solana trading bot
# Version: 1.0
# Dependencies: PostgreSQL 15+, TimescaleDB 2.11+

set -euo pipefail

# Logging setup
LOG_FILE="/var/log/trading-bot/db-init.log"
mkdir -p "$(dirname "$LOG_FILE")"

log() {
    local level=$1
    shift
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] [$level] $*" | tee -a "$LOG_FILE"
}

# Function to check prerequisites
check_prerequisites() {
    log "INFO" "Checking prerequisites..."

    # Verify PostgreSQL installation and version
    if ! command -v psql &> /dev/null; then
        log "ERROR" "PostgreSQL client not found"
        exit 1
    fi

    PSQL_VERSION=$(psql --version | awk '{print $3}' | cut -d. -f1)
    if [ "$PSQL_VERSION" -lt 15 ]; then
        log "ERROR" "PostgreSQL version must be 15 or higher"
        exit 1
    }

    # Verify TimescaleDB tools
    if ! command -v timescaledb-tune &> /dev/null; then
        log "ERROR" "TimescaleDB tools not found"
        exit 1
    }

    # Validate environment variables
    required_vars=("POSTGRES_HOST" "POSTGRES_PORT" "POSTGRES_USER" "POSTGRES_PASSWORD" "POSTGRES_DB")
    for var in "${required_vars[@]}"; do
        if [ -z "${!var:-}" ]; then
            log "ERROR" "Required environment variable $var is not set"
            exit 1
        fi
    done

    # Check migration directory
    if [ ! -d "$MIGRATION_DIR" ]; then
        log "ERROR" "Migration directory $MIGRATION_DIR not found"
        exit 1
    }

    log "INFO" "Prerequisites check completed successfully"
}

# Function to create and configure database
create_database() {
    log "INFO" "Creating database $POSTGRES_DB..."

    # Connect to PostgreSQL and create database
    PGPASSWORD=$POSTGRES_PASSWORD psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d postgres <<EOF
CREATE DATABASE $POSTGRES_DB WITH 
    ENCODING = 'UTF8'
    LC_COLLATE = 'en_US.UTF-8'
    LC_CTYPE = 'en_US.UTF-8'
    TEMPLATE = template0;
EOF

    # Configure database parameters
    PGPASSWORD=$POSTGRES_PASSWORD psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<EOF
ALTER SYSTEM SET max_connections = '200';
ALTER SYSTEM SET shared_buffers = '1GB';
ALTER SYSTEM SET work_mem = '32MB';
ALTER SYSTEM SET maintenance_work_mem = '256MB';
ALTER SYSTEM SET effective_cache_size = '3GB';
ALTER SYSTEM SET synchronous_commit = 'off';
ALTER SYSTEM SET checkpoint_timeout = '10min';
ALTER SYSTEM SET max_wal_size = '2GB';
ALTER SYSTEM SET random_page_cost = '1.1';
ALTER SYSTEM SET effective_io_concurrency = '200';
ALTER SYSTEM SET statement_timeout = '300s';
ALTER SYSTEM SET idle_in_transaction_session_timeout = '60s';
ALTER SYSTEM SET deadlock_timeout = '1s';

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS uuid-ossp;
EOF

    log "INFO" "Database created and configured successfully"
}

# Function to run database migrations
run_migrations() {
    log "INFO" "Running database migrations..."

    # Create migrations tracking table
    PGPASSWORD=$POSTGRES_PASSWORD psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<EOF
CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
EOF

    # Execute migrations in transaction
    PGPASSWORD=$POSTGRES_PASSWORD psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<EOF
BEGIN;

\i $MIGRATION_DIR/V1__initial_schema.sql
\i $MIGRATION_DIR/V2__market_data_tables.sql
\i $MIGRATION_DIR/V3__strategy_tables.sql

INSERT INTO schema_migrations (version) VALUES 
    ('V1__initial_schema'),
    ('V2__market_data_tables'),
    ('V3__strategy_tables');

COMMIT;
EOF

    log "INFO" "Database migrations completed successfully"
}

# Function to configure TimescaleDB
configure_timescaledb() {
    log "INFO" "Configuring TimescaleDB..."

    PGPASSWORD=$POSTGRES_PASSWORD psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<EOF
-- Configure chunk time intervals
SELECT set_chunk_time_interval('market_data', INTERVAL '1 hour');
SELECT set_chunk_time_interval('order_book_snapshots', INTERVAL '1 hour');
SELECT set_chunk_time_interval('strategy_performance', INTERVAL '1 day');

-- Set up compression policies
SELECT add_compression_policy('market_data', INTERVAL '7 days');
SELECT add_compression_policy('order_book_snapshots', INTERVAL '24 hours');
SELECT add_compression_policy('strategy_performance', INTERVAL '7 days');

-- Configure retention policies
SELECT add_retention_policy('market_data', INTERVAL '90 days');
SELECT add_retention_policy('order_book_snapshots', INTERVAL '30 days');
SELECT add_retention_policy('strategy_performance', INTERVAL '90 days');

-- Set up continuous aggregates refresh policies
SELECT add_continuous_aggregate_policy('market_data_1m',
    start_offset => INTERVAL '1 hour',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute');

SELECT add_continuous_aggregate_policy('order_book_depth_1m',
    start_offset => INTERVAL '1 hour',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute');

-- Configure background workers
ALTER DATABASE $POSTGRES_DB SET timescaledb.max_background_workers = '8';
EOF

    log "INFO" "TimescaleDB configuration completed successfully"
}

# Main execution
main() {
    log "INFO" "Starting database initialization..."

    # Set default values for environment variables
    MIGRATION_DIR=${MIGRATION_DIR:-"src/backend/src/db/migrations"}
    export PGCONNECT_TIMEOUT=10

    # Run initialization steps
    check_prerequisites
    create_database
    run_migrations
    configure_timescaledb

    log "INFO" "Database initialization completed successfully"
}

main "$@"