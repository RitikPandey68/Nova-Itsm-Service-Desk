from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, date

# ==========================================
# 1. Authentication & User Schemas
# ==========================================

class UserBase(BaseModel):
    username: str
    email: str
    role: str = "user"
    department: str = "IT"

class UserCreate(UserBase):
    password: str

class UserResponse(UserBase):
    id: int
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True

class UserLogin(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse

class TokenData(BaseModel):
    username: Optional[str] = None
    role: Optional[str] = None


# ==========================================
# 2. CMDB Asset Schemas (MySQL)
# ==========================================

class AssetBase(BaseModel):
    asset_tag: str
    name: str
    category: str
    model: str
    serial_number: str
    status: str = "In Stock"
    owner_email: Optional[str] = None
    purchase_date: Optional[date] = None
    cost: float = 0.0

class AssetCreate(AssetBase):
    pass

class AssetResponse(AssetBase):
    id: int

    class Config:
        from_attributes = True


# ==========================================
# 3. Incident Management Schemas
# ==========================================

class IncidentBase(BaseModel):
    title: str
    description: str
    priority: str = "P3"  # P1, P2, P3, P4
    category: str = "Software"  # Hardware, Software, Network, Access, Database
    cmdb_asset_id: Optional[int] = None

class IncidentCreate(IncidentBase):
    pass

class IncidentUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None  # New, Assigned, In Progress, Pending, Resolved, Closed
    assigned_agent_id: Optional[int] = None
    category: Optional[str] = None
    cmdb_asset_id: Optional[int] = None
    escalation_reason: Optional[str] = None

class IncidentResponse(BaseModel):
    id: int
    ticket_number: str
    title: str
    description: str
    priority: str
    status: str
    category: str
    sla_deadline: datetime
    sla_status: str
    requester_id: int
    requester: UserResponse
    assigned_agent_id: Optional[int] = None
    assigned_agent: Optional[UserResponse] = None
    cmdb_asset_id: Optional[int] = None
    asset: Optional[AssetResponse] = None  # Populated dynamically from MySQL
    created_at: datetime
    resolved_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    mttr_seconds: Optional[int] = None
    escalation_level: int
    escalation_reason: Optional[str] = None

    class Config:
        from_attributes = True


# ==========================================
# 4. Service Request Catalog Schemas
# ==========================================

class ServiceRequestBase(BaseModel):
    title: str
    description: str
    item_type: str  # Laptop Provisioning, Software License, VPN Access
    cost: float = 0.0

class ServiceRequestCreate(ServiceRequestBase):
    pass

class ServiceRequestUpdate(BaseModel):
    status: str  # Pending Approval, Approved, Fulfilled, Rejected

class ServiceRequestResponse(ServiceRequestBase):
    id: int
    ticket_number: str
    status: str
    requester_id: int
    requester: UserResponse
    created_at: datetime
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ==========================================
# 5. Root Cause Analysis (RCA) Schemas
# ==========================================

class RCABase(BaseModel):
    incident_id: int
    root_cause: str
    corrective_action: str
    preventative_action: str

class RCACreate(RCABase):
    pass

class RCAResponse(RCABase):
    id: int
    created_by_id: int
    created_at: datetime

    class Config:
        from_attributes = True


# ==========================================
# 6. Knowledge Base Schemas
# ==========================================

class KnowledgeArticleBase(BaseModel):
    title: str
    content: str
    category: str

class KnowledgeArticleCreate(KnowledgeArticleBase):
    pass

class KnowledgeArticleResponse(KnowledgeArticleBase):
    id: int
    author_id: int
    author: UserResponse
    views: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ==========================================
# 7. Audit Log & Active Directory Schemas
# ==========================================

class AuditLogResponse(BaseModel):
    id: int
    timestamp: datetime
    user_id: Optional[int] = None
    username: Optional[str] = None
    action: str
    details: str
    ip_address: Optional[str] = None
    status: str

    class Config:
        from_attributes = True

class ADPasswordResetRequest(BaseModel):
    username: str
    old_password: str
    new_password: str

# ==========================================
# 8. Dashboard Metrics Schemas
# ==========================================

class SLAStatusCount(BaseModel):
    active: int
    warning: int
    breached: int
    met: int

class PriorityCount(BaseModel):
    p1: int
    p2: int
    p3: int
    p4: int

class DashboardMetrics(BaseModel):
    total_open_incidents: int
    resolved_incidents_count: int
    sla_compliance_rate: float  # Percentage of Met SLAs vs Total Resolved
    avg_mttr_hours: float       # Mean Time to Resolve in hours
    unassigned_count: int
    escalated_count: int
    sla_stats: SLAStatusCount
    priority_stats: PriorityCount
    recent_audit_logs: List[AuditLogResponse]
