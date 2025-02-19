-- Strategy tables migration for AI-powered Solana trading bot
-- Version: 3.0
-- Dependencies: V1__initial_schema.sql, TimescaleDB extension

-- Create enum types for strategy configuration
CREATE TYPE strategy_type AS ENUM ('grid', 'arbitrage', 'ml_based', 'hybrid');
CREATE TYPE strategy_state AS ENUM ('active', 'inactive', 'backtest', 'error', 'optimizing');

-- Create strategies table with comprehensive configuration
CREATE TABLE strategies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    strategy_type strategy_type NOT NULL,
    parameters JSONB NOT NULL CHECK (
        jsonb_typeof(parameters) = 'object' AND
        parameters ? 'risk_level' AND
        parameters ? 'max_position_size'
    ),
    state strategy_state NOT NULL DEFAULT 'inactive',
    trading_pairs TEXT[] NOT NULL CHECK (
        array_length(trading_pairs, 1) > 0 AND
        array_length(trading_pairs, 1) <= 10
    ),
    performance_score DECIMAL(10,4) NOT NULL DEFAULT 0 CHECK (
        performance_score >= 0 AND
        performance_score <= 100
    ),
    risk_parameters JSONB NOT NULL DEFAULT '{
        "max_drawdown_percent": 5,
        "stop_loss_percent": 2,
        "take_profit_percent": 5
    }' CHECK (
        jsonb_typeof(risk_parameters) = 'object' AND
        risk_parameters ? 'max_drawdown_percent' AND
        risk_parameters ? 'stop_loss_percent' AND
        risk_parameters ? 'take_profit_percent'
    ),
    ml_model_version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create hypertable for strategy performance tracking
CREATE TABLE strategy_performance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
    pnl DECIMAL(20,8) NOT NULL,
    trades_count INTEGER NOT NULL DEFAULT 0 CHECK (trades_count >= 0),
    win_rate DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (
        win_rate >= 0 AND
        win_rate <= 100
    ),
    sharpe_ratio DECIMAL(10,4),
    max_drawdown DECIMAL(5,2) CHECK (max_drawdown >= 0),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Convert to hypertable with 1-day chunks
SELECT create_hypertable('strategy_performance', 'timestamp', 
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Create strategy portfolio mappings table
CREATE TABLE strategy_portfolio_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
    portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    allocation_bps INTEGER NOT NULL CHECK (
        allocation_bps > 0 AND
        allocation_bps <= 10000
    ),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (strategy_id, portfolio_id)
);

-- Create indices for high-performance queries
CREATE INDEX idx_strategies_type_state ON strategies (strategy_type, state);
CREATE INDEX idx_strategies_performance ON strategies (performance_score DESC) WHERE state = 'active';
CREATE INDEX idx_strategy_performance_strategy ON strategy_performance (strategy_id, timestamp DESC);
CREATE INDEX idx_strategy_mappings_portfolio ON strategy_portfolio_mappings (portfolio_id) WHERE is_active = true;

-- Create BRIN index for time-series data
CREATE INDEX idx_strategy_performance_time_brin ON strategy_performance USING BRIN (timestamp) WITH (pages_per_range = 32);

-- Set up compression policy for performance data
SELECT add_compression_policy('strategy_performance', INTERVAL '7 days');

-- Add retention policy for performance data (90 days)
SELECT add_retention_policy('strategy_performance', INTERVAL '90 days');

-- Create trigger function for updating timestamps
CREATE OR REPLACE FUNCTION update_strategy_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add update triggers
CREATE TRIGGER update_strategies_timestamp
    BEFORE UPDATE ON strategies
    FOR EACH ROW
    EXECUTE FUNCTION update_strategy_timestamp();

CREATE TRIGGER update_strategy_mappings_timestamp
    BEFORE UPDATE ON strategy_portfolio_mappings
    FOR EACH ROW
    EXECUTE FUNCTION update_strategy_timestamp();

-- Create trigger for strategy state transitions
CREATE OR REPLACE FUNCTION validate_strategy_state_transition()
RETURNS TRIGGER AS $$
BEGIN
    -- Prevent direct transition from 'inactive' to 'active' without backtest
    IF OLD.state = 'inactive' AND NEW.state = 'active' AND 
       NOT EXISTS (
           SELECT 1 FROM strategy_performance 
           WHERE strategy_id = NEW.id AND 
           timestamp > NOW() - INTERVAL '24 hours'
       ) THEN
        RAISE EXCEPTION 'Strategy must complete backtest before activation';
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER strategy_state_transition
    BEFORE UPDATE OF state ON strategies
    FOR EACH ROW
    EXECUTE FUNCTION validate_strategy_state_transition();

-- Create trigger for validating portfolio allocations
CREATE OR REPLACE FUNCTION validate_portfolio_allocations()
RETURNS TRIGGER AS $$
BEGIN
    -- Check total allocation doesn't exceed 100%
    IF (
        SELECT SUM(allocation_bps)
        FROM strategy_portfolio_mappings
        WHERE portfolio_id = NEW.portfolio_id
        AND is_active = true
        AND id != NEW.id
    ) + NEW.allocation_bps > 10000 THEN
        RAISE EXCEPTION 'Total portfolio allocation cannot exceed 100%';
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER check_portfolio_allocations
    BEFORE INSERT OR UPDATE ON strategy_portfolio_mappings
    FOR EACH ROW
    EXECUTE FUNCTION validate_portfolio_allocations();

-- Add comments for documentation
COMMENT ON TABLE strategies IS 'Core trading strategy configurations with ML model support';
COMMENT ON TABLE strategy_performance IS 'Time-series performance metrics for trading strategies';
COMMENT ON TABLE strategy_portfolio_mappings IS 'Maps strategies to portfolios with allocation control';