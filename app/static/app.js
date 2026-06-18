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
