import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional, List

from app.database import get_db
from app.models import ServiceRequest, User, AuditLog
from app.schemas import ServiceRequestCreate, ServiceRequestResponse, ServiceRequestUpdate
from app.services.auth import get_current_active_user, RoleChecker

router = APIRouter(prefix="/requests", tags=["Service Requests"])

def generate_request_number(db: Session) -> str:
    """Generates a unique service request ticket number using the maximum table ID."""
    max_id = db.query(func.max(ServiceRequest.id)).scalar() or 0
    return f"REQ-{1000 + max_id + 1}"

@router.post("/", response_model=ServiceRequestResponse, status_code=status.HTTP_201_CREATED)
def create_service_request(
    req_in: ServiceRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Submits a new IT service request from the service catalog."""
    ticket_num = generate_request_number(db)
    
    new_request = ServiceRequest(
        ticket_number=ticket_num,
        title=req_in.title,
        description=req_in.description,
        item_type=req_in.item_type,
        cost=req_in.cost,
        status="Pending Approval",
        requester_id=current_user.id
    )
    db.add(new_request)
    db.commit()
    db.refresh(new_request)

    # Audit log
    db.add(AuditLog(
        action="REQUEST_SUBMITTED",
        user_id=current_user.id,
        details=f"Service request {ticket_num} ({req_in.item_type}) submitted by {current_user.username}. Estimated Cost: ${req_in.cost}",
        status="Success"
    ))
    db.commit()
    
    return new_request

@router.get("/", response_model=List[ServiceRequestResponse])
def get_service_requests(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Retrieves all service requests (filtered to requester if standard user)."""
    query = db.query(ServiceRequest)
    
    if current_user.role == "user":
        query = query.filter(ServiceRequest.requester_id == current_user.id)
        
    if status:
        query = query.filter(ServiceRequest.status == status)
        
    return query.order_by(ServiceRequest.created_at.desc()).all()

@router.get("/{id}", response_model=ServiceRequestResponse)
def get_service_request(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Retrieves a single service request ticket details."""
    req = db.query(ServiceRequest).filter(ServiceRequest.id == id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Service request not found.")
        
    if current_user.role == "user" and req.requester_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to view this request.")
        
    return req

@router.put("/{id}", response_model=ServiceRequestResponse)
def update_service_request(
    id: int,
    req_update: ServiceRequestUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Approves, rejects, or fulfills service requests (Agents & Admins only)."""
    # Enforce agent/admin authorization
    if current_user.role not in ["agent", "admin"]:
        raise HTTPException(status_code=403, detail="Operation permitted for Agents/Admins only.")

    req = db.query(ServiceRequest).filter(ServiceRequest.id == id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Service request not found.")

    old_status = req.status
    new_status = req_update.status

    if old_status == new_status:
        return req

    req.status = new_status
    if new_status in ["Fulfilled", "Rejected"]:
        req.completed_at = datetime.datetime.utcnow()

    db.add(req)
    
    # Audit log
    db.add(AuditLog(
        action="REQUEST_STATUS_CHANGE",
        user_id=current_user.id,
        details=f"Service request {req.ticket_number} transitioned from '{old_status}' to '{new_status}' by {current_user.username}.",
        status="Success"
    ))
    db.commit()
    db.refresh(req)
    
    return req
