from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import Optional, List

from app.database import get_db
from app.models import KnowledgeArticle, Incident, RCA, User, AuditLog
from app.schemas import KnowledgeArticleCreate, KnowledgeArticleResponse, RCACreate, RCAResponse
from app.services.auth import get_current_active_user, RoleChecker

router = APIRouter(prefix="/knowledge", tags=["Knowledge & Problem Management"])

# ==========================================
# 1. Knowledge Base Articles
# ==========================================

@router.post("/", response_model=KnowledgeArticleResponse, status_code=status.HTTP_201_CREATED)
def create_article(
    article_in: KnowledgeArticleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(RoleChecker(["agent", "admin"]))
):
    """Creates a new troubleshooting or help article in the Knowledge Base (Agents/Admins)."""
    new_article = KnowledgeArticle(
        title=article_in.title,
        content=article_in.content,
        category=article_in.category,
        author_id=current_user.id
    )
    db.add(new_article)
    db.commit()
    db.refresh(new_article)

    db.add(AuditLog(
        action="KB_ARTICLE_CREATE",
        user_id=current_user.id,
        details=f"Knowledge article ID {new_article.id} ('{new_article.title}') created by {current_user.username}.",
        status="Success"
    ))
    db.commit()

    return new_article

@router.get("/", response_model=List[KnowledgeArticleResponse])
def get_articles(
    category: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Retrieves knowledge articles, matching search queries in title or content."""
    query = db.query(KnowledgeArticle)
    if category:
        query = query.filter(KnowledgeArticle.category == category)
    if search:
        query = query.filter(
            or_(
                KnowledgeArticle.title.icontains(search),
                KnowledgeArticle.content.icontains(search)
            )
        )
    return query.order_by(KnowledgeArticle.views.desc()).all()

@router.get("/{id}", response_model=KnowledgeArticleResponse)
def get_article(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Retrieves a specific article details, incrementing its view count."""
    article = db.query(KnowledgeArticle).filter(KnowledgeArticle.id == id).first()
    if not article:
        raise HTTPException(status_code=404, detail="Knowledge article not found.")

    article.views += 1
    db.add(article)
    db.commit()
    db.refresh(article)
    return article

@router.put("/{id}", response_model=KnowledgeArticleResponse)
def update_article(
    id: int,
    article_update: KnowledgeArticleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(RoleChecker(["agent", "admin"]))
):
    """Updates the content of an article (Agents/Admins)."""
    article = db.query(KnowledgeArticle).filter(KnowledgeArticle.id == id).first()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found.")

    article.title = article_update.title
    article.content = article_update.content
    article.category = article_update.category
    
    db.add(article)
    db.add(AuditLog(
        action="KB_ARTICLE_UPDATE",
        user_id=current_user.id,
        details=f"Knowledge article ID {article.id} updated by {current_user.username}.",
        status="Success"
    ))
    db.commit()
    db.refresh(article)
    return article

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_article(
    id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(RoleChecker(["admin"]))
):
    """Deletes an article from the knowledge base (Admin only)."""
    article = db.query(KnowledgeArticle).filter(KnowledgeArticle.id == id).first()
    if not article:
        raise HTTPException(status_code=404, detail="Article not found.")

    db.add(AuditLog(
        action="KB_ARTICLE_DELETE",
        user_id=current_user.id,
        details=f"Knowledge article ID {article.id} ('{article.title}') deleted by {current_user.username}.",
        status="Success"
    ))
    db.delete(article)
    db.commit()
    return None


# ==========================================
# 2. Problem Management (Root Cause Analysis - RCA)
# ==========================================

@router.post("/rca", response_model=RCAResponse, status_code=status.HTTP_201_CREATED)
def create_rca_report(
    rca_in: RCACreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(RoleChecker(["agent", "admin"]))
):
    """
    Submits a Root Cause Analysis (RCA) report for a resolved/closed incident.
    Promotes ITIL continuous service improvement and problem management.
    """
    # Verify Incident
    incident = db.query(Incident).filter(Incident.id == rca_in.incident_id).first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident linked to RCA not found.")

    if incident.status not in ["Resolved", "Closed"]:
        raise HTTPException(status_code=400, detail="Cannot submit an RCA report for an unresolved ticket.")

    # Check duplicate RCA
    dup = db.query(RCA).filter(RCA.incident_id == rca_in.incident_id).first()
    if dup:
        raise HTTPException(status_code=400, detail="RCA report already exists for this incident.")

    new_rca = RCA(
        incident_id=rca_in.incident_id,
        root_cause=rca_in.root_cause,
        corrective_action=rca_in.corrective_action,
        preventative_action=rca_in.preventative_action,
        created_by_id=current_user.id
    )
    db.add(new_rca)
    db.add(AuditLog(
        action="RCA_SUBMITTED",
        user_id=current_user.id,
        details=f"RCA report submitted for Incident {incident.ticket_number} by {current_user.username}.",
        status="Success"
    ))
    db.commit()
    db.refresh(new_rca)
    return new_rca

@router.get("/rca", response_model=List[RCAResponse])
def get_rcas(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Retrieves all submitted Root Cause Analysis (RCA) reports."""
    return db.query(RCA).order_by(RCA.created_at.desc()).all()

@router.get("/rca/{incident_id}", response_model=RCAResponse)
def get_rca_by_incident(
    incident_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Retrieves the RCA report associated with a specific incident ID."""
    rca = db.query(RCA).filter(RCA.incident_id == incident_id).first()
    if not rca:
        raise HTTPException(status_code=404, detail="RCA report not found for this incident.")
    return rca
