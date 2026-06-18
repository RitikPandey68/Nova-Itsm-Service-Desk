import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Float, ForeignKey, Text, Date
from sqlalchemy.orm import relationship

from app.database import BasePostgres, BaseMysql

# ==========================================
# 1. PostgreSQL Models (ITSM Primary DB)
# ==========================================

class User(BasePostgres):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, default="user")  # admin, agent, user
    department = Column(String, default="IT")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    requested_incidents = relationship("Incident", back_populates="requester", foreign_keys="Incident.requester_id")
    assigned_incidents = relationship("Incident", back_populates="assigned_agent", foreign_keys="Incident.assigned_agent_id")
    service_requests = relationship("ServiceRequest", back_populates="requester")
    knowledge_articles = relationship("KnowledgeArticle", back_populates="author")
    audit_logs = relationship("AuditLog", back_populates="user")


class Incident(BasePostgres):
    __tablename__ = "incidents"

    id = Column(Integer, primary_key=True, index=True)
    ticket_number = Column(String, unique=True, index=True, nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    priority = Column(String, default="P3")  # P1 (Critical), P2 (High), P3 (Medium), P4 (Low)
    status = Column(String, default="New")  # New, Assigned, In Progress, Pending, Resolved, Closed
    category = Column(String, default="Software")  # Hardware, Software, Network, Access, Database
    
    # SLA Engine Fields
    sla_deadline = Column(DateTime, nullable=False)
    sla_status = Column(String, default="Active")  # Active, Warning, Breached, Met
    
    # Assignment Fields
    requester_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    assigned_agent_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    # CMDB Link (references MySQL Asset.id)
    cmdb_asset_id = Column(Integer, nullable=True)

    # Timestamps & MTTR
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)
    closed_at = Column(DateTime, nullable=True)
    mttr_seconds = Column(Integer, nullable=True)  # Mean Time to Resolve

    # Escalations
    escalation_level = Column(Integer, default=1)  # 1 (L1), 2 (L2), 3 (L3)
    escalation_reason = Column(String, nullable=True)

    # Relationships
    requester = relationship("User", back_populates="requested_incidents", foreign_keys=[requester_id])
    assigned_agent = relationship("User", back_populates="assigned_incidents", foreign_keys=[assigned_agent_id])
    rca = relationship("RCA", uselist=False, back_populates="incident")


class ServiceRequest(BasePostgres):
    __tablename__ = "service_requests"

    id = Column(Integer, primary_key=True, index=True)
    ticket_number = Column(String, unique=True, index=True, nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    item_type = Column(String, nullable=False)  # Laptop Provisioning, Software License, VPN Access
    status = Column(String, default="Pending Approval")  # Pending Approval, Approved, Fulfilled, Rejected
    requester_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    cost = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    # Relationships
    requester = relationship("User", back_populates="service_requests")


class RCA(BasePostgres):
    """Root Cause Analysis report for Problem Management."""
    __tablename__ = "rcas"

    id = Column(Integer, primary_key=True, index=True)
    incident_id = Column(Integer, ForeignKey("incidents.id"), unique=True, nullable=False)
    root_cause = Column(Text, nullable=False)
    corrective_action = Column(Text, nullable=False)  # Short term resolution
    preventative_action = Column(Text, nullable=False)  # Long term prevention
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    incident = relationship("Incident", back_populates="rca")


class KnowledgeArticle(BasePostgres):
    __tablename__ = "knowledge_articles"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True, nullable=False)
    content = Column(Text, nullable=False)
    category = Column(String, nullable=False)  # Hardware, Software, Network, Security
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    views = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    # Relationships
    author = relationship("User", back_populates="knowledge_articles")


class AuditLog(BasePostgres):
    """Security audit logs (for AD resets, password lockout triggers, escalations)."""
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    username = Column(String, nullable=True)  # Populated for AD audits when no db user exists
    action = Column(String, nullable=False)  # PASSWORD_RESET, AD_LOCKOUT, TICKET_ESCALATION, LOGIN_ATTEMPT
    details = Column(Text, nullable=False)
    ip_address = Column(String, nullable=True)
    status = Column(String, nullable=False)  # Success, Failure

    # Relationships
    user = relationship("User", back_populates="audit_logs")


# ==========================================
# 2. MySQL Models (CMDB Assets)
# ==========================================

class Asset(BaseMysql):
    __tablename__ = "assets"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    asset_tag = Column(String(50), unique=True, index=True, nullable=False)
    name = Column(String(100), nullable=False)
    category = Column(String(50), nullable=False)  # Laptop, Server, Network Device, Database, License
    model = Column(String(100), nullable=False)
    serial_number = Column(String(100), unique=True, nullable=False)
    status = Column(String(50), default="In Stock")  # In Service, In Stock, Under Repair, Retired
    owner_email = Column(String(100), nullable=True)
    purchase_date = Column(Date, nullable=True)
    cost = Column(Float, default=0.0)
