import datetime
from sqlalchemy.orm import Session
from sqlalchemy import text

# Import database setups
from app.database import PostgresSessionLocal, MysqlSessionLocal, BasePostgres, BaseMysql, postgres_engine, mysql_engine
from app.models import User, Incident, ServiceRequest, RCA, KnowledgeArticle, AuditLog, Asset
from app.services.auth import get_password_hash
from app.services.sla_engine import SLAEngine

def seed_databases():
    print("Initializing Database tables...")
    BasePostgres.metadata.create_all(bind=postgres_engine)
    BaseMysql.metadata.create_all(bind=mysql_engine)

    db_pg = PostgresSessionLocal()
    db_my = MysqlSessionLocal()

    # Clear existing data
    print("Clearing existing data...")
    db_pg.query(RCA).delete()
    db_pg.query(Incident).delete()
    db_pg.query(ServiceRequest).delete()
    db_pg.query(KnowledgeArticle).delete()
    db_pg.query(AuditLog).delete()
    db_pg.query(User).delete()
    db_pg.commit()

    db_my.query(Asset).delete()
    db_my.commit()

    print("Seeding Users in PostgreSQL...")
    users_data = [
        User(username="administrator", email="admin@enterprise.local", hashed_password=get_password_hash("ADPassword123!"), role="admin", department="IT"),
        User(username="john.doe", email="john.doe@enterprise.local", hashed_password=get_password_hash("FinancePassword456!"), role="user", department="Finance"),
        User(username="jane.smith", email="jane.smith@enterprise.local", hashed_password=get_password_hash("HRPassword789!"), role="agent", department="HR"),
        User(username="operator.desk", email="operator.desk@enterprise.local", hashed_password=get_password_hash("DeskPassword321!"), role="agent", department="IT Support")
    ]
    for user in users_data:
        db_pg.add(user)
    db_pg.commit()

    # Fetch users for references
    admin = db_pg.query(User).filter(User.username == "administrator").first()
    john = db_pg.query(User).filter(User.username == "john.doe").first()
    jane = db_pg.query(User).filter(User.username == "jane.smith").first()
    operator = db_pg.query(User).filter(User.username == "operator.desk").first()

    print("Seeding CMDB Assets in MySQL...")
    assets_data = [
        Asset(asset_tag="AST-1001", name="Developer MacBook Pro", category="Laptop", model="Apple MacBook Pro M3 16''", serial_number="C02X8776FG89", status="In Service", owner_email="john.doe@enterprise.local", purchase_date=datetime.date(2025, 5, 12), cost=2499.00),
        Asset(asset_tag="AST-1002", name="Primary Active Directory Controller", category="Server", model="Dell PowerEdge R760", serial_number="DELL-98XF456", status="In Service", owner_email="it-infrastructure@enterprise.local", purchase_date=datetime.date(2024, 2, 20), cost=8500.00),
        Asset(asset_tag="AST-1003", name="HQ Core Switch 4th Floor", category="Network Device", model="Cisco Catalyst 9300 48-Port", serial_number="FOC2334K01P", status="In Service", owner_email="it-networking@enterprise.local", purchase_date=datetime.date(2024, 8, 15), cost=4300.00),
        Asset(asset_tag="AST-1004", name="Core ERP Database Cluster", category="Server", model="HPE ProLiant DL380 Gen11", serial_number="HPESGH7654", status="In Service", owner_email="it-dbas@enterprise.local", purchase_date=datetime.date(2024, 11, 5), cost=12000.00),
        Asset(asset_tag="AST-1005", name="Backup Office Laptop", category="Laptop", model="Lenovo ThinkPad X1 Carbon Gen 11", serial_number="LNV-888X776", status="In Stock", purchase_date=datetime.date(2025, 1, 10), cost=1850.00),
        Asset(asset_tag="AST-1006", name="Finance Shared Printer", category="Peripheral", model="HP LaserJet Enterprise M507", serial_number="PH-JBL87654", status="Under Repair", purchase_date=datetime.date(2023, 6, 1), cost=699.00)
    ]
    for asset in assets_data:
        db_my.add(asset)
    db_my.commit()

    # Re-fetch assets to get database IDs
    db_assets = db_my.query(Asset).all()
    assets_map = {asset.asset_tag: asset.id for asset in db_assets}

    print("Seeding Knowledge Base articles in PostgreSQL...")
    kb_data = [
        KnowledgeArticle(title="How to connect to Global VPN", content="To connect to the corporate VPN:\n1. Open Cisco AnyConnect Secure Mobility Client.\n2. Enter gateway: 'vpn.enterprise.local'.\n3. Click Connect.\n4. Input your Active Directory credentials.\n5. Approve the login notification on your Duo mobile security app.", category="Network", author_id=admin.id),
        KnowledgeArticle(title="Self-Service Active Directory Password Resets", content="Users can reset expired or forgotten AD passwords through the self-service web portal:\n1. Click the 'AD Reset' tab on the ITSM dashboard.\n2. Enter your AD Username.\n3. Input your current password.\n4. Enter a strong new password (minimum 8 characters, at least 1 digit, and 1 uppercase letter).\n5. Click Reset. Note: Too many failed resets will lock your account.", category="Security", author_id=admin.id),
        KnowledgeArticle(title="Troubleshooting Local Printer Disconnections", content="If your local printer shows as offline:\n1. Verify both the power cord and USB interface cable are seated tightly.\n2. Power cycle the printer.\n3. Open Run (Win + R), type 'services.msc', scroll to 'Print Spooler' and click 'Restart'.\n4. If using network printer, ping the IP address found on the printer configuration page.", category="Hardware", author_id=operator.id)
    ]
    for article in kb_data:
        db_pg.add(article)
    db_pg.commit()

    # Define past datetimes
    now = datetime.datetime.utcnow()
    two_days_ago = now - datetime.timedelta(days=2)
    three_days_ago = now - datetime.timedelta(days=3)
    five_days_ago = now - datetime.timedelta(days=5)

    print("Seeding Historical Incidents and RCAs in PostgreSQL...")
    
    # 1. Resolved Incident P1 (SLA Met)
    p1_resolved = Incident(
        ticket_number="INC-1001",
        title="Primary Active Directory Controller Offline",
        description="Active Directory domain controller is completely unresponsive. Domain authentication is failing for all client workstations, halting production.",
        priority="P1",
        status="Resolved",
        category="Access",
        sla_deadline=SLAEngine.calculate_deadline("P1", two_days_ago),
        sla_status="Met",
        requester_id=john.id,
        assigned_agent_id=operator.id,
        cmdb_asset_id=assets_map["AST-1002"],
        created_at=two_days_ago,
        resolved_at=two_days_ago + datetime.timedelta(minutes=90),
        mttr_seconds=5400,  # 90 minutes (2h limit)
        escalation_level=2,
        escalation_reason="Tier 1 support unable to resolve domain controller hardware fault. Transferred to Tier 2."
    )
    db_pg.add(p1_resolved)
    db_pg.commit()

    # Seed Root Cause Analysis (RCA) for the P1 Incident
    rca = RCA(
        incident_id=p1_resolved.id,
        root_cause="Overheating caused physical disk controller failure on primary AD server host (Dell PowerEdge R760). Secondary backup DC failed to synchronize active sessions automatically due to a DNS configuration error.",
        corrective_action="Physically replaced server array controllers. Restarted domain services on secondary domain controller and updated DNS records to restore failover.",
        preventative_action="Install temperature threshold alarms in Server Rack B. Schedule bi-weekly failover simulations between AD controllers. Set up secondary replication check script.",
        created_by_id=operator.id,
        created_at=two_days_ago + datetime.timedelta(hours=4)
    )
    db_pg.add(rca)

    # 2. Resolved Incident P2 (SLA Breached)
    p2_resolved = Incident(
        ticket_number="INC-1002",
        title="Core ERP Database Replication Lag",
        description="DB latency causing transactions to back up. Master-Slave sync lag has exceeded 3000 seconds, reporting duplicate transaction exceptions.",
        priority="P2",
        status="Resolved",
        category="Database",
        sla_deadline=SLAEngine.calculate_deadline("P2", three_days_ago),
        sla_status="Breached",
        requester_id=john.id,
        assigned_agent_id=admin.id,
        cmdb_asset_id=assets_map["AST-1004"],
        created_at=three_days_ago,
        resolved_at=three_days_ago + datetime.timedelta(hours=14),
        mttr_seconds=50400,  # 14 hours (8h limit)
        escalation_level=3,
        escalation_reason="Database deadlock required Senior DBA database restoration."
    )
    db_pg.add(p2_resolved)

    # 3. Open Incident P1 (Active) - Created 30 mins ago
    db_pg.add(Incident(
        ticket_number="INC-1003",
        title="HQ Switch Port Deadlock",
        description="4th Floor Cisco switch ports are blinking amber. Entire 4th floor finance wing has lost physical LAN connectivity to the network storage array.",
        priority="P1",
        status="New",
        category="Network",
        sla_deadline=SLAEngine.calculate_deadline("P1", now - datetime.timedelta(minutes=30)),
        sla_status="Active",
        requester_id=john.id,
        cmdb_asset_id=assets_map["AST-1003"],
        created_at=now - datetime.timedelta(minutes=30),
        escalation_level=1
    ))

    # 4. Open Incident P2 (Warning status - Created 7.5 hours ago)
    # SLA deadline is in 30 minutes, which represents 93.7% elapsed time.
    db_pg.add(Incident(
        ticket_number="INC-1004",
        title="Developer MacBook Screen Artifacting",
        description="Display shows green lines. John cannot debug code. Requires hardware diagnostics or replacement.",
        priority="P2",
        status="In Progress",
        category="Hardware",
        sla_deadline=SLAEngine.calculate_deadline("P2", now - datetime.timedelta(hours=7, minutes=30)),
        sla_status="Warning",
        requester_id=john.id,
        assigned_agent_id=jane.id,
        cmdb_asset_id=assets_map["AST-1001"],
        created_at=now - datetime.timedelta(hours=7, minutes=30),
        escalation_level=1
    ))

    # 5. Open Incident P3 (Breached status - Created 26 hours ago)
    # SLA target is 24 hours. Current time is past the SLA target.
    db_pg.add(Incident(
        ticket_number="INC-1005",
        title="Excel macro plugin crash",
        description="Accounting add-in crashes upon parsing monthly spreadsheets. Prevents John from generating reports.",
        priority="P3",
        status="Assigned",
        category="Software",
        sla_deadline=SLAEngine.calculate_deadline("P3", now - datetime.timedelta(hours=26)),
        sla_status="Breached",
        requester_id=john.id,
        assigned_agent_id=jane.id,
        created_at=now - datetime.timedelta(hours=26),
        escalation_level=2,
        escalation_reason="Auto-Escalation: 30% of SLA target elapsed."
    ))

    print("Seeding Service Requests in PostgreSQL...")
    requests_data = [
        ServiceRequest(ticket_number="REQ-1001", title="New Laptop Allocation Request", description="Provision new laptop for developer onboarding.", item_type="Laptop Provisioning", cost=1850.00, status="Pending Approval", requester_id=john.id, created_at=two_days_ago),
        ServiceRequest(ticket_number="REQ-1002", title="Visual Studio Enterprise License", description="Need a VS Enterprise subscription for debugging legacy code bases.", item_type="Software License", cost=45.00, status="Approved", requester_id=john.id, created_at=three_days_ago),
        ServiceRequest(ticket_number="REQ-1003", title="Global VPN Connection Access", description="Requesting network access to log in remotely while traveling.", item_type="VPN Access", cost=0.00, status="Fulfilled", requester_id=john.id, created_at=five_days_ago, completed_at=five_days_ago + datetime.timedelta(hours=2))
    ]
    for req in requests_data:
        db_pg.add(req)

    print("Seeding Audit Logs in PostgreSQL...")
    audit_data = [
        AuditLog(action="USER_REGISTRATION", username="system", details="System database default seeds populated.", status="Success", timestamp=five_days_ago),
        AuditLog(action="PASSWORD_RESET", username="administrator", details="Password reset successful in Active Directory. Synced to local DB.", status="Success", timestamp=three_days_ago + datetime.timedelta(hours=1)),
        AuditLog(action="TICKET_ESCALATION", details="Incident INC-1001 manually escalated from L1 to L2. Reason: Hardware diagnostic failed.", status="Success", timestamp=two_days_ago + datetime.timedelta(minutes=20)),
        AuditLog(action="SLA_BREACH", details="SLA Breached for Incident INC-1002 (Priority: P2). Resolution took 14.0 hours.", status="Failure", timestamp=three_days_ago + datetime.timedelta(hours=8))
    ]
    for audit in audit_data:
        db_pg.add(audit)

    db_pg.commit()
    db_pg.close()
    db_my.close()
    print("Databases successfully seeded!")

if __name__ == "__main__":
    seed_databases()
