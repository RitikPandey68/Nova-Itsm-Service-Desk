from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional, List

from app.database import get_mysql_db, get_db
from app.models import Asset, User, AuditLog
from app.schemas import AssetCreate, AssetResponse
from app.services.auth import get_current_active_user, RoleChecker

router = APIRouter(prefix="/assets", tags=["CMDB Asset Management"])

def generate_asset_tag(db: Session) -> str:
    """Generates a unique asset tag number using the maximum database ID."""
    max_id = db.query(func.max(Asset.id)).scalar() or 0
    return f"AST-{1000 + max_id + 1}"

@router.post("/", response_model=AssetResponse, status_code=status.HTTP_201_CREATED)
def create_asset(
    asset_in: AssetCreate,
    db_mysql: Session = Depends(get_mysql_db),
    db_postgres: Session = Depends(get_db),
    current_user: User = Depends(RoleChecker(["admin"]))
):
    """Registers a new physical or digital Configuration Item (CI) asset into CMDB (Admin only)."""
    # Check if serial number already exists
    dup = db_mysql.query(Asset).filter(Asset.serial_number == asset_in.serial_number).first()
    if dup:
        raise HTTPException(status_code=400, detail="Serial number already exists in inventory.")
        
    tag = generate_asset_tag(db_mysql)
    new_asset = Asset(
        asset_tag=tag,
        name=asset_in.name,
        category=asset_in.category,
        model=asset_in.model,
        serial_number=asset_in.serial_number,
        status=asset_in.status,
        owner_email=asset_in.owner_email,
        purchase_date=asset_in.purchase_date,
        cost=asset_in.cost
    )
    db_mysql.add(new_asset)
    db_mysql.commit()
    db_mysql.refresh(new_asset)

    # Post security audit to postgres
    db_postgres.add(AuditLog(
        action="CMDB_ASSET_ADD",
        user_id=current_user.id,
        details=f"Asset {tag} ({new_asset.name}) registered in CMDB by {current_user.username}.",
        status="Success"
    ))
    db_postgres.commit()
    
    return new_asset

@router.get("/", response_model=List[AssetResponse])
def get_assets(
    category: Optional[str] = None,
    status: Optional[str] = None,
    db_mysql: Session = Depends(get_mysql_db),
    current_user: User = Depends(get_current_active_user)
):
    """Retrieves all assets registered in CMDB."""
    query = db_mysql.query(Asset)
    if category:
        query = query.filter(Asset.category == category)
    if status:
        query = query.filter(Asset.status == status)
    return query.all()

@router.get("/{id}", response_model=AssetResponse)
def get_asset(
    id: int,
    db_mysql: Session = Depends(get_mysql_db),
    current_user: User = Depends(get_current_active_user)
):
    """Retrieves details of a specific configuration asset."""
    asset = db_mysql.query(Asset).filter(Asset.id == id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="CMDB Asset not found.")
    return asset

@router.put("/{id}", response_model=AssetResponse)
def update_asset(
    id: int,
    asset_update: AssetCreate,  # Reuse base fields for update validation
    db_mysql: Session = Depends(get_mysql_db),
    db_postgres: Session = Depends(get_db),
    current_user: User = Depends(RoleChecker(["agent", "admin"]))
):
    """Updates configuration details or status of a CMDB asset (Agents/Admins)."""
    asset = db_mysql.query(Asset).filter(Asset.id == id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="CMDB Asset not found.")

    # Apply updates
    asset.name = asset_update.name
    asset.category = asset_update.category
    asset.model = asset_update.model
    asset.status = asset_update.status
    asset.owner_email = asset_update.owner_email
    asset.cost = asset_update.cost
    if asset_update.purchase_date:
        asset.purchase_date = asset_update.purchase_date

    db_mysql.add(asset)
    db_mysql.commit()
    db_mysql.refresh(asset)

    # Post audit to PostgreSQL
    db_postgres.add(AuditLog(
        action="CMDB_ASSET_UPDATE",
        user_id=current_user.id,
        details=f"Asset {asset.asset_tag} configuration updated by {current_user.username}. Status: {asset.status}.",
        status="Success"
    ))
    db_postgres.commit()

    return asset

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(
    id: int,
    db_mysql: Session = Depends(get_mysql_db),
    db_postgres: Session = Depends(get_db),
    current_user: User = Depends(RoleChecker(["admin"]))
):
    """Deletes an asset from CMDB inventory (Admin only)."""
    asset = db_mysql.query(Asset).filter(Asset.id == id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found.")

    db_postgres.add(AuditLog(
        action="CMDB_ASSET_DELETE",
        user_id=current_user.id,
        details=f"Asset {asset.asset_tag} ({asset.name}) permanently removed from CMDB by Administrator {current_user.username}.",
        status="Success"
    ))
    db_postgres.commit()

    db_mysql.delete(asset)
    db_mysql.commit()
    return None
