from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List

from app.database import get_db
from app.models import Incident, AuditLog, User
from app.schemas import DashboardMetrics, AuditLogResponse, SLAStatusCount, PriorityCount
from app.services.auth import get_current_active_user, RoleChecker
from app.services.sla_engine import SLAEngine

router = APIRouter(prefix="/dashboard", tags=["Dashboard & Analytics"])

@router.get("/metrics", response_model=DashboardMetrics)
def get_dashboard_metrics(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """
    Retrieves real-time aggregated ITSM dashboard metrics, updating 
    SLA breaches and auto-escalations on the fly.
    """
    # 1. Update SLA deadlines dynamically before aggregation
    SLAEngine.update_sla_and_escalations(db)

    # 2. Open incidents count (New, Assigned, In Progress, Pending)
    open_count = db.query(Incident).filter(Incident.status.notin_(["Resolved", "Closed"])).count()

    # 3. Resolved incidents count
    resolved_count = db.query(Incident).filter(Incident.status.in_(["Resolved", "Closed"])).count()

    # 4. SLA Compliance calculations
    resolved_tickets = db.query(Incident).filter(Incident.status.in_(["Resolved", "Closed"])).all()
    if resolved_tickets:
        met_count = sum(1 for t in resolved_tickets if t.sla_status == "Met")
        sla_compliance_rate = round((met_count / len(resolved_tickets)) * 100, 2)
    else:
        sla_compliance_rate = 100.0  # Default if no tickets resolved yet

    # 5. MTTR (Mean Time to Resolve) in hours
    avg_mttr_res = db.query(func.avg(Incident.mttr_seconds)).filter(Incident.mttr_seconds.isnot(None)).scalar()
    if avg_mttr_res is not None:
        avg_mttr_hours = round(float(avg_mttr_res) / 3600, 2)
    else:
        avg_mttr_hours = 0.0

    # 6. Unassigned & Escalated open counts
    unassigned_count = db.query(Incident).filter(
        Incident.status.notin_(["Resolved", "Closed"]),
        Incident.assigned_agent_id.is_(None)
    ).count()

    escalated_count = db.query(Incident).filter(
        Incident.status.notin_(["Resolved", "Closed"]),
        Incident.escalation_level > 1
    ).count()

    # 7. SLA Status Counts
    sla_stats = SLAStatusCount(
        active=db.query(Incident).filter(Incident.sla_status == "Active").count(),
        warning=db.query(Incident).filter(Incident.sla_status == "Warning").count(),
        breached=db.query(Incident).filter(Incident.sla_status == "Breached").count(),
        met=db.query(Incident).filter(Incident.sla_status == "Met").count()
    )

    # 8. Priority breakdown
    priority_stats = PriorityCount(
        p1=db.query(Incident).filter(Incident.priority == "P1").count(),
        p2=db.query(Incident).filter(Incident.priority == "P2").count(),
        p3=db.query(Incident).filter(Incident.priority == "P3").count(),
        p4=db.query(Incident).filter(Incident.priority == "P4").count()
    )

    # 9. Get latest 15 security audit logs
    recent_logs = db.query(AuditLog).order_by(AuditLog.timestamp.desc()).limit(15).all()

    return DashboardMetrics(
        total_open_incidents=open_count,
        resolved_incidents_count=resolved_count,
        sla_compliance_rate=sla_compliance_rate,
        avg_mttr_hours=avg_mttr_hours,
        unassigned_count=unassigned_count,
        escalated_count=escalated_count,
        sla_stats=sla_stats,
        priority_stats=priority_stats,
        recent_audit_logs=recent_logs
    )

@router.get("/audit-logs", response_model=List[AuditLogResponse])
def get_all_audit_logs(
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(RoleChecker(["agent", "admin"]))
):
    """Retrieves security awareness audit trails for agents and administrators."""
    return db.query(AuditLog).order_by(AuditLog.timestamp.desc()).limit(limit).all()
