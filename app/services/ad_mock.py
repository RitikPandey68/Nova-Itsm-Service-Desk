import logging
from sqlalchemy.orm import Session
from app.database import redis_client
from app.models import AuditLog, User
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# Pre-populated AD Users simulation
MOCK_AD_USERS = {
    "administrator": {"email": "admin@enterprise.local", "department": "IT", "role": "admin", "ad_password": "ADPassword123!"},
    "john.doe": {"email": "john.doe@enterprise.local", "department": "Finance", "role": "user", "ad_password": "FinancePassword456!"},
    "jane.smith": {"email": "jane.smith@enterprise.local", "department": "HR", "role": "agent", "ad_password": "HRPassword789!"},
    "operator.desk": {"email": "operator.desk@enterprise.local", "department": "IT Support", "role": "agent", "ad_password": "DeskPassword321!"}
}

class ActiveDirectoryMockService:
    @staticmethod
    def authenticate_ad_user(username: str, password_raw: str, db_postgres: Session, ip_address: str = None) -> bool:
        """Simulates authenticating a user against Active Directory domain controllers."""
        username_clean = username.lower().strip()
        
        # Check lockout status in Redis
        lockout_key = f"ad:lockout:{username_clean}"
        if redis_client.get(lockout_key):
            # Log lockout violation audit
            log = AuditLog(
                action="LOGIN_ATTEMPT",
                username=username_clean,
                details="AD Login blocked. Account is currently locked out due to password reset failures.",
                ip_address=ip_address,
                status="Failure"
            )
            db_postgres.add(log)
            db_postgres.commit()
            return False

        if username_clean not in MOCK_AD_USERS:
            return False

        # Retrieve current password (check Redis overrides first, then default mock DB)
        pwd_key = f"ad:password:{username_clean}"
        stored_pwd = redis_client.get(pwd_key) or MOCK_AD_USERS[username_clean]["ad_password"]

        if password_raw == stored_pwd:
            # Success: Clear any login failure counters
            redis_client.delete(f"ad:failures:{username_clean}")
            return True
        else:
            return False

    @staticmethod
    def reset_ad_password(username: str, old_password: str, new_password: str, db_postgres: Session, ip_address: str = None) -> dict:
        """
        Simulates an Active Directory self-service password reset.
        Enforces security audit rules and lockouts (3 failed attempts).
        """
        username_clean = username.lower().strip()
        
        # Check lockout status
        lockout_key = f"ad:lockout:{username_clean}"
        if redis_client.get(lockout_key):
            return {"success": False, "message": "Account is locked out. Please contact the Domain Administrator."}

        # Check if user exists in AD
        if username_clean not in MOCK_AD_USERS:
            # We log failed attempt for unknown user (Security Audit)
            log = AuditLog(
                action="PASSWORD_RESET",
                username=username_clean,
                details="Attempted password reset for non-existent AD account.",
                ip_address=ip_address,
                status="Failure"
            )
            db_postgres.add(log)
            db_postgres.commit()
            return {"success": False, "message": "Invalid credentials or account does not exist."}

        # Check password failure count
        failure_key = f"ad:failures:{username_clean}"
        failures = int(redis_client.get(failure_key) or 0)

        # Get current AD password
        pwd_key = f"ad:password:{username_clean}"
        stored_pwd = redis_client.get(pwd_key) or MOCK_AD_USERS[username_clean]["ad_password"]

        if old_password != stored_pwd:
            failures += 1
            redis_client.set(failure_key, failures, ex=1800)  # Expire failure count after 30 mins
            
            # Audit log
            log = AuditLog(
                action="PASSWORD_RESET",
                username=username_clean,
                details=f"Failed password reset. Incorrect old password. Attempt {failures}/3.",
                ip_address=ip_address,
                status="Failure"
            )
            db_postgres.add(log)

            if failures >= 3:
                # Trigger Lockout (lasts 15 minutes)
                redis_client.set(lockout_key, "locked", ex=900)
                
                lockout_log = AuditLog(
                    action="AD_LOCKOUT",
                    username=username_clean,
                    details="Active Directory account locked out due to 3 consecutive password reset failures.",
                    ip_address=ip_address,
                    status="Failure"
                )
                db_postgres.add(lockout_log)
                db_postgres.commit()
                return {"success": False, "message": "Account locked out due to too many failed attempts. Try again in 15 minutes."}
            
            db_postgres.commit()
            return {"success": False, "message": f"Incorrect old password. Attempt {failures} of 3 before lockout."}

        # Password complexity validation (simple length check for simulation)
        if len(new_password) < 8 or not any(c.isdigit() for c in new_password) or not any(c.isupper() for c in new_password):
            log = AuditLog(
                action="PASSWORD_RESET",
                username=username_clean,
                details="Failed password reset: password does not meet complexity rules (minimum 8 characters, 1 digit, 1 uppercase).",
                ip_address=ip_address,
                status="Failure"
            )
            db_postgres.add(log)
            db_postgres.commit()
            return {"success": False, "message": "Password does not meet Active Directory complexity requirements (Min 8 characters, 1 digit, 1 uppercase)."}

        # Success: Update AD password in Redis cache
        redis_client.set(pwd_key, new_password)
        redis_client.delete(failure_key)

        # Also update corresponding local DB password if user is synced locally
        local_user = db_postgres.query(User).filter(User.username == username_clean).first()
        if local_user:
            local_user.hashed_password = pwd_context.hash(new_password)
            db_postgres.add(local_user)

        # Audit log success
        log = AuditLog(
            action="PASSWORD_RESET",
            user_id=local_user.id if local_user else None,
            username=username_clean,
            details="Password reset successful in Active Directory. Synced to local DB.",
            ip_address=ip_address,
            status="Success"
        )
        db_postgres.add(log)
        db_postgres.commit()

        return {"success": True, "message": "Password successfully reset in Active Directory."}

    @staticmethod
    def unlock_ad_user(username: str, db_postgres: Session, ip_address: str = None) -> bool:
        """Administrative utility to unlock a locked-out AD user."""
        username_clean = username.lower().strip()
        lockout_key = f"ad:lockout:{username_clean}"
        failure_key = f"ad:failures:{username_clean}"
        
        if redis_client.get(lockout_key):
            redis_client.delete(lockout_key)
            redis_client.delete(failure_key)
            
            log = AuditLog(
                action="AD_UNLOCK",
                username=username_clean,
                details="Active Directory account unlocked by Administrator.",
                ip_address=ip_address,
                status="Success"
            )
            db_postgres.add(log)
            db_postgres.commit()
            return True
        return False
