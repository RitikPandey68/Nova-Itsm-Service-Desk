// NovaITSM Front-End Application Logic

// Application State
let currentUser = null;
let token = null;
let charts = {};
let slaTimerInterval = null;

// API Fetch Helper wrapper
async function apiFetch(endpoint, options = {}) {
    const activeToken = localStorage.getItem("access_token") || token;
    
    // Set headers
    if (!options.headers) {
        options.headers = {};
    }
    
    if (activeToken) {
        options.headers["Authorization"] = `Bearer ${activeToken}`;
    }
    
    // Default JSON headers
    if (!(options.body instanceof FormData) && !options.headers["Content-Type"]) {
        options.headers["Content-Type"] = "application/json";
    }

    try {
        const response = await fetch(endpoint, options);
        
        if (response.status === 401) {
            logout();
            throw new Error("Session expired. Please authenticate again.");
        }
        
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.detail || `Server error: ${response.status}`);
        }
        
        // Handle 204 No Content
        if (response.status === 204) {
            return null;
        }
        
        return await response.json();
    } catch (err) {
        console.error(`API Fetch Error [${endpoint}]:`, err);
        throw err;
    }
}

// ==========================================
// Initialization & Authentication
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
    // Check for saved session
    const savedToken = localStorage.getItem("access_token");
    const savedUser = localStorage.getItem("user");
    
    if (savedToken && savedUser) {
        token = savedToken;
        currentUser = JSON.parse(savedUser);
        setupUIForUser();
        switchTab("dashboard");
    } else {
        showLoginScreen();
    }
    
    // Set up form listeners
    document.getElementById("login-form").addEventListener("submit", handleLoginSubmit);
    document.getElementById("create-incident-form").addEventListener("submit", handleCreateIncidentSubmit);
    document.getElementById("create-asset-form").addEventListener("submit", handleCreateAssetSubmit);
    document.getElementById("resolve-ticket-form").addEventListener("submit", handleResolveTicketSubmit);
    document.getElementById("submit-rca-form").addEventListener("submit", handleRCASubmit);
    document.getElementById("create-request-form").addEventListener("submit", handleCreateRequestSubmit);
    document.getElementById("create-article-form").addEventListener("submit", handleCreateArticleSubmit);
    document.getElementById("ad-reset-form").addEventListener("submit", handleADResetSubmit);
});

function showLoginScreen() {
    document.getElementById("login-screen").classList.remove("hidden");
    document.getElementById("app-container").classList.add("hidden");
}

async function handleLoginSubmit(e) {
    e.preventDefault();
    const usernameInput = document.getElementById("login-username").value;
    const passwordInput = document.getElementById("login-password").value;
    const errorDiv = document.getElementById("login-error");
    const btn = document.getElementById("login-btn");
    
    errorDiv.classList.add("hidden");
    btn.disabled = true;
    btn.innerHTML = '<span>Authenticating...</span> <i class="fa-solid fa-spinner fa-spin"></i>';
    
    try {
        // OAuth2 Password Grant format (form URL-encoded)
        const formData = new URLSearchParams();
        formData.append("username", usernameInput);
        formData.append("password", passwordInput);
        
        const data = await apiFetch("/api/auth/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: formData.toString()
        });
        
        token = data.access_token;
        currentUser = data.user;
        
        localStorage.setItem("access_token", token);
        localStorage.setItem("user", JSON.stringify(currentUser));
        
        setupUIForUser();
        
        // Hide login and show app
        document.getElementById("login-screen").classList.add("hidden");
        document.getElementById("app-container").classList.remove("hidden");
        
        // Clear login fields
        document.getElementById("login-username").value = "";
        document.getElementById("login-password").value = "";
        
        switchTab("dashboard");
    } catch (err) {
        errorDiv.textContent = err.message || "Invalid AD Credentials or locked account.";
        errorDiv.classList.remove("hidden");
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>Authenticate Securely</span> <i class="fa-solid fa-arrow-right-to-bracket"></i>';
    }
}

function setupUIForUser() {
    document.getElementById("sidebar-user-name").textContent = currentUser.username;
    
    const roleBadge = document.getElementById("sidebar-user-role");
    roleBadge.textContent = currentUser.role;
    roleBadge.className = "badge"; // Reset class list
    if (currentUser.role === "admin") {
        roleBadge.classList.add("badge-danger");
    } else if (currentUser.role === "agent") {
        roleBadge.classList.add("badge-info");
    } else {
        roleBadge.classList.add("badge-gray");
    }
    
    // Hide administrative configurations if user
    if (currentUser.role === "user") {
        document.getElementById("btn-add-asset").classList.add("hidden");
        document.getElementById("btn-create-kb").classList.add("hidden");
        document.getElementById("ad-admin-unlock-zone").classList.add("hidden");
    } else {
        document.getElementById("btn-add-asset").classList.remove("hidden");
        document.getElementById("btn-create-kb").classList.remove("hidden");
        if (currentUser.role === "admin") {
            document.getElementById("ad-admin-unlock-zone").classList.remove("hidden");
            populateUnlockDropdown();
        }
    }
}

function logout() {
    localStorage.removeItem("access_token");
    localStorage.removeItem("user");
    currentUser = null;
    token = null;
    
    if (slaTimerInterval) {
        clearInterval(slaTimerInterval);
    }
    
    showLoginScreen();
}

// ==========================================
// Navigation & View Toggling
// ==========================================

function switchTab(tabName) {
    // Stop any active ticket intervals
    if (slaTimerInterval) {
        clearInterval(slaTimerInterval);
    }
    
    // Toggle active classes in sidebar
    document.querySelectorAll(".nav-item").forEach(item => {
        item.classList.remove("active");
    });
    const activeNav = document.getElementById(`nav-${tabName}`);
    if (activeNav) activeNav.classList.add("active");
    
    // Toggle page views
    document.querySelectorAll(".view-section").forEach(view => {
        view.classList.add("hidden");
    });
    document.getElementById(`view-${tabName}`).classList.remove("hidden");
    
    // Load dynamic data for view
    if (tabName === "dashboard") {
        loadDashboard();
    } else if (tabName === "incidents") {
        fetchIncidents();
        populateAssetDropdowns();
    } else if (tabName === "requests") {
        fetchRequests();
    } else if (tabName === "assets") {
        fetchAssets();
    } else if (tabName === "knowledge") {
        fetchKnowledge();
    } else if (tabName === "ad-reset") {
        loadADTab();
    } else if (tabName === "servicenow") {
        initServiceNowPDI();
    }
}

function switchSubTab(subTabName) {
    document.querySelectorAll(".tab-sub-btn").forEach(btn => {
        btn.classList.remove("active");
    });
    document.getElementById(`sub-tab-${subTabName}`).classList.add("active");
    
    document.querySelectorAll(".sub-view-section").forEach(view => {
        view.classList.add("hidden");
    });
    document.getElementById(`sub-view-${subTabName}`).classList.remove("hidden");
}

// ==========================================
// Operations Dashboard Controller
// ==========================================

async function loadDashboard() {
    try {
        const metrics = await apiFetch("/api/dashboard/metrics");
        
        // Populate Metric count cards
        document.getElementById("m-open-incidents").textContent = metrics.total_open_incidents;
        document.getElementById("m-sla-compliance").textContent = `${metrics.sla_compliance_rate}%`;
        document.getElementById("m-mttr").textContent = `${metrics.avg_mttr_hours}h`;
        document.getElementById("m-escalated").textContent = metrics.escalated_count;
        document.getElementById("m-unassigned").textContent = metrics.unassigned_count;
        
        // SLA compliance glow alert
        const complianceCard = document.getElementById("m-sla-compliance").closest(".metric-card");
        if (metrics.sla_compliance_rate < 90) {
            complianceCard.style.boxShadow = "0 0 15px rgba(244, 63, 94, 0.2)";
            complianceCard.style.borderColor = "var(--accent-red)";
        } else {
            complianceCard.style.boxShadow = "";
            complianceCard.style.borderColor = "";
        }

        // Render Dashboard Charts
        renderSLAChart(metrics.sla_stats);
        renderPriorityChart(metrics.priority_stats);
        
        // Render Audits Table
        populateAuditLogs(metrics.recent_audit_logs);
        
        // Load SLA Live Health timers
        loadSLALiveHealth();
        
        // Check for urgent escalations (P1 incidents unassigned or breached)
        checkUrgentNotifications(metrics.total_open_incidents);
    } catch (err) {
        console.error("Failed to load dashboard metrics:", err);
    }
}

function renderSLAChart(slaStats) {
    const ctx = document.getElementById("chart-sla").getContext("2d");
    
    if (charts.sla) {
        charts.sla.destroy();
    }
    
    charts.sla = new Chart(ctx, {
        type: "doughnut",
        data: {
            labels: ["Met", "Active", "Warning", "Breached"],
            datasets: [{
                data: [slaStats.met, slaStats.active, slaStats.warning, slaStats.breached],
                backgroundColor: ["#10b981", "#38bdf8", "#f59e0b", "#f43f5e"],
                borderWidth: 2,
                borderColor: "#10162a"
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: "bottom",
                    labels: { color: "#e2e8f0", font: { family: "Inter", size: 11 } }
                }
            },
            cutout: "70%"
        }
    });
}

function renderPriorityChart(priorityStats) {
    const ctx = document.getElementById("chart-priority").getContext("2d");
    
    if (charts.priority) {
        charts.priority.destroy();
    }
    
    charts.priority = new Chart(ctx, {
        type: "bar",
        data: {
            labels: ["P1 Critical", "P2 High", "P3 Medium", "P4 Low"],
            datasets: [{
                label: "Incident Count",
                data: [priorityStats.p1, priorityStats.p2, priorityStats.p3, priorityStats.p4],
                backgroundColor: ["#f43f5e", "#f59e0b", "#38bdf8", "#10b981"],
                borderWidth: 0,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    grid: { color: "rgba(255,255,255,0.05)" },
                    ticks: { color: "#94a3b8", stepSize: 1 }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: "#94a3b8" }
                }
            }
        }
    });
}

function populateAuditLogs(logs) {
    const tbody = document.getElementById("audit-log-rows");
    tbody.innerHTML = "";
    
    if (!logs || logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No audit trails available.</td></tr>';
        return;
    }
    
    logs.forEach(log => {
        const tr = document.createElement("tr");
        const date = new Date(log.timestamp).toLocaleTimeString();
        const badgeClass = log.status === "Success" ? "badge-success" : "badge-danger";
        
        tr.innerHTML = `
            <td>${date}</td>
            <td><strong class="text-warning">${log.action}</strong></td>
            <td><i class="fa-regular fa-user"></i> ${log.username || "System Process"}</td>
            <td>${log.details}</td>
            <td><span class="badge ${badgeClass}">${log.status}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

async function loadSLALiveHealth() {
    try {
        // Fetch all open tickets to show live SLA countdowns
        const tickets = await apiFetch("/api/incidents/?status=New&status=Assigned&status=In%20Progress&status=Pending");
        const listDiv = document.getElementById("sla-health-indicators");
        listDiv.innerHTML = "";
        
        const openTickets = tickets.filter(t => !["Resolved", "Closed"].includes(t.status));
        
        if (openTickets.length === 0) {
            listDiv.innerHTML = '<div class="no-indicator-data">No active tickets to track.</div>';
            return;
        }
        
        openTickets.forEach(ticket => {
            const row = document.createElement("div");
            row.className = "sla-indicator-row";
            if (ticket.sla_status === "Breached") {
                row.classList.add("breached");
            }
            
            row.innerHTML = `
                <div class="sla-indicator-info">
                    <h4>${ticket.ticket_number} - ${ticket.title}</h4>
                    <span>Priority: <strong>${ticket.priority}</strong> | Status: <strong>${ticket.status}</strong></span>
                </div>
                <div class="sla-countdown">
                    <div class="sla-time-remaining" id="countdown-${ticket.id}" data-deadline="${ticket.sla_deadline}">Calculating...</div>
                    <span class="badge ${getSLABadgeClass(ticket.sla_status)}">${ticket.sla_status}</span>
                </div>
            `;
            listDiv.appendChild(row);
        });
        
        // Start live ticking countdowns
        updateCountdownTimers();
        slaTimerInterval = setInterval(updateCountdownTimers, 1000);
        
    } catch (err) {
        console.error("Error loading live SLA Health:", err);
    }
}

function updateCountdownTimers() {
    const timers = document.querySelectorAll("[id^='countdown-']");
    timers.forEach(timer => {
        const deadlineStr = timer.getAttribute("data-deadline");
        const deadline = new Date(deadlineStr);
        const now = new Date();
        const diffMs = deadline - now;
        
        if (diffMs <= 0) {
            timer.innerHTML = '<span class="text-danger">BREACHED</span>';
        } else {
            const diffSecs = Math.floor(diffMs / 1000);
            const hours = Math.floor(diffSecs / 3600);
            const minutes = Math.floor((diffSecs % 3600) / 60);
            const seconds = diffSecs % 60;
            
            const hoursStr = String(hours).padStart(2, "0");
            const minsStr = String(minutes).padStart(2, "0");
            const secsStr = String(seconds).padStart(2, "0");
            
            // Highlight color based on remaining time
            let colorClass = "text-success";
            if (hours === 0 && minutes < 30) {
                colorClass = "text-danger";
            } else if (hours < 2) {
                colorClass = "text-warning";
            }
            
            timer.innerHTML = `<span class="${colorClass}">${hoursStr}:${minsStr}:${secsStr}</span>`;
        }
    });
}

function checkUrgentNotifications(openCount) {
    // Query P1/P2 incidents specifically to trigger alerts
    apiFetch("/api/incidents/").then(tickets => {
        const criticalIncidents = tickets.filter(t => ["P1", "P2"].includes(t.priority) && !["Resolved", "Closed"].includes(t.status));
        const alertBadge = document.getElementById("alert-badge-count");
        const alertList = document.getElementById("alert-list-items");
        
        if (criticalIncidents.length > 0) {
            alertBadge.textContent = criticalIncidents.length;
            alertBadge.classList.remove("hidden");
            
            alertList.innerHTML = "";
            criticalIncidents.forEach(inc => {
                const li = document.createElement("li");
                li.className = inc.priority === "P1" ? "priority-p1" : "";
                li.innerHTML = `
                    <div style="font-weight:600;">⚠️ ${inc.ticket_number} - ${inc.priority} Alert</div>
                    <div>${inc.title} - SLA deadline: ${new Date(inc.sla_deadline).toLocaleTimeString()}</div>
                `;
                alertList.appendChild(li);
            });
        } else {
            alertBadge.classList.add("hidden");
            alertList.innerHTML = '<li class="no-alerts">No active escalation alerts.</li>';
        }
    }).catch(console.error);
}

function toggleAlertDropdown() {
    const dropdown = document.getElementById("alert-dropdown-menu");
    dropdown.classList.toggle("hidden");
}

function clearAlerts(e) {
    e.stopPropagation();
    document.getElementById("alert-badge-count").classList.add("hidden");
    document.getElementById("alert-dropdown-menu").classList.add("hidden");
}

// ==========================================
// Incidents Queue Controller
// ==========================================

async function fetchIncidents() {
    const statusFilter = document.getElementById("filter-status").value;
    const priorityFilter = document.getElementById("filter-priority").value;
    
    let url = "/api/incidents/?";
    if (statusFilter) url += `status=${statusFilter}&`;
    if (priorityFilter) url += `priority=${priorityFilter}&`;
    
    try {
        const incidents = await apiFetch(url);
        const tbody = document.getElementById("incident-queue-rows");
        tbody.innerHTML = "";
        
        if (incidents.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">No incidents match active filters.</td></tr>';
            return;
        }
        
        incidents.forEach(inc => {
            const tr = document.createElement("tr");
            
            // Format dates
            const date = new Date(inc.created_at).toLocaleDateString();
            
            // Show dynamic action buttons depending on roles & status
            let actionButtons = "";
            const isAgent = ["agent", "admin"].includes(currentUser.role);
            
            if (!["Resolved", "Closed"].includes(inc.status)) {
                if (isAgent) {
                    // Assignment button
                    if (inc.assigned_agent_id !== currentUser.id) {
                        actionButtons += `<button class="btn btn-outline" style="padding: 4px 8px; font-size:11px;" onclick="assignTicket(${inc.id})">Claim</button> `;
                    }
                    
                    // Resolve button
                    actionButtons += `<button class="btn btn-success" style="padding: 4px 8px; font-size:11px;" onclick="openResolveModal(${inc.id}, '${inc.priority}')">Resolve</button> `;
                    
                    // Escalate button (only up to level 3)
                    if (inc.escalation_level < 3) {
                        actionButtons += `<button class="btn btn-danger" style="padding: 4px 8px; font-size:11px;" onclick="escalateTicketPrompt(${inc.id})"><i class="fa-solid fa-arrow-turn-up"></i></button> `;
                    }
                }
            } else if (inc.status === "Resolved" && isAgent) {
                // Submit RCA button
                actionButtons += `<button class="btn btn-primary" style="padding: 4px 8px; font-size:11px;" onclick="openRCASubmission(${inc.id}, '${inc.ticket_number}', '${inc.title}')">Submit RCA</button> `;
            }
            
            // Delete button (Admin only)
            if (currentUser.role === "admin") {
                actionButtons += `<button class="btn btn-outline-danger" style="padding: 4px 8px; font-size:11px;" onclick="deleteTicket(${inc.id})"><i class="fa-solid fa-trash-can"></i></button>`;
            }

            if (!actionButtons) {
                actionButtons = '<span class="text-muted">None</span>';
            }
            
            // Link asset text
            const assetTagText = inc.asset ? `<span class="asset-tag" title="${inc.asset.name}">${inc.asset.asset_tag}</span>` : '<span class="text-muted">-</span>';
            
            tr.innerHTML = `
                <td><strong>${inc.ticket_number}</strong></td>
                <td>
                    <div style="font-weight:600;">${inc.title}</div>
                    <div class="text-muted" style="font-size:11px;">Asset: ${assetTagText} | Dept: ${inc.requester.department}</div>
                </td>
                <td><span class="badge ${getPriorityBadgeClass(inc.priority)}">${inc.priority}</span></td>
                <td>${inc.category}</td>
                <td><span class="badge ${getStatusBadgeClass(inc.status)}">${inc.status}</span></td>
                <td><i class="fa-regular fa-circle-user"></i> ${inc.assigned_agent ? inc.assigned_agent.username : '<span class="text-warning">Unassigned</span>'}</td>
                <td>
                    <div>${new Date(inc.sla_deadline).toLocaleTimeString()}</div>
                    <span class="badge ${getSLABadgeClass(inc.sla_status)}">${inc.sla_status}</span>
                </td>
                <td>
                    <span class="badge ${inc.escalation_level > 1 ? 'badge-danger' : 'badge-gray'}">L${inc.escalation_level}</span>
                </td>
                <td>${actionButtons}</td>
            `;
            tbody.appendChild(tr);
        });
        
    } catch (err) {
        console.error("Error fetching incidents:", err);
    }
}

function resetIncidentFilters() {
    document.getElementById("filter-status").value = "";
    document.getElementById("filter-priority").value = "";
    fetchIncidents();
}

async function assignTicket(ticketId) {
    try {
        await apiFetch(`/api/incidents/${ticketId}`, {
            method: "PUT",
            body: JSON.stringify({ assigned_agent_id: currentUser.id })
        });
        fetchIncidents();
    } catch (err) {
        alert("Failed to claim ticket: " + err.message);
    }
}

function openResolveModal(ticketId, priority) {
    document.getElementById("resolve-ticket-id").value = ticketId;
    document.getElementById("resolve-summary").value = "";
    
    const rcaCheckbox = document.getElementById("p1-rca-checkbox-container");
    if (priority === "P1" || priority === "P2") {
        rcaCheckbox.classList.remove("hidden");
        document.getElementById("resolve-trigger-rca").checked = true;
    } else {
        rcaCheckbox.classList.add("hidden");
        document.getElementById("resolve-trigger-rca").checked = false;
    }
    
    openModal("resolve-ticket-modal");
}

async function handleResolveTicketSubmit(e) {
    e.preventDefault();
    const id = document.getElementById("resolve-ticket-id").value;
    const summary = document.getElementById("resolve-summary").value;
    const triggerRCA = document.getElementById("resolve-trigger-rca").checked;
    
    try {
        const resolvedInc = await apiFetch(`/api/incidents/${id}`, {
            method: "PUT",
            body: JSON.stringify({
                status: "Resolved",
                description: summary // Append resolution info to description or handle resolver log
            })
        });
        
        closeModal("resolve-ticket-modal");
        fetchIncidents();
        
        if (triggerRCA) {
            openRCASubmission(resolvedInc.id, resolvedInc.ticket_number, resolvedInc.title);
        }
    } catch (err) {
        alert("Error resolving ticket: " + err.message);
    }
}

function openRCASubmission(incidentId, ticketNum, title) {
    document.getElementById("rca-incident-id").value = incidentId;
    document.getElementById("rca-incident-title").value = `${ticketNum} - ${title}`;
    document.getElementById("rca-root-cause").value = "";
    document.getElementById("rca-corrective").value = "";
    document.getElementById("rca-preventative").value = "";
    
    openModal("submit-rca-modal");
}

async function handleRCASubmit(e) {
    e.preventDefault();
    const incident_id = parseInt(document.getElementById("rca-incident-id").value);
    const root_cause = document.getElementById("rca-root-cause").value;
    const corrective_action = document.getElementById("rca-corrective").value;
    const preventative_action = document.getElementById("rca-preventative").value;
    
    try {
        await apiFetch("/api/knowledge/rca", {
            method: "POST",
            body: JSON.stringify({ incident_id, root_cause, corrective_action, preventative_action })
        });
        closeModal("submit-rca-modal");
        alert("RCA successfully submitted to problem log!");
        fetchIncidents();
    } catch (err) {
        alert("Failed to submit RCA: " + err.message);
    }
}

async function escalateTicketPrompt(ticketId) {
    const reason = prompt("Enter a justification reason for manual tier escalation:");
    if (!reason) return;
    
    try {
        await apiFetch(`/api/incidents/${ticketId}/escalate?reason=${encodeURIComponent(reason)}`, {
            method: "POST"
        });
        fetchIncidents();
    } catch (err) {
        alert("Failed to escalate: " + err.message);
    }
}

async function deleteTicket(ticketId) {
    if (!confirm("Are you sure you want to permanently delete this ticket from the system?")) return;
    
    try {
        await apiFetch(`/api/incidents/${ticketId}`, {
            method: "DELETE"
        });
        fetchIncidents();
    } catch (err) {
        alert("Failed to delete ticket: " + err.message);
    }
}

async function handleCreateIncidentSubmit(e) {
    e.preventDefault();
    const title = document.getElementById("incident-title").value;
    const description = document.getElementById("incident-desc").value;
    const priority = document.getElementById("incident-priority").value;
    const category = document.getElementById("incident-category").value;
    const cmdb_asset_id_str = document.getElementById("incident-asset").value;
    const cmdb_asset_id = cmdb_asset_id_str ? parseInt(cmdb_asset_id_str) : null;
    
    try {
        await apiFetch("/api/incidents/", {
            method: "POST",
            body: JSON.stringify({ title, description, priority, category, cmdb_asset_id })
        });
        
        closeModal("create-incident-modal");
        
        // Reset form fields
        document.getElementById("incident-title").value = "";
        document.getElementById("incident-desc").value = "";
        document.getElementById("incident-priority").value = "P3";
        document.getElementById("incident-category").value = "Software";
        document.getElementById("incident-asset").value = "";
        
        fetchIncidents();
        alert("Incident reported successfully! The SLA tracker is active.");
    } catch (err) {
        alert("Failed to create incident: " + err.message);
    }
}

// ==========================================
// Service Request Catalog Controller
// ==========================================

function openRequestModal(itemName, cost) {
    document.getElementById("req-item-type").value = itemName;
    document.getElementById("req-item-cost").value = cost;
    document.getElementById("req-item-display").value = `${itemName} (${cost > 0 ? '$' + cost.toFixed(2) : 'Free'})`;
    document.getElementById("req-title").value = "";
    document.getElementById("req-desc").value = "";
    
    openModal("create-request-modal");
}

async function handleCreateRequestSubmit(e) {
    e.preventDefault();
    const item_type = document.getElementById("req-item-type").value;
    const cost = parseFloat(document.getElementById("req-item-cost").value);
    const title = document.getElementById("req-title").value;
    const description = document.getElementById("req-desc").value;
    
    try {
        await apiFetch("/api/requests/", {
            method: "POST",
            body: JSON.stringify({ title, description, item_type, cost })
        });
        closeModal("create-request-modal");
        fetchRequests();
        alert("Service Request submitted. Requires Tier 2 provisioning approval.");
    } catch (err) {
        alert("Failed to submit request: " + err.message);
    }
}

async function fetchRequests() {
    try {
        const requests = await apiFetch("/api/requests/");
        const tbody = document.getElementById("service-request-rows");
        tbody.innerHTML = "";
        
        if (requests.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No service requests logged.</td></tr>';
            return;
        }
        
        requests.forEach(req => {
            const tr = document.createElement("tr");
            const date = new Date(req.created_at).toLocaleDateString();
            const costStr = req.cost > 0 ? `$${req.cost.toFixed(2)}` : "Free";
            
            // Build action buttons for approvals
            let actions = "";
            const isAgent = ["agent", "admin"].includes(currentUser.role);
            
            if (req.status === "Pending Approval" && isAgent) {
                actions += `<button class="btn btn-success" style="padding: 4px 8px; font-size:11px;" onclick="approveRequest(${req.id})">Approve</button> `;
                actions += `<button class="btn btn-danger" style="padding: 4px 8px; font-size:11px;" onclick="rejectRequest(${req.id})">Deny</button> `;
            } else if (req.status === "Approved" && isAgent) {
                actions += `<button class="btn btn-primary" style="padding: 4px 8px; font-size:11px;" onclick="fulfillRequest(${req.id})">Fulfill</button> `;
            }
            
            if (!actions) {
                actions = '<span class="text-muted">Completed</span>';
            }
            
            tr.innerHTML = `
                <td><strong>${req.ticket_number}</strong></td>
                <td>
                    <div style="font-weight:600;">${req.item_type}</div>
                    <div class="text-muted" style="font-size:11px;">Justification: ${req.title}</div>
                </td>
                <td>${req.requester.username} (${req.requester.department})</td>
                <td><strong class="text-success">${costStr}</strong></td>
                <td><span class="badge ${getRequestBadgeClass(req.status)}">${req.status}</span></td>
                <td>${date}</td>
                <td>${actions}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error("Failed to load requests catalog:", err);
    }
}

async function approveRequest(reqId) {
    try {
        await apiFetch(`/api/requests/${reqId}`, {
            method: "PUT",
            body: JSON.stringify({ status: "Approved" })
        });
        fetchRequests();
    } catch (err) {
        alert("Failed to approve: " + err.message);
    }
}

async function rejectRequest(reqId) {
    try {
        await apiFetch(`/api/requests/${reqId}`, {
            method: "PUT",
            body: JSON.stringify({ status: "Rejected" })
        });
        fetchRequests();
    } catch (err) {
        alert("Failed to deny: " + err.message);
    }
}

async function fulfillRequest(reqId) {
    try {
        await apiFetch(`/api/requests/${reqId}`, {
            method: "PUT",
            body: JSON.stringify({ status: "Fulfilled" })
        });
        fetchRequests();
        alert("Service Request marked as Fulfilled and provisioning closed.");
    } catch (err) {
        alert("Failed to fulfill request: " + err.message);
    }
}

// ==========================================
// CMDB Asset Controller (MySQL Data)
// ==========================================

async function fetchAssets() {
    try {
        const assets = await apiFetch("/api/assets/");
        const listDiv = document.getElementById("cmdb-assets-list");
        listDiv.innerHTML = "";
        
        if (assets.length === 0) {
            listDiv.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--text-muted);">No Configuration Items registered in CMDB.</div>';
            return;
        }
        
        assets.forEach(asset => {
            const card = document.createElement("div");
            card.className = "asset-card glassmorphic";
            
            let actionBtn = "";
            if (currentUser.role === "admin") {
                actionBtn = `<button class="btn btn-outline-danger" style="padding: 2px 6px; font-size:10px;" onclick="deleteAsset(${asset.id})"><i class="fa-solid fa-trash-can"></i> Decommission</button>`;
            }
            
            card.innerHTML = `
                <div class="asset-card-header">
                    <h4>${asset.name}</h4>
                    <span class="asset-tag">${asset.asset_tag}</span>
                </div>
                <div class="asset-details">
                    <p><span>Model:</span> <strong>${asset.model}</strong></p>
                    <p><span>Category:</span> <span>${asset.category}</span></p>
                    <p><span>Serial #:</span> <code style="color:var(--accent-blue);">${asset.serial_number}</code></p>
                    <p><span>CI Status:</span> <span class="badge ${getAssetBadgeClass(asset.status)}">${asset.status}</span></p>
                    <p><span>Assignee:</span> <span class="text-muted">${asset.owner_email || 'Unassigned'}</span></p>
                    <p><span>Value:</span> <strong class="text-success">$${asset.cost.toFixed(2)}</strong></p>
                </div>
                <div class="asset-card-footer">
                    ${actionBtn}
                </div>
            `;
            listDiv.appendChild(card);
        });
    } catch (err) {
        console.error("Failed to load CMDB assets:", err);
    }
}

async function deleteAsset(assetId) {
    if (!confirm("Are you sure you want to permanently remove this configuration item from CMDB?")) return;
    
    try {
        await apiFetch(`/api/assets/${assetId}`, {
            method: "DELETE"
        });
        fetchAssets();
    } catch (err) {
        alert("Error decommissioning asset: " + err.message);
    }
}

async function handleCreateAssetSubmit(e) {
    e.preventDefault();
    const name = document.getElementById("asset-name").value;
    const category = document.getElementById("asset-category").value;
    const model = document.getElementById("asset-model").value;
    const serial_number = document.getElementById("asset-serial").value;
    const status = document.getElementById("asset-status").value;
    const owner_email = document.getElementById("asset-owner").value || null;
    const cost = parseFloat(document.getElementById("asset-cost").value);
    
    try {
        await apiFetch("/api/assets/", {
            method: "POST",
            body: JSON.stringify({ name, category, model, serial_number, status, owner_email, cost })
        });
        
        closeModal("create-asset-modal");
        
        // Clear inputs
        document.getElementById("asset-name").value = "";
        document.getElementById("asset-model").value = "";
        document.getElementById("asset-serial").value = "";
        document.getElementById("asset-owner").value = "";
        document.getElementById("asset-cost").value = "0.00";
        
        fetchAssets();
        alert("New configuration asset registered in MySQL CMDB.");
    } catch (err) {
        alert("Failed to register asset: " + err.message);
    }
}

async function populateAssetDropdowns() {
    try {
        const assets = await apiFetch("/api/assets/");
        const select = document.getElementById("incident-asset");
        select.innerHTML = '<option value="">None - Unlinked Asset</option>';
        
        assets.forEach(asset => {
            const opt = document.createElement("option");
            opt.value = asset.id;
            opt.textContent = `${asset.asset_tag} - ${asset.name} (${asset.model})`;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error("Failed to populate asset selectors:", err);
    }
}

// ==========================================
// Knowledge & RCAs Controller
// ==========================================

async function fetchKnowledge() {
    try {
        // Fetch KB articles
        const articles = await apiFetch("/api/knowledge/");
        const kbDiv = document.getElementById("kb-articles-list");
        kbDiv.innerHTML = "";
        
        if (articles.length === 0) {
            kbDiv.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--text-muted);">No help guides found.</div>';
        } else {
            articles.forEach(art => {
                const card = document.createElement("div");
                card.className = "kb-article-card glassmorphic";
                card.innerHTML = `
                    <div>
                        <span class="badge badge-info" style="margin-bottom:10px;">${art.category}</span>
                        <h3>${art.title}</h3>
                        <p>${art.content}</p>
                    </div>
                    <div class="kb-card-footer">
                        <span><i class="fa-regular fa-eye"></i> ${art.views} views</span>
                        <button class="btn btn-outline" style="padding: 4px 10px; font-size:11px;" onclick="viewKBArticle(${art.id})">Read Guide</button>
                    </div>
                `;
                kbDiv.appendChild(card);
            });
        }
        
        // Fetch RCA Problem reports
        const rcas = await apiFetch("/api/knowledge/rca");
        const rcaDiv = document.getElementById("rca-articles-list");
        rcaDiv.innerHTML = "";
        
        if (rcas.length === 0) {
            rcaDiv.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--text-muted);">No RCA reports submitted in problem log.</div>';
        } else {
            rcas.forEach(rca => {
                const card = document.createElement("div");
                card.className = "rca-card glassmorphic";
                card.innerHTML = `
                    <div>
                        <span class="badge badge-danger" style="margin-bottom:10px;"><i class="fa-solid fa-microscope"></i> RCA Report</span>
                        <h3>Incident ID Reference: #${rca.incident_id}</h3>
                        <p><strong>Root Cause:</strong> ${rca.root_cause}</p>
                    </div>
                    <div class="rca-card-footer">
                        <span>Submitted: ${new Date(rca.created_at).toLocaleDateString()}</span>
                        <button class="btn btn-outline" style="padding: 4px 10px; font-size:11px;" onclick="viewRCADetails(${rca.incident_id})">View Analysis</button>
                    </div>
                `;
                rcaDiv.appendChild(card);
            });
        }
        
    } catch (err) {
        console.error("Failed to fetch knowledge bases:", err);
    }
}

async function viewKBArticle(id) {
    try {
        const art = await apiFetch(`/api/knowledge/${id}`);
        document.getElementById("kb-modal-title").textContent = art.title;
        document.getElementById("kb-modal-category").textContent = art.category;
        document.getElementById("kb-modal-author").textContent = art.author.username;
        document.getElementById("kb-modal-views").textContent = art.views;
        document.getElementById("kb-modal-content").textContent = art.content;
        
        openModal("view-kb-modal");
    } catch (err) {
        alert("Failed to fetch article details: " + err.message);
    }
}

async function viewRCADetails(incidentId) {
    try {
        const rca = await apiFetch(`/api/knowledge/rca/${incidentId}`);
        const inc = await apiFetch(`/api/incidents/${incidentId}`);
        
        document.getElementById("rca-modal-inc-num").textContent = `Linked Ticket: ${inc.ticket_number}`;
        document.getElementById("rca-modal-inc-title").textContent = `Title: ${inc.title}`;
        document.getElementById("rca-modal-root-cause").textContent = rca.root_cause;
        document.getElementById("rca-modal-corrective").textContent = rca.corrective_action;
        document.getElementById("rca-modal-preventative").textContent = rca.preventative_action;
        
        openModal("view-rca-modal");
    } catch (err) {
        alert("Failed to load RCA report: " + err.message);
    }
}

async function handleCreateArticleSubmit(e) {
    e.preventDefault();
    const title = document.getElementById("article-title").value;
    const category = document.getElementById("article-category").value;
    const content = document.getElementById("article-content").value;
    
    try {
        await apiFetch("/api/knowledge/", {
            method: "POST",
            body: JSON.stringify({ title, category, content })
        });
        closeModal("create-article-modal");
        
        document.getElementById("article-title").value = "";
        document.getElementById("article-content").value = "";
        
        fetchKnowledge();
        alert("Troubleshooting guide published to KB successfully!");
    } catch (err) {
        alert("Failed to publish article: " + err.message);
    }
}

function handleKBSearch(e) {
    const term = e.target.value.trim();
    if (e.key === "Enter" || term === "") {
        let url = "/api/knowledge/";
        if (term) url += `?search=${encodeURIComponent(term)}`;
        
        apiFetch(url).then(articles => {
            const kbDiv = document.getElementById("kb-articles-list");
            kbDiv.innerHTML = "";
            
            if (articles.length === 0) {
                kbDiv.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--text-muted);">No help guides matches search.</div>';
                return;
            }
            
            articles.forEach(art => {
                const card = document.createElement("div");
                card.className = "kb-article-card glassmorphic";
                card.innerHTML = `
                    <div>
                        <span class="badge badge-info" style="margin-bottom:10px;">${art.category}</span>
                        <h3>${art.title}</h3>
                        <p>${art.content}</p>
                    </div>
                    <div class="kb-card-footer">
                        <span><i class="fa-regular fa-eye"></i> ${art.views} views</span>
                        <button class="btn btn-outline" style="padding: 4px 10px; font-size:11px;" onclick="viewKBArticle(${art.id})">Read Guide</button>
                    </div>
                `;
                kbDiv.appendChild(card);
            });
        }).catch(console.error);
    }
}

// ==========================================
// Active Directory Mock Controller
// ==========================================

function loadADTab() {
    // Poll accounts status
    updateADAccountStatuses();
}

function updateADAccountStatuses() {
    // In our mock AD service, accounts show active or locked
    // Since lockouts are stored in Redis, let's fetch dashboard logs and locks
    // Or simpler: let the frontend query the active lockouts list or simulate
    // We can evaluate if logins/audits report AD_LOCKOUT to color the indicators
    apiFetch("/api/dashboard/metrics").then(metrics => {
        const logs = metrics.recent_audit_logs;
        const usernames = ["administrator", "john-doe", "jane-smith", "operator-desk"];
        
        usernames.forEach(name => {
            const elementId = `status-${name}`;
            const span = document.getElementById(elementId);
            
            // Check if there is an active lockout logged recently in audits
            const usernameClean = name.replace("-", ".");
            const accountLock = logs.find(log => log.action === "AD_LOCKOUT" && log.username === usernameClean);
            const accountUnlock = logs.find(log => log.action === "AD_UNLOCK" && log.username === usernameClean);
            
            let isLocked = false;
            if (accountLock) {
                if (!accountUnlock || new Date(accountLock.timestamp) > new Date(accountUnlock.timestamp)) {
                    isLocked = true;
                }
            }
            
            if (isLocked) {
                span.textContent = "LOCKED OUT";
                span.className = "badge badge-danger";
            } else {
                span.textContent = "ACTIVE";
                span.className = "badge badge-success";
            }
        });
    }).catch(console.error);
}

async function handleADResetSubmit(e) {
    e.preventDefault();
    const username = document.getElementById("ad-username").value;
    const old_password = document.getElementById("ad-old-password").value;
    const new_password = document.getElementById("ad-new-password").value;
    const statusDiv = document.getElementById("ad-reset-status");
    
    statusDiv.className = "alert hidden";
    
    try {
        const res = await apiFetch("/api/auth/reset-password", {
            method: "POST",
            body: JSON.stringify({ username, old_password, new_password })
        });
        
        statusDiv.textContent = res.message;
        statusDiv.classList.add("alert-success");
        statusDiv.classList.remove("hidden");
        
        // Reset password fields
        document.getElementById("ad-old-password").value = "";
        document.getElementById("ad-new-password").value = "";
        
        updateADAccountStatuses();
    } catch (err) {
        statusDiv.textContent = err.message || "Failed to reset AD Password.";
        statusDiv.classList.add("alert-danger");
        statusDiv.classList.remove("hidden");
        
        updateADAccountStatuses();
    }
}

async function populateUnlockDropdown() {
    const select = document.getElementById("unlock-username-select");
    select.innerHTML = "";
    
    const users = ["administrator", "john.doe", "jane.smith", "operator.desk"];
    users.forEach(u => {
        const opt = document.createElement("option");
        opt.value = u;
        opt.textContent = u;
        select.appendChild(opt);
    });
}

// Note: Administrative bypass unlock (simulating Active Directory Domain Controller unlocks)
// We didn't define a dedicated router route, but we can write a simple endpoint or mock it.
// Let's add an API route or trigger standard password overrides. Actually, we already have a service method: ActiveDirectoryMockService.unlock_ad_user.
// Let's call a post endpoint to mock admin override. For simplicity, we can register an audit log success on override!
async function forceUnlockADAccount() {
    const username = document.getElementById("unlock-username-select").value;
    
    try {
        const res = await apiFetch(`/api/auth/unlock/${username}`, {
            method: "POST"
        });
        alert(res.message);
        updateADAccountStatuses();
    } catch (err) {
        alert("Failed to unlock account: " + err.message);
    }
}

// ==========================================
// Modal Window Helpers
// ==========================================

function openModal(modalId) {
    document.getElementById(modalId).classList.remove("hidden");
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.add("hidden");
}

// ==========================================
// Badge / Class Name Resolvers
// ==========================================

function getPriorityBadgeClass(priority) {
    switch (priority) {
        case "P1": return "badge-danger";
        case "P2": return "badge-warning";
        case "P3": return "badge-info";
        case "P4": return "badge-success";
        default: return "badge-gray";
    }
}

function getStatusBadgeClass(status) {
    switch (status) {
        case "New": return "badge-info";
        case "Assigned": return "badge-purple";
        case "In Progress": return "badge-blue";
        case "Pending": return "badge-warning";
        case "Resolved": return "badge-success";
        case "Closed": return "badge-gray";
        default: return "badge-gray";
    }
}

function getSLABadgeClass(slaStatus) {
    switch (slaStatus) {
        case "Met": return "badge-success";
        case "Active": return "badge-info";
        case "Warning": return "badge-warning";
        case "Breached": return "badge-danger";
        default: return "badge-gray";
    }
}

function getRequestBadgeClass(status) {
    switch (status) {
        case "Pending Approval": return "badge-warning";
        case "Approved": return "badge-info";
        case "Fulfilled": return "badge-success";
        case "Rejected": return "badge-danger";
        default: return "badge-gray";
    }
}

function getAssetBadgeClass(status) {
    switch (status) {
        case "In Service": return "badge-success";
        case "In Stock": return "badge-info";
        case "Under Repair": return "badge-warning";
        case "Retired": return "badge-gray";
        default: return "badge-gray";
    }
}

function handleGlobalSearch(e) {
    const term = e.target.value.trim().toLowerCase();
    if (e.key === "Enter" && term) {
        alert(`Searching for [${term}] across ITSM indexes. Navigate to Incident Queue or Knowledge Base tabs to filter results.`);
    }
}

// ==========================================
// ServiceNow PDI Engine Sandbox Implementation
// ==========================================

let snPresets = null;
let snActiveClientScripts = {};
let snActiveUIPolicies = {};
let snActiveBusinessRules = {};
let snActiveFlow = null;
let currentSNConsoleTab = 'client-logs';

async function initServiceNowPDI() {
    // 1. Fetch presets if not already cached
    if (!snPresets) {
        try {
            snPresets = await apiFetch('/api/servicenow/presets');
            
            // Turn presets into map/active flags
            snPresets.client_scripts.forEach(s => {
                snActiveClientScripts[s.id] = true; // Enabled by default
            });
            snPresets.ui_policies.forEach(p => {
                snActiveUIPolicies[p.id] = true;
            });
            snPresets.business_rules.forEach(r => {
                snActiveBusinessRules[r.id] = true;
            });
        } catch (err) {
            console.error("Failed to load ServiceNow presets", err);
            addSNConsoleLog('client-logs', '[System Error] Failed to fetch presets from backend API.', 'error-line');
            return;
        }
    }
    
    // 2. Load configurations list
    renderSNPresets();
    
    // 3. Load flows
    populateSNFlows();
    
    // 4. Initialize first record form state
    resetSNForm();
}

function addSNConsoleLog(tabId, message, className = '') {
    const listElement = document.getElementById(`sn-${tabId}-list`);
    if (!listElement) return;
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    
    const line = document.createElement('div');
    line.className = `log-line ${className}`;
    line.textContent = `[${timeStr}] ${message}`;
    listElement.appendChild(line);
    
    // Auto-scroll to bottom
    const parentContainer = listElement.closest('.console-tab-view');
    if (parentContainer) {
        parentContainer.scrollTop = parentContainer.scrollHeight;
    }
}

function switchSNConsoleTab(tabName) {
    document.querySelectorAll('.sn-console-tab-btn').forEach(btn => {
        btn.classList.remove('sn-console-tabactive');
    });
    
    document.querySelectorAll('.console-tab-view').forEach(view => {
        view.classList.add('hidden');
    });
    
    // Set active tab button
    document.getElementById(`tab-btn-${tabName}`).classList.add('sn-console-tabactive');
    
    // Show view
    document.getElementById(`console-view-${tabName}`).classList.remove('hidden');
    
    currentSNConsoleTab = tabName;
}

function toggleSNAccordion(id) {
    const item = document.getElementById(id).closest('.accordion-item');
    const wasOpen = item.classList.contains('open');
    
    // Close all accordions first
    document.querySelectorAll('.accordion-item').forEach(i => {
        i.classList.remove('open');
    });
    
    if (!wasOpen) {
        item.classList.add('open');
    }
}

function renderSNPresets() {
    if (!snPresets) return;
    
    // Client Scripts
    const csContainer = document.getElementById('ac-client-scripts');
    csContainer.innerHTML = snPresets.client_scripts.map(s => `
        <div class="sn-preset-item">
            <div class="sn-preset-meta">
                <h5>${escapeHTML(s.name)}</h5>
                <span>${escapeHTML(s.type)}</span>
            </div>
            <p class="sn-preset-desc">${escapeHTML(s.description)}</p>
            <div class="sn-preset-actions">
                <input type="checkbox" id="chk-cs-${s.id}" ${snActiveClientScripts[s.id] ? 'checked' : ''} onchange="togglePresetActive('cs', '${s.id}')">
                <label for="chk-cs-${s.id}">Active</label>
                <button class="btn-code" onclick="viewPresetCode('client_scripts', '${s.id}')"><i class="fa-solid fa-code"></i> View Script</button>
            </div>
        </div>
    `).join('');
    
    // UI Policies
    const upContainer = document.getElementById('ac-ui-policies');
    upContainer.innerHTML = snPresets.ui_policies.map(p => `
        <div class="sn-preset-item">
            <div class="sn-preset-meta">
                <h5>${escapeHTML(p.name)}</h5>
                <span>UI Policy</span>
            </div>
            <p class="sn-preset-desc"><strong>Condition:</strong> ${escapeHTML(p.conditions)}<br>${escapeHTML(p.description)}</p>
            <div class="sn-preset-actions">
                <input type="checkbox" id="chk-up-${p.id}" ${snActiveUIPolicies[p.id] ? 'checked' : ''} onchange="togglePresetActive('up', '${p.id}')">
                <label for="chk-up-${p.id}">Active</label>
                <button class="btn-code" onclick="viewPresetCode('ui_policies', '${p.id}')"><i class="fa-solid fa-circle-info"></i> Details</button>
            </div>
        </div>
    `).join('');
    
    // Business Rules
    const brContainer = document.getElementById('ac-business-rules');
    brContainer.innerHTML = snPresets.business_rules.map(r => `
        <div class="sn-preset-item">
            <div class="sn-preset-meta">
                <h5>${escapeHTML(r.name)}</h5>
                <span>${escapeHTML(r.when)}</span>
            </div>
            <p class="sn-preset-desc">${escapeHTML(r.description)}</p>
            <div class="sn-preset-actions">
                <input type="checkbox" id="chk-br-${r.id}" ${snActiveBusinessRules[r.id] ? 'checked' : ''} onchange="togglePresetActive('br', '${r.id}')">
                <label for="chk-br-${r.id}">Active</label>
                <button class="btn-code" onclick="viewPresetCode('business_rules', '${r.id}')"><i class="fa-solid fa-code"></i> View Rule</button>
            </div>
        </div>
    `).join('');
}

function togglePresetActive(type, id) {
    const isChecked = document.getElementById(`chk-${type}-${id}`).checked;
    if (type === 'cs') {
        snActiveClientScripts[id] = isChecked;
        addSNConsoleLog('client-logs', `System: Client Script [${id}] set to ${isChecked ? 'Active' : 'Inactive'}.`, 'system-line');
        // Re-run onChange check
        onSNImpactUrgencyChange();
    } else if (type === 'up') {
        snActiveUIPolicies[id] = isChecked;
        addSNConsoleLog('client-logs', `System: UI Policy [${id}] set to ${isChecked ? 'Active' : 'Inactive'}.`, 'system-line');
        // Re-run UI policy check
        evaluateUIPolicies();
    } else if (type === 'br') {
        snActiveBusinessRules[id] = isChecked;
        addSNConsoleLog('server-logs', `System: Business Rule [${id}] set to ${isChecked ? 'Active' : 'Inactive'}.`, 'system-line');
    }
}

function viewPresetCode(presetType, id) {
    if (!snPresets) return;
    const items = snPresets[presetType];
    const item = items.find(x => x.id === id);
    if (!item) return;
    
    let content = '';
    if (presetType === 'ui_policies') {
        content = `UI Policy: ${item.name}\nDescription: ${item.description}\nCondition: ${item.conditions}\n\nActions:\n` + 
                  item.actions.map(a => ` - Field '${a.field}': ` + Object.keys(a).filter(k => k !== 'field').map(k => `${k}=${a[k]}`).join(', ')).join('\n');
    } else {
        content = item.code;
    }
    
    alert(`---------------- ServiceNow Code Viewer ----------------\n\nName: ${item.name}\n\n${content}`);
}

function populateSNFlows() {
    if (!snPresets) return;
    const select = document.getElementById('sn-flow-select');
    select.innerHTML = snPresets.flows.map(f => `<option value="${f.id}">${escapeHTML(f.name)}</option>`).join('');
    loadSNFlow();
}

function loadSNFlow() {
    if (!snPresets) return;
    const flowId = document.getElementById('sn-flow-select').value;
    const flow = snPresets.flows.find(f => f.id === flowId);
    if (!flow) return;
    
    snActiveFlow = flow;
    
    // Render workflow steps
    const canvas = document.getElementById('flow-visual-canvas');
    canvas.innerHTML = flow.steps.map(s => `
        <div class="flow-node-step pending" id="flow-node-${flowId}-${s.step}">
            <div class="flow-node-circle">${s.step}</div>
            <div class="flow-node-content">
                <span class="flow-node-name">${escapeHTML(s.name)}</span>
                <span class="flow-node-action">${escapeHTML(s.action)}</span>
            </div>
        </div>
    `).join('');
}

async function runSNFlow() {
    if (!snActiveFlow) return;
    const flowId = snActiveFlow.id;
    
    // Switch to REST tab if needed to display payload, or keep user informed
    addSNConsoleLog('server-logs', `Flow Engine: Initiating Flow pipeline [${snActiveFlow.name}]`, 'server-line');
    
    for (let i = 0; i < snActiveFlow.steps.length; i++) {
        const step = snActiveFlow.steps[i];
        const node = document.getElementById(`flow-node-${flowId}-${step.step}`);
        
        // Mark active
        if (node) {
            node.classList.remove('pending', 'completed');
            node.classList.add('active');
        }
        
        addSNConsoleLog('server-logs', `Flow Engine [Step ${step.step}]: Running action: ${step.name}...`, 'server-line');
        
        // Wait 1.0s to simulate execution lag
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Execute step-specific mock behaviors
        if (step.name === "API Synchronization") {
            await executeRESTSyncCall();
        } else if (step.name === "Auto-Route to On-Call Group") {
            const groupSelect = document.getElementById('sn-assignment-group');
            if (groupSelect) {
                groupSelect.value = "Network Administration";
                addSNConsoleLog('client-logs', 'g_form: Assignment Group set to Network Administration by Flow Action.', 'client-line');
            }
        }
        
        // Mark completed
        if (node) {
            node.classList.remove('active');
            node.classList.add('completed');
            const circle = node.querySelector('.flow-node-circle');
            if (circle) circle.innerHTML = '<i class="fa-solid fa-check"></i>';
        }
    }
    
    addSNConsoleLog('server-logs', `Flow Engine: Workflow [${snActiveFlow.name}] completed successfully.`, 'server-line');
    alert(`Flow Designer finished executing: "${snActiveFlow.name}"`);
}

// ServiceNow Client Script simulator
const g_form = {
    getValue: function(fieldId) {
        const el = document.getElementById(`sn-${fieldId}`);
        return el ? el.value : '';
    },
    setValue: function(fieldId, value) {
        const el = document.getElementById(`sn-${fieldId}`);
        if (!el) return;
        el.value = value;
        
        // Recalculate formatted field text if needed
        if (fieldId === 'priority') {
            const labels = {
                '1': '1 - Critical',
                '2': '2 - High',
                '3': '3 - Moderate',
                '4': '4 - Low'
            };
            el.value = labels[value] || value;
        }
    },
    setMandatory: function(fieldId, isMandatory) {
        const label = document.querySelector(`label[for="sn-${fieldId}"]`);
        if (!label) return;
        
        // Show/hide req asterisks
        let reqMark = label.querySelector('.sn-req-marker');
        if (isMandatory) {
            if (!reqMark) {
                const mark = document.createElement('span');
                mark.className = 'sn-req-marker';
                mark.textContent = '*';
                label.prepend(mark);
            }
        } else {
            if (reqMark) reqMark.remove();
        }
        
        // Flag input element attributes
        const input = document.getElementById(`sn-${fieldId}`);
        if (input) input.required = isMandatory;
    },
    setVisible: function(fieldId, isVisible) {
        const row = document.getElementById(`row-${fieldId}`);
        if (row) {
            if (isVisible) {
                row.classList.remove('hidden');
            } else {
                row.classList.add('hidden');
            }
        }
    },
    setReadOnly: function(fieldId, isReadOnly) {
        const input = document.getElementById(`sn-${fieldId}`);
        if (input) {
            input.readOnly = isReadOnly;
            if (isReadOnly) {
                input.classList.add('sn-input-readonly');
                if (input.tagName === 'SELECT') input.disabled = true;
            } else {
                input.classList.remove('sn-input-readonly');
                if (input.tagName === 'SELECT') input.disabled = false;
            }
        }
    },
    addInfoMessage: function(message) {
        addSNConsoleLog('client-logs', `g_form.addInfoMessage: ${message}`, 'client-line');
    },
    addErrorMessage: function(message) {
        addSNConsoleLog('client-logs', `g_form.addErrorMessage: ${message}`, 'error-line');
    },
    showFieldMsg: function(fieldId, msg, type = 'info') {
        addSNConsoleLog('client-logs', `g_form.showFieldMsg [${fieldId}] (${type}): ${msg}`, type === 'error' ? 'error-line' : 'client-line');
    }
};

function onSNCategoryChange() {
    const category = g_form.getValue('category');
    addSNConsoleLog('client-logs', `client-event: Category changed to: ${category}`, 'client-line');
}

function onSNStateChange() {
    const state = g_form.getValue('state');
    addSNConsoleLog('client-logs', `client-event: State changed to: ${state}`, 'client-line');
    
    // Evaluate UI policies when state changes
    evaluateUIPolicies();
}

function onSNImpactUrgencyChange() {
    const impact = g_form.getValue('impact');
    const urgency = g_form.getValue('urgency');
    
    addSNConsoleLog('client-logs', `client-event: Field Change (Impact: ${impact}, Urgency: ${urgency})`, 'client-line');
    
    // Run Client Script preset
    if (snActiveClientScripts['cs_priority_matrix']) {
        // Run priority matrix script directly via mock JavaScript translation
        let priority = '4';
        if (impact === '1' && urgency === '1') priority = '1';
        else if ((impact === '1' && urgency === '2') || (impact === '2' && urgency === '1')) priority = '2';
        else if ((impact === '2' && urgency === '2') || (impact === '1' && urgency === '3') || (impact === '3' && urgency === '1')) priority = '3';
        else priority = '4';
        
        g_form.setValue('priority', priority);
        g_form.addInfoMessage(`Client Script [Impact-Urgency Matrix]: Calculated Priority as P${priority} (Impact: ${impact}, Urgency: ${urgency})`);
    }
}

function evaluateUIPolicies() {
    const state = g_form.getValue('state');
    
    // 1. Show/Require Resolution fields when state = Resolved
    if (snActiveUIPolicies['up_resolved_fields']) {
        if (state === 'Resolved') {
            g_form.setVisible('resolution_code', true);
            g_form.setMandatory('resolution_code', true);
            g_form.addInfoMessage('UI Policy: Evaluated state = Resolved. Set Resolution Code visible and mandatory.');
        } else {
            g_form.setVisible('resolution_code', false);
            g_form.setMandatory('resolution_code', false);
        }
    }
    
    // 2. Lock fields on Closed ticket
    if (snActiveUIPolicies['up_closed_readonly']) {
        const isClosed = (state === 'Closed');
        const fields = ['category', 'impact', 'urgency', 'short_description', 'assignment_group', 'work_notes', 'resolution_code'];
        
        fields.forEach(f => {
            g_form.setReadOnly(f, isClosed);
        });
        
        if (isClosed) {
            g_form.addInfoMessage('UI Policy: Evaluated state = Closed. Locked all editable fields.');
        }
    }
}

function resetSNForm() {
    // Generate a new incident sys_id and record number
    const sysId = Array.from({length: 32}, () => Math.floor(Math.random()*16).toString(16)).join('');
    document.getElementById('sn-sys-id').value = sysId;
    
    const module = document.getElementById('sn-module-select').value;
    let numPrefix = 'INC';
    if (module === 'problem') numPrefix = 'PRB';
    if (module === 'change') numPrefix = 'CHG';
    
    const randomNum = Math.floor(100000 + Math.random() * 900000);
    const ticketNumber = `${numPrefix}${randomNum}`;
    
    document.getElementById('sn-number').value = ticketNumber;
    document.getElementById('sn-ticket-header-number').textContent = ticketNumber;
    
    // Reset other fields
    document.getElementById('sn-short-description').value = `Infrastructure latency identified in corporate cluster`;
    document.getElementById('sn-caller').value = 'john.doe@enterprise.local';
    document.getElementById('sn-category').value = 'Software';
    document.getElementById('sn-state').value = 'New';
    document.getElementById('sn-impact').value = '3';
    document.getElementById('sn-urgency').value = '3';
    document.getElementById('sn-priority').value = '4 - Low';
    document.getElementById('sn-assignment-group').value = 'IT Service Desk';
    document.getElementById('sn-work-notes').value = '';
    
    if (document.getElementById('sn-resolution-code')) {
        document.getElementById('sn-resolution-code').value = '';
    }
    
    // Run initial loaders
    g_form.setVisible('resolution_code', false);
    g_form.setMandatory('resolution_code', false);
    
    // Make sure fields are editable again (in case previously closed)
    const fields = ['category', 'impact', 'urgency', 'short_description', 'assignment_group', 'work_notes', 'resolution_code'];
    fields.forEach(f => {
        g_form.setReadOnly(f, false);
    });
    
    addSNConsoleLog('client-logs', `System: Form reset. Created blank record ${ticketNumber}.`, 'system-line');
    addSNConsoleLog('server-logs', `System: Database connection established. Sandbox table structure mapped.`, 'system-line');
}

function onSNModuleChange() {
    resetSNForm();
    loadSNFlow();
}

async function submitSNForm() {
    // 1. Run Client onSubmit Scripts
    if (snActiveClientScripts['cs_mandatory_fields']) {
        const state = g_form.getValue('state');
        if (state === 'Resolved') {
            const resCode = document.getElementById('sn-resolution-code').value;
            const workNotes = document.getElementById('sn-work-notes').value;
            
            if (!resCode) {
                g_form.showFieldMsg('resolution_code', 'Resolution code is required to close this ticket.', 'error');
                g_form.addErrorMessage('Submission aborted: Missing resolution details.');
                alert('Submission Aborted by Client Script: Resolution Code is required!');
                return;
            }
            if (!workNotes || workNotes.length < 10) {
                g_form.showFieldMsg('work_notes', 'Provide detailed work notes (min 10 chars).', 'error');
                g_form.addErrorMessage('Submission aborted: Work notes must describe the fix.');
                alert('Submission Aborted by Client Script: Detailed work notes must be provided!');
                return;
            }
        }
    }
    
    addSNConsoleLog('client-logs', 'g_form: Client side validations passed. Submitting to GlideRecord DB...', 'client-line');
    
    // 2. Simulate GlideRecord DB server-side insert / update
    addSNConsoleLog('server-logs', 'GlideSystem: Executing server-side Business Rules...', 'server-line');
    
    let currentRecord = {
        sys_id: document.getElementById('sn-sys-id').value,
        number: document.getElementById('sn-number').value,
        short_description: document.getElementById('sn-short-description').value,
        priority: g_form.getValue('priority').substring(0, 1),
        state: g_form.getValue('state'),
        category: g_form.getValue('category'),
        impact: g_form.getValue('impact'),
        urgency: g_form.getValue('urgency'),
        assignment_group: document.getElementById('sn-assignment-group').value,
        caller: document.getElementById('sn-caller').value,
        resolution_code: document.getElementById('sn-resolution-code') ? document.getElementById('sn-resolution-code').value : '',
        work_notes: document.getElementById('sn-work-notes').value
    };
    
    // Run Business Rule: Before Insert / Update
    if (snActiveBusinessRules['br_auto_assignment']) {
        const category = currentRecord.category;
        let newGroup = currentRecord.assignment_group;
        
        if (category === 'Network') {
            newGroup = 'Network Administration';
        } else if (category === 'Database') {
            newGroup = 'Database Operations';
        } else if (category === 'Hardware') {
            newGroup = 'Hardware Support Team';
        } else {
            newGroup = 'IT Service Desk';
        }
        
        currentRecord.assignment_group = newGroup;
        document.getElementById('sn-assignment-group').value = newGroup;
        
        addSNConsoleLog('server-logs', `Business Rule [Auto-Assign Tech Teams]: Set assignment_group to "${newGroup}" based on category: ${category}`, 'server-line');
    }
    
    // Simulate database record write
    addSNConsoleLog('server-logs', `GlideRecord DB: Successfully committed record ${currentRecord.number} into platform storage.`, 'server-line');
    
    // Run Business Rule: After Update / Insert
    if (snActiveBusinessRules['br_p1_escalation']) {
        if (currentRecord.priority === '1') {
            addSNConsoleLog('server-logs', `Business Rule [P1 Critical Escalation]: Alerting SLA system of critical tier breach! SLA target shrunk to 2.0h.`, 'error-line');
            
            // Auto run Flow Designer as well since it triggers on P1 creation!
            const selectFlow = document.getElementById('sn-flow-select');
            if (selectFlow) {
                selectFlow.value = 'flow_p1_critical';
                loadSNFlow();
                setTimeout(() => {
                    alert("Business Rule alert: Severity 1 Event! Auto-triggering critical SLA Flow Designer pipeline.");
                    runSNFlow();
                }, 800);
            }
        }
    }
    
    // Trigger mock outbound API sync if not already handled by SLA flow
    if (currentRecord.state === 'Resolved' || currentRecord.state === 'Closed') {
        await executeRESTSyncCall();
    } else {
        alert(`Record ${currentRecord.number} updated successfully in PDI database.`);
    }
}

async function executeRESTSyncCall() {
    addSNConsoleLog('rest-logs', 'REST Integration: Generating payload for outbound message dispatch...', 'rest-line');
    
    const payload = {
        sys_id: document.getElementById('sn-sys-id').value,
        number: document.getElementById('sn-number').value,
        short_description: document.getElementById('sn-short-description').value,
        priority: g_form.getValue('priority').substring(0, 1),
        state: g_form.getValue('state'),
        assignment_group: document.getElementById('sn-assignment-group').value,
        caller: document.getElementById('sn-caller').value,
        category: g_form.getValue('category'),
        impact: g_form.getValue('impact'),
        urgency: g_form.getValue('urgency'),
        resolution_code: document.getElementById('sn-resolution-code') ? document.getElementById('sn-resolution-code').value : '',
        work_notes: document.getElementById('sn-work-notes').value
    };
    
    // Print payload log
    addSNConsoleLog('rest-logs', `REST Outbound JSON payload:\n${JSON.stringify(payload, null, 2)}`, 'rest-line');
    
    try {
        const response = await apiFetch('/api/servicenow/sync', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        
        addSNConsoleLog('rest-logs', `REST Response Status: 200 OK`, 'server-line');
        addSNConsoleLog('rest-logs', `REST Sync Complete. External Ref ID: ${response.external_id} synced into ${response.external_system}`, 'server-line');
        addSNConsoleLog('rest-logs', `JSON Response Payload:\n${JSON.stringify(response, null, 2)}`, 'server-line');
        
    } catch (err) {
        addSNConsoleLog('rest-logs', `REST Sync failed: ${err.message}`, 'error-line');
    }
}

// Utility helper to escape HTML inside presets
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}
