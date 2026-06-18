import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import computed_field

class Settings(BaseSettings):
    # Application Settings
    SECRET_KEY: str = "supersecretkeyfortestingitsmdevelopment2026!"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    # PostgreSQL Database Configuration
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "postgrespassword"
    POSTGRES_DB: str = "itsm_db"
    POSTGRES_HOST: str = "db_postgres"
    POSTGRES_PORT: int = 5432

    # MySQL Database Configuration
    MYSQL_ROOT_PASSWORD: str = "mysqlrootpassword"
    MYSQL_DATABASE: str = "cmdb_db"
    MYSQL_USER: str = "cmdb_user"
    MYSQL_PASSWORD: str = "cmdb_password"
    MYSQL_HOST: str = "db_mysql"
    MYSQL_PORT: int = 3306

    # Redis Cache Configuration
    REDIS_HOST: str = "cache_redis"
    REDIS_PORT: int = 6379

    @computed_field
    @property
    def postgres_url(self) -> str:
        return f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"

    @computed_field
    @property
    def mysql_url(self) -> str:
        return f"mysql+pymysql://{self.MYSQL_USER}:{self.MYSQL_PASSWORD}@{self.MYSQL_HOST}:{self.MYSQL_PORT}/{self.MYSQL_DATABASE}"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
