-- Market data hypertables migration for AI-powered Solana trading bot
-- Version: 2.0
-- Dependencies: TimescaleDB 2.11, V1__initial_schema.sql
-- Purpose: Creates and configures optimized time-series storage for market data and order books

-- Drop existing market data tables if they exist to ensure clean migration
DROP TABLE IF EXISTS market_data CASCADE;
DROP TABLE IF EXISTS order_book_snapshots CASCADE;

-- Create market data table with optimized column types
CREATE TABLE market_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trading_pair VARCHAR(20) NOT NULL,
    exchange VARCHAR(20) NOT NULL CHECK (exchange IN ('jupiter', 'pump_fun', 'drift')),
    price NUMERIC(18,8) NOT NULL CHECK (price > 0),
    volume NUMERIC(18,6) NOT NULL CHECK (volume > 0),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Convert market_data to hypertable with 1-day chunks
SELECT create_hypertable(
    'market_data',
    'timestamp',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE,
    migrate_data => TRUE
);

-- Create order book snapshots table with JSONB for bid/ask storage
CREATE TABLE order_book_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trading_pair VARCHAR(20) NOT NULL,
    exchange VARCHAR(20) NOT NULL CHECK (exchange IN ('jupiter', 'pump_fun', 'drift')),
    bids JSONB NOT NULL CHECK (jsonb_array_length(bids) > 0),
    asks JSONB NOT NULL CHECK (jsonb_array_length(asks) > 0),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Convert order_book_snapshots to hypertable with 1-hour chunks
SELECT create_hypertable(
    'order_book_snapshots',
    'timestamp',
    chunk_time_interval => INTERVAL '1 hour',
    if_not_exists => TRUE,
    migrate_data => TRUE
);

-- Create optimized indices for market data queries
CREATE INDEX idx_market_data_pair_time ON market_data (trading_pair, timestamp DESC);
CREATE INDEX idx_market_data_exchange_time ON market_data (exchange, timestamp DESC);
CREATE INDEX idx_market_data_price ON market_data (price) WHERE price > 0;

-- Create indices for order book queries
CREATE INDEX idx_order_book_pair_time ON order_book_snapshots (trading_pair, timestamp DESC);
CREATE INDEX idx_order_book_exchange_time ON order_book_snapshots (exchange, timestamp DESC);

-- Set up continuous aggregates for market data analytics
CREATE MATERIALIZED VIEW market_data_1m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 minute', timestamp) AS bucket,
    trading_pair,
    exchange,
    FIRST(price, timestamp) AS open_price,
    MAX(price) AS high_price,
    MIN(price) AS low_price,
    LAST(price, timestamp) AS close_price,
    SUM(volume) AS total_volume
FROM market_data
GROUP BY bucket, trading_pair, exchange
WITH NO DATA;

-- Set up continuous aggregates for order book analytics
CREATE MATERIALIZED VIEW order_book_depth_1m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 minute', timestamp) AS bucket,
    trading_pair,
    exchange,
    jsonb_array_length(bids) as bid_count,
    jsonb_array_length(asks) as ask_count
FROM order_book_snapshots
GROUP BY bucket, trading_pair, exchange
WITH NO DATA;

-- Configure retention policies (90 days for market data, 30 days for order books)
SELECT add_retention_policy('market_data', INTERVAL '90 days');
SELECT add_retention_policy('order_book_snapshots', INTERVAL '30 days');

-- Set up compression policies
SELECT add_compression_policy('market_data', INTERVAL '7 days');
SELECT add_compression_policy('order_book_snapshots', INTERVAL '24 hours');

-- Configure refresh policies for continuous aggregates
SELECT add_continuous_aggregate_policy('market_data_1m',
    start_offset => INTERVAL '1 hour',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute'
);

SELECT add_continuous_aggregate_policy('order_book_depth_1m',
    start_offset => INTERVAL '1 hour',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute'
);

-- Set up parallel query optimization
ALTER TABLE market_data SET (parallel_workers = 4);
ALTER TABLE order_book_snapshots SET (parallel_workers = 4);

-- Create statistics for query optimization
ANALYZE market_data;
ANALYZE order_book_snapshots;

-- Add comments for documentation
COMMENT ON TABLE market_data IS 'High-frequency market data points from multiple Solana DEXs';
COMMENT ON TABLE order_book_snapshots IS 'Order book state snapshots from Solana DEXs';
COMMENT ON MATERIALIZED VIEW market_data_1m IS 'One-minute OHLCV aggregates for market data';
COMMENT ON MATERIALIZED VIEW order_book_depth_1m IS 'One-minute order book depth metrics';