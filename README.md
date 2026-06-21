# NovaITSM - Enterprise ITIL Service Desk & ServiceNow PDI Sandbox

NovaITSM is a production-grade, highly interactive **IT Service Management (ITSM) Portal** and **Service Desk Command Center** built with Python (FastAPI), PostgreSQL, MySQL, Redis, and a premium Glassmorphic HTML5/CSS3/JavaScript frontend. 

This platform demonstrates core ITIL v4 operations (Incident, Problem, Change, Asset, and Access management) and features a live, interactive **ServiceNow Personal Developer Instance (PDI) Sandbox** to showcase advanced workflow automations, scripting, and external REST API integrations.

---

## 🚀 Key Features

### 1. Operations Command Center (Dashboard)
* **Real-time SLA Tracking**: Dynamic compliance calculations and breach alerts.
* **Mean Time to Resolve (MTTR)**: Automatic MTTR statistics gathered from ticket timestamps.
* **Aggregated Insights**: Live priority distribution charts and SLA monitoring using Chart.js.
* **Security Audit Ledger**: A transparent registry logging password resets, account lockouts, and critical ticket escalations.

### 2. ITIL Core Service Queues
* **Incident Management**: Submit, assign, escalate, and resolve incidents with automatic SLA deadlines.
* **Problem Management & RCAs**: Submit detailed Root Cause Analysis (RCA) logs directly linked to resolved problems to prevent future downtime.
* **Service Request Catalog**: Provision licenses, laptops, or VPN credentials with cost tracking and approval status.
* **CMDB Asset Inventory**: Track network devices, database clusters, servers, and developer machines linked dynamically from a mock CMDB.

### 3. Active Directory Self-Service Portal
* **AD Password Reset Simulation**: Mimics enterprise LDAP updates.
* **Lockout Protection**: Enforces brute-force defense by locking accounts in Redis after 3 consecutive failed login attempts.
* **Admin Unlock Overrides**: Allows administrators to unlock users via an administrative command console.

### 4. ServiceNow PDI Simulator Sandbox
A specialized developer testing suite simulating a ServiceNow workspace to enforce platform-level business logic:
* **Client Script Engine (`g_form`)**: Runs active onChange (Impact-Urgency priority matrix calculation) and onSubmit validation scripts in the browser.
* **UI Policy Controller**: Dynamically alters form states (e.g., hiding or making fields like *Resolution Code* mandatory depending on ticket state).
* **GlideSystem Business Rules**: Executes simulated server-side triggers before record creation (e.g., auto-routing groups by category) and after record updates (e.g., elevating critical SLAs).
* **Flow Designer Pipelines**: A visual canvas rendering step-by-step workflow stages (e.g., P1 Escalation Flow). Runs animated stage progressions.
* **Outbound REST API Sync Logger**: Formats and transmits JSON payloads to a mock external DevOps hub (e.g. Jira Service Desk), capturing the live request/response data block.

---

## 🛠️ Technology Stack

* **Backend Framework**: [FastAPI](https://fastapi.tiangolo.com/) (Python 3.10+)
* **Database Layer**: SQLAlchemy ORM with multi-database routing (PostgreSQL for ITSM transactions, MySQL for CMDB inventory, SQLite local fallback)
* **Caching & Timers**: Redis (Active Directory lockout logs and speed caching)
* **Containerization**: Docker & Docker Compose
* **Frontend Design**: Glassmorphic layout using Vanilla CSS, Custom CSS Variables (Dark theme), FontAwesome, and Chart.js

---

## 📋 Installation & Local Setup

### Prerequisites
* Python 3.10+
* Git
* (Optional) Docker & Docker Compose

### Step 1: Clone the Repository
```bash
git clone https://github.com/RitikPandey68/Nova-Itsm-Service-Desk.git
cd Nova-Itsm-Service-Desk
```

### Step 2: Configure Environment
Copy `.env.example` to `.env` and adjust database credentials if needed:
```bash
cp .env.example .env
```

### Step 3: Local Virtual Environment Setup
If running without Docker:
1. Create and activate virtual environment:
   ```bash
   python -m venv .venv
   # On Windows:
   .venv\Scripts\activate
   # On macOS/Linux:
   source .venv/bin/activate
   ```
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Seed mock database data (creates SQLite local DBs if Postgres/MySQL/Redis are not active):
   ```bash
   python seed.py
   ```
4. Spin up the FastAPI server:
   ```bash
   python -m uvicorn app.main:app --reload
   ```
   Open `http://localhost:8000` in your web browser.

---

## 🐳 Docker Deployment

To spin up the entire cluster (FastAPI web server, PostgreSQL, MySQL CMDB, and Redis cache):

```bash
# Start all containers
docker-compose up -d --build
```

To seed the docker databases with test data, run the seed script locally or run it inside the web container:
```bash
docker-compose exec web python seed.py
```

---

## 🔑 Mock AD Authentication Credentials

You can log in to the portal using any of the following pre-seeded Active Directory accounts:

| Username | Password | Role | Department |
| :--- | :--- | :--- | :--- |
| **administrator** | `ADPassword123!` | Admin | IT |
| **john.doe** | `FinancePassword456!` | User | Finance |
| **jane.smith** | `HRPassword789!` | Agent | HR |
| **operator.desk** | `DeskPassword321!` | Agent | IT Support |
