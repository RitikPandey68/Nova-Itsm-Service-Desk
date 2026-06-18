from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import timedelta

from app.database import get_db
from app.models import User, AuditLog
from app.schemas import UserCreate, UserResponse, Token, ADPasswordResetRequest
from app.services.auth import verify_password, get_password_hash, create_access_token, get_current_user, RoleChecker
from app.services.ad_mock import ActiveDirectoryMockService

router = APIRouter(prefix="/auth", tags=["Authentication"])

@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register_user(user_in: UserCreate, db: Session = Depends(get_db)):
    """Registers a new user in the local transactional database."""
    db_user = db.query(User).filter(User.username == user_in.username.lower().strip()).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered.")
    
    db_email = db.query(User).filter(User.email == user_in.email.lower().strip()).first()
    if db_email:
        raise HTTPException(status_code=400, detail="Email already registered.")
        
    hashed_password = get_password_hash(user_in.password)
    new_user = User(
        username=user_in.username.lower().strip(),
        email=user_in.email.lower().strip(),
        hashed_password=hashed_password,
        role=user_in.role,
        department=user_in.department
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    # Audit log
    db.add(AuditLog(
        action="USER_REGISTRATION",
        user_id=new_user.id,
        details=f"User {new_user.username} registered with role {new_user.role}.",
        status="Success"
    ))
    db.commit()
    
    return new_user

@router.post("/login", response_model=Token)
def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """
    ITSM Login. Simulates AD authentication first. If AD user matches, 
    syncs/creates local DB profile and issues a token. 
    Otherwise, authenticates against local PostgreSQL database credentials.
    """
    username = form_data.username.lower().strip()
    password = form_data.password
    ip_address = request.client.host if request.client else "Unknown"

    # 1. Try AD Auth Mock First
    is_ad_auth = ActiveDirectoryMockService.authenticate_ad_user(username, password, db, ip_address)
    
    user = db.query(User).filter(User.username == username).first()

    if is_ad_auth:
        # AD authenticate succeeded. Sync profile if not exist or update
        from app.services.ad_mock import MOCK_AD_USERS
        ad_info = MOCK_AD_USERS[username]
        
        if not user:
            # Auto-provision local user account from AD profile
            user = User(
                username=username,
                email=ad_info["email"],
                hashed_password=get_password_hash(password),
                role=ad_info["role"],
                department=ad_info["department"]
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        else:
            # Sync password in local DB
            user.hashed_password = get_password_hash(password)
            db.add(user)
            db.commit()
            
        # Log successful AD log in
        db.add(AuditLog(
            action="LOGIN_ATTEMPT",
            user_id=user.id,
            username=username,
            details=f"User logged in successfully via Active Directory authentication.",
            ip_address=ip_address,
            status="Success"
        ))
        db.commit()
    else:
        # 2. Local Fallback authentication
        if not user or not verify_password(password, user.hashed_password):
            # Log failed local attempt
            db.add(AuditLog(
                action="LOGIN_ATTEMPT",
                username=username,
                details=f"Failed login attempt for username '{username}'. Invalid credentials.",
                ip_address=ip_address,
                status="Failure"
            ))
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect username or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
            
        # Log successful local log in
        db.add(AuditLog(
            action="LOGIN_ATTEMPT",
            user_id=user.id,
            username=username,
            details=f"User logged in successfully via Local Database credentials.",
            ip_address=ip_address,
            status="Success"
        ))
        db.commit()

    # Create token
    access_token = create_access_token(
        data={"sub": user.username, "role": user.role}
    )
    return {"access_token": access_token, "token_type": "bearer", "user": user}

@router.post("/reset-password")
def reset_ad_password(request: Request, reset_data: ADPasswordResetRequest, db: Session = Depends(get_db)):
    """Self-Service AD password reset request endpoint."""
    ip_address = request.client.host if request.client else "Unknown"
    result = ActiveDirectoryMockService.reset_ad_password(
        username=reset_data.username,
        old_password=reset_data.old_password,
        new_password=reset_data.new_password,
        db_postgres=db,
        ip_address=ip_address
    )
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    return {"status": "success", "message": result["message"]}

@router.get("/me", response_model=UserResponse)
def read_current_user(current_user: User = Depends(get_current_user)):
    """Returns profile details of the currently authenticated user."""
    return current_user

@router.post("/unlock/{username}")
def unlock_ad_account(
    username: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(RoleChecker(["admin"]))
):
    """Administrative override to unlock a locked AD user (Admin only)."""
    ip_address = request.client.host if request.client else "Unknown"
    success = ActiveDirectoryMockService.unlock_ad_user(username, db, ip_address)
    if not success:
        raise HTTPException(status_code=400, detail="Account was not locked or user does not exist.")
    return {"status": "success", "message": f"Account {username} has been unlocked successfully."}
