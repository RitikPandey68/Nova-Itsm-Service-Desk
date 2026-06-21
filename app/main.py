import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.database import BasePostgres, postgres_engine, BaseMysql, mysql_engine
from app.routers import auth, incidents, requests, assets, knowledge, dashboard, servicenow

# 1. Lifespan event handler for database auto-migration on startup
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables in PostgreSQL
    BasePostgres.metadata.create_all(bind=postgres_engine)
    # Create tables in MySQL
    BaseMysql.metadata.create_all(bind=mysql_engine)
    yield
    # Shutdown logic (if any) could go here

# 2. Initialize FastAPI Application
app = FastAPI(
    title="IT Service Desk & ITSM Dashboard",
    description="Production-grade ITSM and Service Desk platform supporting ITIL incident/problem/change management.",
    version="1.0.0",
    lifespan=lifespan
)

# 3. Configure CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 4. Include API Routers under prefix /api
app.include_router(auth.router, prefix="/api")
app.include_router(incidents.router, prefix="/api")
app.include_router(requests.router, prefix="/api")
app.include_router(assets.router, prefix="/api")
app.include_router(knowledge.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(servicenow.router, prefix="/api")

# 5. Serve static files
# Ensure static directory exists
static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)

# Mount static folder for CSS, JS, images
app.mount("/static", StaticFiles(directory=static_dir), name="static")

# Serve index.html at root
@app.get("/")
async def read_index():
    return FileResponse(os.path.join(static_dir, "index.html"))

# 6. Health check endpoint for Docker Compose
@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "itsm-backend"}
