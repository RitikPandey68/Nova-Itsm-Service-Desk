import redis
import logging
import socket
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

logger = logging.getLogger("itsm_database")
logging.basicConfig(level=logging.INFO)

# Helper function to check if a hostname is resolvable
def is_host_resolvable(host: str) -> bool:
    try:
        socket.gethostbyname(host)
        return True
    except Exception:
        return False

# ==========================================
# Mock Redis Client for Local Fallback
# ==========================================
class MockRedis:
    def __init__(self):
        self.store = {}
        logger.info("Mock Redis Cache initialized in-memory.")

    def get(self, key):
        return self.store.get(key)

    def set(self, key, value, ex=None):
        self.store[key] = str(value)
        return True

    def delete(self, key):
        if key in self.store:
            del self.store[key]
            return 1
        return 0

    def ping(self):
        return True

# ==========================================
# 1. PostgreSQL - Primary Transactional DB
# ==========================================
BasePostgres = declarative_base()

if is_host_resolvable(settings.POSTGRES_HOST):
    try:
        postgres_engine = create_engine(
            settings.postgres_url,
            pool_size=10,
            max_overflow=20,
            pool_pre_ping=True,
            connect_args={"connect_timeout": 3}
        )
        with postgres_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        logger.info("Successfully connected to primary PostgreSQL database.")
    except Exception as e:
        logger.warning(f"PostgreSQL connection failed ({e}). Falling back to local SQLite database.")
        postgres_engine = create_engine(
            "sqlite:///itsm_local.db",
            connect_args={"check_same_thread": False}
        )
else:
    logger.info("PostgreSQL host not resolvable. Falling back to local SQLite database.")
    postgres_engine = create_engine(
        "sqlite:///itsm_local.db",
        connect_args={"check_same_thread": False}
    )

PostgresSessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=postgres_engine
)

# ==========================================
# 2. MySQL - CMDB Asset Inventory DB
# ==========================================
BaseMysql = declarative_base()

if is_host_resolvable(settings.MYSQL_HOST):
    try:
        mysql_engine = create_engine(
            settings.mysql_url,
            pool_size=5,
            max_overflow=10,
            pool_pre_ping=True,
            connect_args={"connect_timeout": 3}
        )
        with mysql_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        logger.info("Successfully connected to CMDB MySQL database.")
    except Exception as e:
        logger.warning(f"MySQL connection failed ({e}). Falling back to local SQLite database.")
        mysql_engine = create_engine(
            "sqlite:///cmdb_local.db",
            connect_args={"check_same_thread": False}
        )
else:
    logger.info("MySQL host not resolvable. Falling back to local SQLite database.")
    mysql_engine = create_engine(
        "sqlite:///cmdb_local.db",
        connect_args={"check_same_thread": False}
    )

MysqlSessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=mysql_engine
)

# ==========================================
# 3. Redis Cache client
# ==========================================
if is_host_resolvable(settings.REDIS_HOST):
    try:
        redis_client = redis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            decode_responses=True,
            socket_connect_timeout=2
        )
        redis_client.ping()
        logger.info("Successfully connected to Redis cache cluster.")
    except Exception as e:
        logger.warning(f"Redis connection failed ({e}). Falling back to in-memory MockRedis cache.")
        redis_client = MockRedis()
else:
    logger.info("Redis host not resolvable. Falling back to in-memory MockRedis cache.")
    redis_client = MockRedis()

# ==========================================
# FastAPI DB Session Dependencies
# ==========================================
def get_db():
    """Dependency to get a PostgreSQL database session."""
    db = PostgresSessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_mysql_db():
    """Dependency to get a MySQL database session."""
    db = MysqlSessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_redis():
    """Dependency to get the Redis client."""
    return redis_client

