from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
import datetime


from app.database import get_db, get_mysql_db
from app.models import Incident, User, AuditLog, Asset
from app.schemas import IncidentCreate, IncidentUpdate, IncidentResponse
from app.services.auth import get_current_active_user, RoleChecker
from app.services.sla_engine import SLAEngine

router = APIRouter(prefix="/incidents", tags=["Incident Management"])

def generate_ticket_number(db: Session) -> str:
    """Generates a unique incident ticket number using the maximum table ID."""
    max_id = db.query(func.max(Incident.id)).scalar() or 0
    return f"INC-{1000 + max_id + 1}"

@router.post("/", response_model=IncidentResponse, status_code=status.HTTP_201_CREATED)
def create_incident(
    incident_in: IncidentCreate,
    db: Session = Depends(get_db),
    db_mysql: Session = Depends(get_mysql_db),
    current_user: User = Depends(get_current_active_user)
):
    """Creates a new incident, computes its SLA deadline, and links it to a CMDB asset."""
    ticket_num = generate_ticket_number(db)
    now = datetime.datetime.utcnow()
    deadline = SLAEngine.calculate_deadline(incident_in.priority, now)

    # Verify CMDB Asset if ID is provided
    if incident_in.cmdb_asset_id:
        asset = db_mysql.query(Asset).filter(Asset.id == incident_in.cmdb_asset_id).first()
        if not asset:
            raise HTTPException(status_code=400, detail="Linked CMDB Asset ID does not exist in inventory.")

    new_incident = Incident(
        ticket_number=ticket_num,
        title=incident_in.title,
        description=incident_in.description,
        priority=incident_in.priority,
        category=incident_in.category,
        sla_deadline=deadline,
        sla_status="Active",
        requester_id=current_user.id,
        cmdb_asset_id=incident_in.cmdb_asset_id,
        created_at=now,
        status="New"
    )
    db.add(new_incident)
    db.commit()
    db.refresh(new_incident)

    # Audit log
    db.add(AuditLog(
        action="TICKET_CREATED",
        user_id=current_user.id,
        details=f"Incident {ticket_num} created by {current_user.username}. SLA Deadline: {deadline.strftime('%Y-%m-%d %H:%M:%S')}",
        status="Success"
    ))
    db.commit()

    # Dynamic asset fetching
    response_data = IncidentResponse.model_validate(new_incident)
    if new_incident.cmdb_asset_id:
        asset = db_mysql.query(Asset).filter(Asset.id == new_incident.cmdb_asset_id).first()
        response_data.asset = asset
    return response_data

@router.get("/", response_model=list[IncidentResponse])
def get_incidents(
    status: Optional[str] = None,
    priority: Optional[str] = None,
    db: Session = Depends(get_db),
    db_mysql: Session = Depends(get_mysql_db),
    current_user: User = Depends(get_current_active_user)
):
    """Retrieves all incidents, applying optional filters and SLA triggers."""
    # Synchronize SLA and escalation rules dynamically
    SLAEngine.update_sla_and_escalations(db)

    query = db.query(Incident)

    # Standard users can only view their own tickets, agents/admins view all
    if current_user.role == "user":
        query = query.filter(Incident.requester_id == current_user.id)

    if status:
        query = query.filter(Incident.status == status)
    if priority:
        query = query.filter(Incident.priority == priority)

    incidents = query.order_by(Incident.created_at.desc()).all()

    # Bind CMDB assets from MySQL dynamically to Pydantic responses
    results = []
    asset_ids = [inc.cmdb_asset_id for inc in incidents if inc.cmdb_asset_id]
    assets_map = {}
    if asset_ids:
        db_assets = db_mysql.query(Asset).filter(Asset.id.in_(asset_ids)).all()
        assets_map = {asset.id: asset for asset in db_assets}

    for inc in incidents:
        resp = IncidentResponse.model_validate(inc)
        if inc.cmdb_asset_id in assets_map:
            resp.asset = assets_map[inc.cmdb_asset_id]
        results.append(resp)

    return results

@router.get("/{id}", response_model=IncidentResponse)
def get_incident(
    id: int,
    db: Session = Depends(get_db),
    db_mysql: Session = Depends(get_mysql_db),
    current_user: User = Depends(get_current_active_user)
):
    """Retrieves a single incident by ID, attaching the MySQL CMDB asset details."""
    incident = db.query(Incident).filter(Incident.id == id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident ticket not found.")

    if current_user.role == "user" and incident.requester_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to view this ticket.")

    resp = IncidentResponse.model_validate(incident)
    if incident.cmdb_asset_id:
        asset = db_mysql.query(Asset).filter(Asset.id == incident.cmdb_asset_id).first()
        resp.asset = asset
    return resp

@router.put("/{id}", response_model=IncidentResponse)
def update_incident(
    id: int,
    incident_update: IncidentUpdate,
    db: Session = Depends(get_db),
    db_mysql: Session = Depends(get_mysql_db),
    current_user: User = Depends(get_current_active_user)
):
    """Updates status, assignment, priority, and processes SLA transitions."""
    incident = db.query(Incident).filter(Incident.id == id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident ticket not found.")

    # Authorization check
    if current_user.role == "user" and incident.requester_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to edit this ticket.")

    # Restrict status/assignment edits to Agents & Admins
    if current_user.role == "user" and (incident_update.status or incident_update.assigned_agent_id):
        raise HTTPException(status_code=403, detail="Role not permitted to assign tickets or change statuses.")

    # 1. Update priority (and recalculate SLA)
    if incident_update.priority and incident_update.priority != incident.priority:
        incident.priority = incident_update.priority
        incident.sla_deadline = SLAEngine.calculate_deadline(incident.priority, incident.created_at)

    # 2. Update status and SLA calculations
    if incident_update.status and incident_update.status != incident.status:
        old_status = incident.status
        new_status = incident_update.status
        incident.status = new_status

        if new_status == "Resolved" and old_status != "Resolved":
            # Resolve ticket and calculate MTTR
            SLAEngine.resolve_incident_sla(incident, db)
        elif new_status == "Closed" and old_status != "Closed":
            incident.closed_at = datetime.datetime.utcnow()
        elif old_status == "Resolved" and new_status not in ["Resolved", "Closed"]:
            # Reopened ticket
            incident.resolved_at = None
            incident.closed_at = None
            incident.mttr_seconds = None
            incident.sla_deadline = SLAEngine.calculate_deadline(incident.priority, incident.created_at)
            incident.sla_status = "Active"

        db.add(AuditLog(
            action="TICKET_STATUS_CHANGE",
            user_id=current_user.id,
            details=f"Incident {incident.ticket_number} status changed from '{old_status}' to '{new_status}'.",
            status="Success"
        ))

    # 3. Assign Agent
    if incident_update.assigned_agent_id is not None:
        agent = db.query(User).filter(User.id == incident_update.assigned_agent_id).first()
        if agent and agent.role not in ["agent", "admin"]:
            raise HTTPException(status_code=400, detail="Assigned user must be an agent or admin.")
        
        incident.assigned_agent_id = incident_update.assigned_agent_id
        # Automatically transition state to "Assigned" if it was "New"
        if incident.status == "New":
            incident.status = "Assigned"

        db.add(AuditLog(
            action="TICKET_ASSIGNMENT",
            user_id=current_user.id,
            details=f"Incident {incident.ticket_number} assigned to {agent.username if agent else 'None'}.",
            status="Success"
        ))

    # Other basic fields
    if incident_update.title:
        incident.title = incident_update.title
    if incident_update.description:
        incident.description = incident_update.description
    if incident_update.category:
        incident.category = incident_update.category
    if incident_update.cmdb_asset_id is not None:
        # Verify
        if incident_update.cmdb_asset_id > 0:
            asset = db_mysql.query(Asset).filter(Asset.id == incident_update.cmdb_asset_id).first()
            if not asset:
                raise HTTPException(status_code=400, detail="Asset ID not found in CMDB.")
            incident.cmdb_asset_id = incident_update.cmdb_asset_id
        else:
            incident.cmdb_asset_id = None

    db.add(incident)
    db.commit()
    db.refresh(incident)

    resp = IncidentResponse.model_validate(incident)
    if incident.cmdb_asset_id:
        asset = db_mysql.query(Asset).filter(Asset.id == incident.cmdb_asset_id).first()
        resp.asset = asset
    return resp

@router.post("/{id}/escalate", response_model=IncidentResponse)
def manual_escalate_incident(
    id: int,
    reason: str,
    db: Session = Depends(get_db),
    db_mysql: Session = Depends(get_mysql_db),
    current_user: User = Depends(get_current_active_user)
):
    """Manually escalates an incident ticket to the next support tier (L1 -> L2 -> L3)."""
    # Enforce agent/admin role
    if current_user.role not in ["agent", "admin"]:
        raise HTTPException(status_code=403, detail="Operation permitted for Agents/Admins only.")

    incident = db.query(Incident).filter(Incident.id == id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident ticket not found.")

    if incident.status in ["Resolved", "Closed"]:
        raise HTTPException(status_code=400, detail="Cannot escalate a resolved or closed ticket.")

    if incident.escalation_level >= 3:
        raise HTTPException(status_code=400, detail="Ticket is already at the maximum escalation tier (Level 3).")

    old_level = incident.escalation_level
    incident.escalation_level += 1
    incident.escalation_reason = reason

    db.add(incident)
    db.add(AuditLog(
        action="TICKET_ESCALATION",
        user_id=current_user.id,
        details=f"Incident {incident.ticket_number} manually escalated from L{old_level} to L{incident.escalation_level}. Reason: {reason}",
        status="Success"
    ))
    db.commit()
    db.refresh(incident)

    resp = IncidentResponse.model_validate(incident)
    if incident.cmdb_asset_id:
        asset = db_mysql.query(Asset).filter(Asset.id == incident.cmdb_asset_id).first()
        resp.asset = asset
    return resp

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_incident(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(RoleChecker(["admin"]))
):
    """Deletes an incident ticket (System Administrators only)."""
    incident = db.query(Incident).filter(Incident.id == id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found.")
    
    # Audit log
    db.add(AuditLog(
        action="TICKET_DELETION",
        user_id=current_user.id,
        details=f"Incident {incident.ticket_number} deleted by Administrator {current_user.username}.",
        status="Success"
    ))
    
    db.delete(incident)
    db.commit()
    return None
