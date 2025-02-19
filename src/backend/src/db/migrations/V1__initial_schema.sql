-- Initial database schema migration for AI-powered Solana trading bot
-- Version: 1.0
-- Dependencies: TimescaleDB extension

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "timescaledb";

-- Market data time-series table with hypertable configuration
CREATE TABLE market_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trading_pair VARCHAR(20) NOT NULL,
    exchange VARCHAR(20) NOT NULL,
    price NUMERIC(18,8) NOT NULL CHECK (price > 0),
    volume NUMERIC(18,6) NOT NULL CHECK (volume > 0),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Convert to hypertable with 1-day chunks
SELECT create_hypertable('market_data', 'timestamp', 
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Create indices for market data queries
CREATE INDEX idx_market_data_pair_time ON market_data (trading_pair, timestamp DESC);
CREATE INDEX idx_market_data_exchange_time ON market_data (exchange, timestamp DESC);

-- Set up compression policy for market data
SELECT add_compression_policy('market_data', INTERVAL '7 days');

-- Create continuous aggregates for different time intervals
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
GROUP BY bucket, trading_pair, exchange;

-- Portfolio management table
CREATE TABLE portfolios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_address VARCHAR(44) NOT NULL UNIQUE,
    usdc_balance NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (usdc_balance >= 0),
    risk_params JSONB NOT NULL DEFAULT '{
        "max_position_size_percent": 5,
        "max_daily_drawdown_percent": 3,
        "stop_loss_percent": 2
    }',
    performance_metrics JSONB NOT NULL DEFAULT '{
        "total_trades": 0,
        "win_rate": 0,
        "average_return": 0
    }',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trading positions table
CREATE TABLE positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    portfolio_id UUID NOT NULL REFERENCES portfolios(id),
    trading_pair VARCHAR(20) NOT NULL,
    size NUMERIC(18,8) NOT NULL CHECK (size > 0),
    entry_price NUMERIC(18,8) NOT NULL CHECK (entry_price > 0),
    current_price NUMERIC(18,8) NOT NULL CHECK (current_price > 0),
    unrealized_pnl NUMERIC(20,6) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('OPEN', 'CLOSED', 'LIQUIDATED')),
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ML strategy management table
CREATE TABLE strategies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('ACTIVE', 'PAUSED', 'BACKTEST', 'DEPRECATED')),
    model_params JSONB NOT NULL,
    performance_metrics JSONB NOT NULL DEFAULT '{
        "sharpe_ratio": 0,
        "sortino_ratio": 0,
        "max_drawdown": 0
    }',
    training_data JSONB,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trade execution history
CREATE TABLE trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    position_id UUID NOT NULL REFERENCES positions(id),
    strategy_id UUID NOT NULL REFERENCES strategies(id),
    trading_pair VARCHAR(20) NOT NULL,
    exchange VARCHAR(20) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('MARKET', 'LIMIT', 'STOP_LOSS', 'TAKE_PROFIT')),
    side VARCHAR(4) NOT NULL CHECK (side IN ('BUY', 'SELL')),
    size NUMERIC(18,8) NOT NULL CHECK (size > 0),
    price NUMERIC(18,8) NOT NULL CHECK (price > 0),
    fee NUMERIC(18,8) NOT NULL CHECK (fee >= 0),
    transaction_hash VARCHAR(88),
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indices for performance optimization
CREATE INDEX idx_positions_portfolio ON positions(portfolio_id, status);
CREATE INDEX idx_trades_position ON trades(position_id, executed_at DESC);
CREATE INDEX idx_trades_strategy ON trades(strategy_id, executed_at DESC);
CREATE INDEX idx_strategies_status ON strategies(status, updated_at DESC);

-- Add retention policy for market data (90 days)
SELECT add_retention_policy('market_data', INTERVAL '90 days');

-- Create audit trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add update triggers for timestamp management
CREATE TRIGGER update_portfolios_timestamp
    BEFORE UPDATE ON portfolios
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_positions_timestamp
    BEFORE UPDATE ON positions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_strategies_timestamp
    BEFORE UPDATE ON strategies
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add row-level security policies
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

-- Create policies for portfolio access
CREATE POLICY portfolio_access_policy ON portfolios
    FOR ALL
    TO authenticated_users
    USING (wallet_address = current_user);

-- Create policies for position access
CREATE POLICY position_access_policy ON positions
    FOR ALL
    TO authenticated_users
    USING (
        portfolio_id IN (
            SELECT id FROM portfolios 
            WHERE wallet_address = current_user
        )
    );

-- Create policies for trade access
CREATE POLICY trade_access_policy ON trades
    FOR ALL
    TO authenticated_users
    USING (
        position_id IN (
            SELECT p.id FROM positions p
            JOIN portfolios pf ON p.portfolio_id = pf.id
            WHERE pf.wallet_address = current_user
        )
    );