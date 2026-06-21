from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import datetime
import random

from app.models import User
from app.services.auth import get_current_active_user

router = APIRouter(prefix="/servicenow", tags=["ServiceNow PDI Engine"])

# ==========================================
# Schema Definitions
# ==========================================
class ServicenowTicketPayload(BaseModel):
    sys_id: str
    number: str
    short_description: str
    priority: str
    state: str
    assignment_group: str
    caller: str
    category: str
    impact: str
    urgency: str
    resolution_code: Optional[str] = None
    work_notes: Optional[str] = None

class ServicenowSyncResponse(BaseModel):
    status: str
    external_system: str
    external_id: str
    sync_timestamp: str
    payload_received: Dict[str, Any]

# ==========================================
# Mock Presets Data
# ==========================================
PRESETS_DATABASE = {
    "client_scripts": [
        {
            "id": "cs_priority_matrix",
            "name": "Impact-Urgency Priority Matrix",
            "type": "onChange",
            "field": "impact",
            "description": "Calculates ticket priority dynamically using the standard ITIL matrix whenever Impact or Urgency is changed.",
            "code": """// Client-Side onChange script for Impact and Urgency
function onChange(control, oldValue, newValue, isLoading) {
    if (isLoading || newValue === '') {
        return;
    }
    
    var impact = g_form.getValue('impact');
    var urgency = g_form.getValue('urgency');
    
    var priority = '4'; // Default Low
    
    if (impact === '1' && urgency === '1') priority = '1'; // P1 - Critical
    else if ((impact === '1' && urgency === '2') || (impact === '2' && urgency === '1')) priority = '2'; // P2 - High
    else if ((impact === '2' && urgency === '2') || (impact === '1' && urgency === '3') || (impact === '3' && urgency === '1')) priority = '3'; // P3 - Moderate
    else priority = '4'; // P4 - Low
    
    g_form.setValue('priority', priority);
    g_form.addInfoMessage('Client Script: Calculated Priority as P' + priority + ' from Impact: ' + impact + ' & Urgency: ' + urgency);
}"""
        },
        {
            "id": "cs_mandatory_fields",
            "name": "Validation on Submit",
            "type": "onSubmit",
            "field": "state",
            "description": "Ensures that Work Notes and Resolution Code are completed before permitting form submission when the ticket is marked as Resolved.",
            "code": """// Client-Side onSubmit script for incident validation
function onSubmit() {
    var state = g_form.getValue('state');
    
    if (state === 'Resolved') {
        var resCode = g_form.getValue('resolution_code');
        var workNotes = g_form.getValue('work_notes');
        
        if (!resCode) {
            g_form.showFieldMsg('resolution_code', 'Resolution code is required to close this ticket.', 'error');
            g_form.addErrorMessage('Submission aborted: Missing resolution details.');
            return false; // Blocks submission
        }
        if (!workNotes || workNotes.length < 10) {
            g_form.showFieldMsg('work_notes', 'Provide detailed work notes (min 10 chars).', 'error');
            g_form.addErrorMessage('Submission aborted: Work notes must describe the fix.');
            return false; // Blocks submission
        }
    }
    return true; // Allow submission
}"""
        }
    ],
    "business_rules": [
        {
            "id": "br_auto_assignment",
            "name": "Auto-Assign Tech Teams",
            "when": "before_insert",
            "description": "Auto-assigns the ticket to the correct technical support group based on the ticket category before DB insert.",
            "code": """// Server-Side Business Rule: Before Insert
(function executeRule(current, previous /*null when async*/) {
    var category = current.category;
    
    if (category === 'Network') {
        current.assignment_group = 'Network Administration';
    } else if (category === 'Database') {
        current.assignment_group = 'Database Operations';
    } else if (category === 'Hardware') {
        current.assignment_group = 'Hardware Support Team';
    } else {
        current.assignment_group = 'IT Service Desk';
    }
    
    gs.addInfoMessage('Business Rule: Auto-assigned group to "' + current.assignment_group + '" based on category: ' + category);
})(current, previous);"""
        },
        {
            "id": "br_p1_escalation",
            "name": "High Priority Critical Escalation",
            "when": "after_update",
            "description": "When a ticket state escalates to Critical (P1), automatically updates active SLA guidelines and logs a high-severity alert.",
            "code": """// Server-Side Business Rule: After Update
(function executeRule(current, previous) {
    if (current.priority === '1' && previous.priority !== '1') {
        gs.addErrorMessage('ALERT: Ticket ' + current.number + ' has escalated to CRITICAL P1 SLA status.');
        current.sla_time_limit_hours = 2.0; // 2 hour SLA limit for critical incidents
        
        // Push notification simulation
        var eventPayload = {
            ticket_id: current.sys_id,
            escalation_type: 'SEV_1_ALERT',
            assigned_group: current.assignment_group
        };
        gs.eventQueue('incident.escalated', current, JSON.stringify(eventPayload));
    }
})(current, previous);"""
        }
    ],
    "ui_policies": [
        {
            "id": "up_resolved_fields",
            "name": "Show/Require Resolution fields when Resolved",
            "conditions": "State is Resolved",
            "description": "Dynamically sets Resolution Code to Mandatory and Visible when the ticket's state is set to Resolved.",
            "actions": [
                {"field": "resolution_code", "mandatory": True, "visible": True},
                {"field": "work_notes", "mandatory": True, "visible": True}
            ]
        },
        {
            "id": "up_closed_readonly",
            "name": "Lock fields on Closed ticket",
            "conditions": "State is Closed",
            "description": "Locks all editable fields on the incident form once the status reaches Closed to maintain historical compliance.",
            "actions": [
                {"field": "category", "readonly": True},
                {"field": "impact", "readonly": True},
                {"field": "urgency", "readonly": True},
                {"field": "short_description", "readonly": True},
                {"field": "assignment_group", "readonly": True},
                {"field": "work_notes", "readonly": True},
                {"field": "resolution_code", "readonly": True}
            ]
        }
    ],
    "flows": [
        {
            "id": "flow_p1_critical",
            "name": "P1 Incident Escalation Workflow",
            "trigger": "Incident Created (Priority == 1)",
            "description": "Handles critical production incidents. Triggers SMS, auto-routes to on-call engineers, sets P1 SLA thresholds, and replicates the ticket into an external Jira Service Desk.",
            "steps": [
                {"step": 1, "name": "Validate Critical Priority", "action": "Verify priority field value is '1' (Critical)."},
                {"step": 2, "name": "Auto-Route to On-Call Group", "action": "Reassign assignment group to 'IT Operations Command Center'."},
                {"step": 3, "name": "Spawn SLA Watchdog", "action": "Initialize 2-hour recovery timer SLA countdown."},
                {"step": 4, "name": "API Synchronization", "action": "Dispatch REST payload to external Devops Board."},
                {"step": 5, "name": "Staff Alert", "action": "Generate broadcast alerts to all on-call IT directors."}
            ]
        },
        {
            "id": "flow_change_cab",
            "name": "Normal Change Approval Flow",
            "trigger": "Change Request Created (Type == Normal)",
            "description": "Automates approval gates for infrastructure changes. Checks risk factor, maps CMDB system dependencies, and generates CAB approval requests.",
            "steps": [
                {"step": 1, "name": "Risk Classification Check", "action": "Evaluate risk factor based on affected CMDB components."},
                {"step": 2, "name": "Map System Dependencies", "action": "Check upstream and downstream servers in configuration items inventory."},
                {"step": 3, "name": "Draft Approval Requests", "action": "Send CAB (Change Advisory Board) approval vouchers to domain owners."},
                {"step": 4, "name": "Audit Gate Log", "action": "Insert authorization ledger into security logs."}
            ]
        }
    ]
}

# ==========================================
# Endpoints
# ==========================================
@router.get("/presets")
def get_presets(current_user: User = Depends(get_current_active_user)):
    """Returns the script, policy, and workflow presets database for PDI simulation."""
    return PRESETS_DATABASE

@router.post("/sync", response_model=ServicenowSyncResponse)
def sync_ticket(
    payload: ServicenowTicketPayload,
    current_user: User = Depends(get_current_active_user)
):
    """
    Simulates ServiceNow REST API outbound sync to an external system (e.g. Jira Service Desk).
    Validates payload structure and returns generated API keys and transaction IDs.
    """
    jira_number = f"JSD-{random.randint(2000, 9999)}"
    now = datetime.datetime.utcnow().isoformat() + "Z"
    
    return ServicenowSyncResponse(
        status="success",
        external_system="Jira Service Desk Integration Engine",
        external_id=jira_number,
        sync_timestamp=now,
        payload_received=payload.model_dump()
    )
