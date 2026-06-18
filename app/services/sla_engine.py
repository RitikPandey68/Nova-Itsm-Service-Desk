import datetime
from sqlalchemy.orm import Session
from app.models import Incident, AuditLog

# SLA Duration definitions in hours
SLA_TARGET_HOURS = {
    "P1": 2,    # Critical - 2 hours
    "P2": 8,    # High - 8 hours
    "P3": 24,   # Medium - 24 hours
    "P4": 72    # Low - 72 hours
}

class SLAEngine:
    @staticmethod
    def calculate_deadline(priority: str, created_at: datetime.datetime) -> datetime.datetime:
        """Returns the SLA target datetime based on incident priority."""
        hours = SLA_TARGET_HOURS.get(priority, 24)
        return created_at + datetime.timedelta(hours=hours)

    @staticmethod
    def update_sla_and_escalations(db: Session):
        """
        Scans all unresolved incidents to update SLA states (Active, Warning, Breached)
        and trigger automated ITIL escalations based on elapsed time thresholds.
        Runs dynamically to ensure UI data is always accurate and updated.
        """
        now = datetime.datetime.utcnow()
        unresolved_incidents = db.query(Incident).filter(
            Incident.status.notin_(["Resolved", "Closed"])
        ).all()

        updated_count = 0
        for incident in unresolved_incidents:
            # 1. Recalculate deadline if missing
            if not incident.sla_deadline:
                incident.sla_deadline = SLAEngine.calculate_deadline(incident.priority, incident.created_at)

            # 2. SLA calculations
            allowed_hours = SLA_TARGET_HOURS.get(incident.priority, 24)
            total_sla_seconds = allowed_hours * 3600
            elapsed_seconds = (now - incident.created_at).total_seconds()
            
            # Check for breach or warning
            old_status = incident.sla_status
            if now > incident.sla_deadline:
                incident.sla_status = "Breached"
            elif elapsed_seconds / total_sla_seconds >= 0.80:
                incident.sla_status = "Warning"
            else:
                incident.sla_status = "Active"

            # Log audit if SLA status transitioned to Breached
            if old_status != "Breached" and incident.sla_status == "Breached":
                db.add(AuditLog(
                    action="SLA_BREACH",
                    details=f"SLA Breached for Incident {incident.ticket_number} (Priority: {incident.priority}).",
                    status="Failure"
                ))

            # 3. Automated Escalation Engine
            # Level 1 -> Level 2: 30% of SLA elapsed and ticket is still "New" / "Assigned"
            if incident.escalation_level == 1 and (elapsed_seconds / total_sla_seconds) >= 0.30:
                incident.escalation_level = 2
                incident.escalation_reason = "Auto-Escalation: 30% of SLA target elapsed."
                db.add(AuditLog(
                    action="TICKET_ESCALATION",
                    details=f"Incident {incident.ticket_number} automatically escalated to Level 2 (30% SLA elapsed).",
                    status="Success"
                ))
                updated_count += 1

            # Level 2 -> Level 3: 75% of SLA elapsed and ticket is not resolved
            elif incident.escalation_level == 2 and (elapsed_seconds / total_sla_seconds) >= 0.75:
                incident.escalation_level = 3
                incident.escalation_reason = "Auto-Escalation: 75% of SLA target elapsed."
                db.add(AuditLog(
                    action="TICKET_ESCALATION",
                    details=f"Incident {incident.ticket_number} automatically escalated to Level 3 (75% SLA elapsed).",
                    status="Success"
                ))
                updated_count += 1

            db.add(incident)
            
        if len(unresolved_incidents) > 0 or updated_count > 0:
            db.commit()

    @staticmethod
    def resolve_incident_sla(incident: Incident, db: Session):
        """Processes SLA metrics when an incident status changes to Resolved."""
        now = datetime.datetime.utcnow()
        incident.resolved_at = now
        incident.mttr_seconds = int((now - incident.created_at).total_seconds())

        # Determine if SLA met
        if now <= incident.sla_deadline:
            incident.sla_status = "Met"
            db.add(AuditLog(
                action="SLA_COMPLIANCE",
                details=f"SLA Met for Incident {incident.ticket_number}. Resolved in {round(incident.mttr_seconds / 3600, 2)} hours.",
                status="Success"
            ))
        else:
            incident.sla_status = "Breached"
            db.add(AuditLog(
                action="SLA_BREACH",
                details=f"SLA Breached for Incident {incident.ticket_number}. Resolved after deadline in {round(incident.mttr_seconds / 3600, 2)} hours.",
                status="Failure"
            ))
        db.add(incident)
        db.commit()
