"use strict";

// UPDATE THIS with your actual Railway Backend URL after deploying on Railway
const API_BASE =
    (window.ENV && window.ENV.API_BASE_URL) ||
    (typeof process !== "undefined" && process.env && process.env.VITE_API_BASE_URL) ||
    "https://your-railway-backend-url.up.railway.app";

let currentUser = null;
let reports = [];
let selectedImage = null;
let selectedImagePreviewUrl = null;
let cameraStream = null;

let selectedAttachments = [];
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

let currentLocation = {
    latitude: null,
    longitude: null,
    address: ""
};

let selectedCategory = "surface";
let selectedBarrierType = "";
let aiAnalysisResult = null;
let analysisRunId = 0;

function $(id) {
    return document.getElementById(id);
}

function $$(selector) {
    return document.querySelectorAll(selector);
}

function normalizeUser(user) {
    if (!user || typeof user !== "object") {
        return null;
    }
    const name = typeof user.name === "string" ? user.name.trim() : "";
    const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
    const id = user.id !== undefined && user.id !== null ? user.id : null;

    if (!name && !email && id === null) {
        return null;
    }

    return {
        id: id,
        name: name || "User",
        email: email || "",
        created_at: user.created_at || null
    };
}

function setCurrentUser(user) {
    const normalized = normalizeUser(user);
    if (!normalized) {
        currentUser = null;
        localStorage.removeItem("barrierlens_session");
        updateUserUI();
        return;
    }
    currentUser = normalized;
    localStorage.setItem("barrierlens_session", JSON.stringify(currentUser));
    updateUserUI();
}

function loadCurrentUser() {
    try {
        const saved = JSON.parse(localStorage.getItem("barrierlens_session"));
        const normalized = normalizeUser(saved);
        if (!normalized) {
            localStorage.removeItem("barrierlens_session");
            currentUser = null;
            updateUserUI();
            return false;
        }
        currentUser = normalized;
        updateUserUI();
        return true;
    } catch (error) {
        localStorage.removeItem("barrierlens_session");
        currentUser = null;
        updateUserUI();
        return false;
    }
}

async function validateServerSession() {
    try {
        const response = await fetch(`${API_BASE}/api/session`, {
            method: "GET",
            credentials: "include"
        });
        if (!response.ok) {
            currentUser = null;
            localStorage.removeItem("barrierlens_session");
            updateUserUI();
            return false;
        }
        const data = await response.json();
        if (!data.success || !data.authenticated || !data.user) {
            currentUser = null;
            localStorage.removeItem("barrierlens_session");
            updateUserUI();
            return false;
        }
        currentUser = normalizeUser(data.user);
        localStorage.setItem("barrierlens_session", JSON.stringify(currentUser));
        updateUserUI();
        return true;
    } catch (error) {
        return false;
    }
}

function getInitial(name) {
    if (typeof name !== "string" || !name.trim()) {
        return "U";
    }
    return name.trim().charAt(0).toUpperCase();
}

function updateUserUI() {
    const safeUser = normalizeUser(currentUser);
    const name = safeUser ? safeUser.name : "Guest User";
    const email = safeUser ? safeUser.email || "Signed in" : "Sign in required";

    if ($("sidebarUserName")) $("sidebarUserName").textContent = name;
    if ($("sidebarUserEmail")) $("sidebarUserEmail").textContent = email;
    if ($("topUserName")) $("topUserName").textContent = safeUser ? name.split(" ")[0] : "Guest";
    if ($("sidebarAvatar")) $("sidebarAvatar").textContent = getInitial(name);
    if ($("topAvatar")) $("topAvatar").textContent = getInitial(name);
    if ($("settingsName")) $("settingsName").textContent = name;
    if ($("settingsEmail")) $("settingsEmail").textContent = email;
}

function showAuthMessage(element, message, type = "") {
    if (!element) return;
    element.textContent = message || "";
    element.className = `auth-message ${type}`;
}

function showLoginForm() {
    if ($("loginForm")) $("loginForm").classList.remove("hidden");
    if ($("registerForm")) $("registerForm").classList.add("hidden");
    if ($("loginTab")) $("loginTab").classList.add("active");
    if ($("registerTab")) $("registerTab").classList.remove("active");
    showAuthMessage($("loginMessage"), "");
    showAuthMessage($("registerMessage"), "");
}

function showRegisterForm() {
    if ($("registerForm")) $("registerForm").classList.remove("hidden");
    if ($("loginForm")) $("loginForm").classList.add("hidden");
    if ($("registerTab")) $("registerTab").classList.add("active");
    if ($("loginTab")) $("loginTab").classList.remove("active");
    showAuthMessage($("loginMessage"), "");
    showAuthMessage($("registerMessage"), "");
}

async function loginUser(email, password) {
    try {
        const response = await fetch(`${API_BASE}/api/login`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email.trim().toLowerCase(), password })
        });
        const data = await response.json();
        if (!response.ok) {
            return { success: false, message: data.error || "Invalid email or password." };
        }
        if (!data.user) {
            return { success: false, message: "Invalid response from server." };
        }
        setCurrentUser(data.user);
        return { success: true, source: "server" };
    } catch (error) {
        return { success: false, message: "Unable to connect to server." };
    }
}

async function registerUser(userData) {
    try {
        const response = await fetch(`${API_BASE}/api/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: userData.name.trim(),
                email: userData.email.trim().toLowerCase(),
                password: userData.password
            })
        });
        const data = await response.json();
        if (!response.ok) {
            return { success: false, message: data.error || "Registration failed." };
        }
        if (!data.user) {
            return { success: false, message: "Invalid response from server." };
        }
        return { success: true, source: "server", user: data.user };
    } catch (error) {
        return { success: false, message: "Unable to connect to server." };
    }
}

if ($("loginTab")) $("loginTab").addEventListener("click", showLoginForm);
if ($("registerTab")) $("registerTab").addEventListener("click", showRegisterForm);

if ($("loginForm")) {
    $("loginForm").addEventListener("submit", async event => {
        event.preventDefault();
        const email = $("loginEmail").value.trim().toLowerCase();
        const password = $("loginPassword").value;
        if (!email || !password) {
            showAuthMessage($("loginMessage"), "Enter email and password.", "error");
            return;
        }
        const result = await loginUser(email, password);
        if (!result.success) {
            showAuthMessage($("loginMessage"), result.message, "error");
            return;
        }
        $("authScreen").classList.add("hidden");
        $("app").classList.remove("hidden");
        showToast("Signed in successfully.");
        initializeApplication();
    });
}

if ($("registerForm")) {
    $("registerForm").addEventListener("submit", async event => {
        event.preventDefault();
        const name = $("registerName").value.trim();
        const email = $("registerEmail").value.trim().toLowerCase();
        const password = $("registerPassword").value;
        const confirm = $("registerConfirm").value;

        if (!name || !email || !password) {
            showAuthMessage($("registerMessage"), "Complete all fields.", "error");
            return;
        }
        if (password !== confirm) {
            showAuthMessage($("registerMessage"), "Passwords do not match.", "error");
            return;
        }
        if (password.length < 6) {
            showAuthMessage($("registerMessage"), "Password must contain at least 6 characters.", "error");
            return;
        }
        const result = await registerUser({ name, email, password });
        if (!result.success) {
            showAuthMessage($("registerMessage"), result.message, "error");
            return;
        }
        showAuthMessage($("registerMessage"), "Account created. Please sign in.", "success");
        $("registerForm").reset();
        setTimeout(showLoginForm, 600);
    });
}

async function logoutUser() {
    try {
        await fetch(`${API_BASE}/api/logout`, {
            method: "POST",
            credentials: "include"
        });
    } catch (error) {}

    stopCamera();
    currentUser = null;
    localStorage.removeItem("barrierlens_session");
    updateUserUI();
    $("app").classList.add("hidden");
    $("authScreen").classList.remove("hidden");
    showLoginForm();
    showToast("Signed out.");
}

if ($("logoutButton")) $("logoutButton").addEventListener("click", logoutUser);
if ($("settingsLogoutButton")) $("settingsLogoutButton").addEventListener("click", logoutUser);

const PAGE_INFO = {
    dashboard: { title: "Dashboard", subtitle: "Overview of accessibility barriers" },
    detect: { title: "Detection & Report", subtitle: "Identify and report a real-world barrier" },
    map: { title: "Accessibility Map", subtitle: "View reported barriers around you" },
    reports: { title: "Reports", subtitle: "Review and manage your reports" },
    history: { title: "History", subtitle: "Your previous detection activity" },
    settings: { title: "Settings", subtitle: "Manage your BarrierLens account" }
};

let leafletMap = null;

function showPage(pageName) {
    const target = $(`${pageName}Page`);
    if (!target) return;

    $$(".page").forEach(page => page.classList.remove("active"));
    target.classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });

    $$(".nav-item").forEach(item => {
        item.classList.toggle("active", item.dataset.page === pageName);
    });

    const info = PAGE_INFO[pageName];
    if (info) {
        if ($("pageTitle")) $("pageTitle").textContent = info.title;
        if ($("pageSubtitle")) $("pageSubtitle").textContent = info.subtitle;
    }

    if ($("sidebar")) $("sidebar").classList.remove("open");

    if (pageName === "map") {
        setTimeout(initializeMap, 200);
    }
}

$$(".nav-item").forEach(button => {
    button.addEventListener("click", () => showPage(button.dataset.page));
});

$$("[data-page-target]").forEach(button => {
    button.addEventListener("click", () => showPage(button.dataset.pageTarget));
});

if ($("mobileMenuButton")) {
    $("mobileMenuButton").addEventListener("click", () => {
        if ($("sidebar")) $("sidebar").classList.toggle("open");
    });
}

if ($("startDetectionButton")) {
    $("startDetectionButton").addEventListener("click", () => showPage("detect"));
}

if ($("newReportButton")) {
    $("newReportButton").addEventListener("click", () => {
        showPage("detect");
        try { resetReportForm(); } catch (e) {}
    });
}

const BARRIER_TYPES = {
    surface: ["Cracked / Broken Sidewalk", "Pothole", "Uneven Pavement", "Missing Curb Ramp", "Damaged Tactile Paving", "Slippery Surface"],
    obstruction: ["Blocked Path", "Illegal Parking", "Construction Debris", "Street Furniture Obstruction", "Overgrown Vegetation", "Narrow Passage"],
    transport: ["Blocked Bus Stop", "Inaccessible Bus", "Missing Accessible Parking", "Railway Access Barrier", "No Wheelchair Boarding", "Broken Elevator"],
    visual: ["Missing Tactile Guidance", "Missing Braille Sign", "Poor Signage", "Low Contrast Sign", "Unmarked Hazard", "Missing Audio Navigation"],
    auditory: ["No Audio Signal", "Broken Audio Announcement", "Excessive Background Noise", "Missing Visual Alert", "No Hearing Assistance"],
    cognitive: ["Confusing Signage", "Complex Wayfinding", "Missing Directions", "Unclear Instructions", "Information Overload"]
};

$$(".category-button").forEach(button => {
    button.addEventListener("click", () => {
        selectedCategory = button.dataset.category;
        $$(".category-button").forEach(item => {
            item.classList.toggle("active", item === button);
        });
        selectedBarrierType = "";
        renderBarrierTypes();
    });
});

function renderBarrierTypes() {
    const container = $("barrierTypeGrid");
    if (!container) return;
    container.innerHTML = "";
    const types = BARRIER_TYPES[selectedCategory] || [];

    types.forEach((type, index) => {
        const id = `barrier-${selectedCategory}-${index}`;
        const wrapper = document.createElement("div");
        wrapper.className = "barrier-radio";
        wrapper.innerHTML = `
            <input id="${id}" type="radio" name="barrierType" value="${escapeHTML(type)}">
            <label for="${id}">${escapeHTML(type)}</label>
        `;
        container.appendChild(wrapper);
    });

    $$('input[name="barrierType"]').forEach(radio => {
        radio.addEventListener("change", () => {
            selectedBarrierType = radio.value;
        });
    });
}

function escapeHTML(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

if ($("description")) {
    $("description").addEventListener("input", () => {
        if ($("characterCount")) {
            $("characterCount").textContent = $("description").value.length;
        }
    });
}

let toastTimer = null;
function showToast(message) {
    const toast = $("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 2800);
}

if ($("startCameraButton")) $("startCameraButton").addEventListener("click", startCamera);
if ($("captureButton")) $("captureButton").addEventListener("click", captureCameraImage);
if ($("selectImageButton")) $("selectImageButton").addEventListener("click", () => { if ($("imageInput")) $("imageInput").click(); });

if ($("imageInput")) {
    $("imageInput").addEventListener("change", event => {
        const file = event.target.files?.[0];
        if (!file) return;
        handleImageFile(file);
    });
}

async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast("Camera not available.");
        return;
    }
    const video = $("cameraPreview");
    const captureButton = $("captureButton");
    const placeholder = $("cameraPlaceholder");
    if (!video) return;

    try {
        captureButton.disabled = true;
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false
        });

        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
        }
        cameraStream = newStream;
        video.srcObject = cameraStream;
        video.muted = true;
        video.setAttribute("playsinline", "");
        video.setAttribute("autoplay", "");
        await video.play();

        if (placeholder) placeholder.classList.add("hidden");
        captureButton.disabled = false;
        showToast("Camera started.");
    } catch (error) {
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
        }
        video.srcObject = null;
        if (captureButton) captureButton.disabled = true;
        if (placeholder) placeholder.classList.remove("hidden");
        showToast("Camera could not be started.");
    }
}

function stopCamera() {
    if (!cameraStream) return;
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
    if ($("cameraPreview")) $("cameraPreview").srcObject = null;
    if ($("captureButton")) $("captureButton").disabled = true;
}

function captureCameraImage() {
    const video = $("cameraPreview");
    const canvas = $("captureCanvas");
    if (!video.videoWidth || !video.videoHeight) {
        showToast("Camera image not ready.");
        return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(blob => {
        if (!blob) return;
        const file = new File([blob], `barrier-${Date.now()}.jpg`, { type: "image/jpeg" });
        handleImageFile(file);
    }, "image/jpeg", 0.92);
}

async function handleImageFile(file) {
    if (!file || !file.type.startsWith("image/")) {
        showToast("Please select an image file.");
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        showToast("Image must be smaller than 10 MB.");
        return;
    }

    const imageURL = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
        URL.revokeObjectURL(imageURL);
        selectedImage = file;

        if (selectedImagePreviewUrl) {
            URL.revokeObjectURL(selectedImagePreviewUrl);
        }
        selectedImagePreviewUrl = URL.createObjectURL(file);

        if ($("imagePreview")) {
            $("imagePreview").innerHTML = `<img src="${selectedImagePreviewUrl}" alt="Selected">`;
        }

        if ($("runAnalysisButton")) $("runAnalysisButton").disabled = false;
        if ($("runOcrButton")) $("runOcrButton").disabled = false;
        if ($("aiStatus")) $("aiStatus").textContent = "Ready";

        showToast("Image ready for analysis.");
        updateWorkflowStep(2);
    };
    image.onerror = () => {
        URL.revokeObjectURL(imageURL);
        showToast("Invalid image file.");
    };
    image.src = imageURL;
}

if ($("runAnalysisButton")) {
    $("runAnalysisButton").addEventListener("click", runAIAnalysis);
}

async function runAIAnalysis() {
    if (!selectedImage) {
        showToast("Select an image first.");
        return;
    }
    const thisAnalysisId = ++analysisRunId;
    if ($("aiStatus")) $("aiStatus").textContent = "Analyzing";
    if ($("runAnalysisButton")) $("runAnalysisButton").disabled = true;

    if ($("aiAnalysis")) {
        $("aiAnalysis").innerHTML = `<div class="ai-empty"><h4>Analyzing image...</h4><p>Examining image.</p></div>`;
    }

    try {
        const formData = new FormData();
        formData.append("image", selectedImage);

        const response = await fetch(`${API_BASE}/api/analyze`, {
            method: "POST",
            body: formData
        });
        const data = await response.json();

        if (thisAnalysisId !== analysisRunId) return;

        if (!response.ok || !data.success || !data.analysis) {
            throw new Error(data.error || "AI analysis failed.");
        }

        aiAnalysisResult = data.analysis;
        materializeAIAnalysis(aiAnalysisResult);

        if ($("aiStatus")) $("aiStatus").textContent = "Complete";
        if ($("runAnalysisButton")) $("runAnalysisButton").disabled = false;
        updateWorkflowStep(3);
        showToast("AI analysis completed.");
    } catch (error) {
        if (thisAnalysisId !== analysisRunId) return;
        if ($("aiStatus")) $("aiStatus").textContent = "Failed";
        if ($("runAnalysisButton")) $("runAnalysisButton").disabled = false;
        if ($("aiAnalysis")) {
            $("aiAnalysis").innerHTML = `<div class="ai-empty"><h4>Analysis failed</h4><p>${escapeHTML(error.message)}</p></div>`;
        }
        showToast("AI analysis failed.");
    }
}

function materializeAIAnalysis(result) {
    const confidence = Math.round(Number(result.confidence || 0) * 100);
    if ($("aiAnalysis")) {
        $("aiAnalysis").innerHTML = `
            <div class="ai-result">
                <div class="ai-result-title">
                    <strong>${escapeHTML(result.barrier_type)}</strong>
                    <span class="status-badge">${confidence}% confidence</span>
                </div>
                <div class="ai-result-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px;">
                    <div><small>Category</small><br><strong>${escapeHTML(result.category)}</strong></div>
                    <div><small>Severity</small><br><strong>${escapeHTML(result.severity)}</strong></div>
                </div>
                <p style="margin-top:10px; font-size:11px; color:var(--muted);">${escapeHTML(result.description)}</p>
            </div>
        `;
    }

    selectedCategory = result.category || "surface";
    selectedBarrierType = result.barrier_type || "";

    $$(".category-button").forEach(button => {
        button.classList.toggle("active", button.dataset.category === selectedCategory);
    });

    renderBarrierTypes();

    $$('input[name="barrierType"]').forEach(radio => {
        if (radio.value === selectedBarrierType) radio.checked = true;
    });

    $$('input[name="severity"]').forEach(radio => {
        radio.checked = radio.value === (result.severity || "medium");
    });

    if ($("description")) {
        $("description").value = result.description || "";
        if ($("characterCount")) $("characterCount").textContent = ($("description").value || "").length;
    }
}

function updateWorkflowStep(stepNumber) {
    $$(".workflow-step").forEach(step => {
        const number = Number(step.dataset.step);
        step.classList.toggle("active", number <= stepNumber);
    });
}

if ($("detectLocationButton")) {
    $("detectLocationButton").addEventListener("click", detectLocation);
}

function detectLocation() {
    if (!navigator.geolocation) {
        showToast("Location not supported.");
        return;
    }
    if ($("locationText")) $("locationText").textContent = "Detecting location...";

    navigator.geolocation.getCurrentPosition(async position => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&zoom=18&addressdetails=1`);
            const data = await response.json();
            const address = data.address || {};
            const locationParts = [address.road, address.city || address.town, address.country].filter(Boolean);
            const readableLocation = locationParts.join(", ") || data.display_name || "Location detected";

            currentLocation = { latitude, longitude, address: readableLocation };
            if ($("locationText")) $("locationText").textContent = readableLocation;
            showToast("Location detected.");
        } catch (e) {
            currentLocation = { latitude, longitude, address: "Location detected" };
            if ($("locationText")) $("locationText").textContent = "Location detected";
            showToast("GPS detected.");
        }
    }, () => {
        if ($("locationText")) $("locationText").textContent = "Location unavailable";
        showToast("Location permission required.");
    }, { timeout: 10000 });
}

if ($("resetReportButton")) {
    $("resetReportButton").addEventListener("click", resetReportForm);
}

function resetReportForm() {
    selectedImage = null;
    selectedAttachments = [];
    selectedBarrierType = "";
    selectedCategory = "surface";
    aiAnalysisResult = null;
    analysisRunId++;
    currentLocation = { latitude: null, longitude: null, address: "" };
    stopCamera();

    if ($("imageInput")) $("imageInput").value = "";
    if ($("imagePreview")) $("imagePreview").innerHTML = "<span>No image selected</span>";
    if ($("aiStatus")) $("aiStatus").textContent = "Waiting";
    if ($("runAnalysisButton")) $("runAnalysisButton").disabled = true;
    if ($("runOcrButton")) $("runOcrButton").disabled = true;
    if ($("ocrResult")) $("ocrResult").value = "";
    if ($("locationText")) $("locationText").textContent = "Location not detected";
    if ($("coordinatesText")) $("coordinatesText").textContent = "GPS coordinates unavailable";
    if ($("description")) $("description").value = "";
    if ($("characterCount")) $("characterCount").textContent = "0";

    $$('input[name="severity"]').forEach(r => r.checked = r.value === "medium");
    $$(".category-button").forEach(b => b.classList.toggle("active", b.dataset.category === "surface"));
    renderBarrierTypes();
    updateWorkflowStep(1);
}

const attachmentInput = $("attachmentInput");
if (attachmentInput) {
    attachmentInput.addEventListener("change", e => {
        const files = Array.from(e.target.files || []);
        files.forEach(file => {
            if (selectedAttachments.length < MAX_ATTACHMENTS && file.size <= MAX_ATTACHMENT_SIZE) {
                selectedAttachments.push(file);
            }
        });
        renderAttachments();
        e.target.value = "";
    });
}

function renderAttachments() {
    const container = $("attachmentList");
    const count = $("attachmentCount");
    if (!container) return;
    if (count) count.textContent = `${selectedAttachments.length} files`;
    container.innerHTML = selectedAttachments.map((f, i) => `
        <div class="attachment-item">
            <span>${escapeHTML(f.name)}</span>
            <button type="button" class="remove-attachment" onclick="removeAttachment(${i})">&times;</button>
        </div>
    `).join("");
}

window.removeAttachment = function(index) {
    selectedAttachments.splice(index, 1);
    renderAttachments();
};

// --- OCR Integration (Tesseract.js) ---
if ($("runOcrButton")) {
    $("runOcrButton").addEventListener("click", async () => {
        if (!selectedImage) {
            showToast("Select an image first.");
            return;
        }
        $("runOcrButton").disabled = true;
        if ($("ocrResult")) $("ocrResult").value = "Extracting text with OCR...";
        showToast("Running OCR...");

        try {
            const worker = await Tesseract.createWorker('eng');
            const ret = await worker.recognize(selectedImage);
            await worker.terminate();

            const text = (ret.data.text || "").trim();
            if ($("ocrResult")) $("ocrResult").value = text || "No text found in image.";
            if (text && $("description") && !$("description").value) {
                $("description").value = text;
                if ($("characterCount")) $("characterCount").textContent = text.length;
            }
            showToast("OCR completed successfully.");
        } catch (error) {
            if ($("ocrResult")) $("ocrResult").value = "OCR Error: " + error.message;
            showToast("OCR processing failed.");
        } finally {
            $("runOcrButton").disabled = false;
        }
    });
}

if ($("submitReportButton")) {
    $("submitReportButton").addEventListener("click", submitReport);
}

async function submitReport() {
    if (!selectedImage) {
        showToast("Capture or select an image first.");
        return;
    }
    if (!selectedBarrierType) {
        showToast("Select a barrier type.");
        return;
    }
    const severityRadio = document.querySelector('input[name="severity"]:checked');
    if (!severityRadio) {
        showToast("Select severity.");
        return;
    }
    const description = $("description").value.trim();
    if (!description) {
        showToast("Enter a description.");
        return;
    }

    const report = {
        id: "BL-" + Date.now(),
        user_id: currentUser ? currentUser.id : null,
        user_name: currentUser ? currentUser.name : "Guest User",
        user_email: currentUser ? currentUser.email : "",
        category: selectedCategory,
        barrier_type: selectedBarrierType,
        severity: severityRadio.value,
        description: description,
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        location: currentLocation.address || "",
        image_name: selectedImage ? selectedImage.name : "",
        image_type: selectedImage ? selectedImage.type : "",
        image_size: selectedImage ? selectedImage.size : 0,
        attachments: selectedAttachments.map(f => ({ name: f.name, type: f.type, size: f.size })),
        ai_analysis: aiAnalysisResult || null,
        created_at: new Date().toISOString(),
        status: "submitted"
    };

    let savedReports = [];
    try {
        savedReports = JSON.parse(localStorage.getItem("barrierlens_reports")) || [];
    } catch (e) {
        savedReports = [];
    }
    savedReports.unshift(report);
    localStorage.setItem("barrierlens_reports", JSON.stringify(savedReports));

    try {
        await fetch(`${API_BASE}/api/reports`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(report)
        });
    } catch (e) {}

    reports = savedReports;
    renderReports();
    renderHistory();
    showToast("Report submitted successfully.");

    setTimeout(() => {
        const reportsButton = document.querySelector('[data-page="reports"]');
        if (reportsButton) reportsButton.click();
    }, 500);
}

async function loadReports() {
    if (!currentUser || !currentUser.id) {
        reports = [];
        renderReports();
        renderHistory();
        updateDashboard();
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/api/reports`, { credentials: "include" });
        const data = await response.json();
        if (response.ok && data.success && Array.isArray(data.reports)) {
            reports = data.reports;
            localStorage.setItem("barrierlens_reports", JSON.stringify(reports));
        } else {
            throw new Error();
        }
    } catch (e) {
        try {
            const saved = localStorage.getItem("barrierlens_reports");
            reports = saved ? JSON.parse(saved) : [];
        } catch (err) {
            reports = [];
        }
    }
    renderReports();
    renderHistory();
    updateDashboard();
}

function renderReports() {
    const container = $("reportsList");
    if (!container) return;
    if (!reports.length) {
        container.innerHTML = `<div class="empty-state">No reports available.</div>`;
        return;
    }
    container.innerHTML = reports.map(report => `
        <div class="report-card">
            <h3>${escapeHTML(report.barrier_type || "Barrier")}</h3>
            <p>${escapeHTML(report.description)}</p>
            <div class="report-meta">
                <span>${escapeHTML(report.category)}</span>
                <span>${escapeHTML(report.severity)}</span>
            </div>
            <button type="button" class="outline-button delete-report-button" onclick="deleteLocalReport('${escapeHTML(report.id)}')">Delete</button>
        </div>
    `).join("");
}

window.deleteLocalReport = async function(reportId) {
    try {
        await fetch(`${API_BASE}/api/reports/${encodeURIComponent(reportId)}`, {
            method: "DELETE",
            credentials: "include"
        });
    } catch (e) {}
    reports = reports.filter(r => String(r.id) !== String(reportId));
    localStorage.setItem("barrierlens_reports", JSON.stringify(reports));
    renderReports();
    renderHistory();
    updateDashboard();
    showToast("Report deleted.");
};

// --- History & Filtering ---
function renderHistory() {
    const container = $("historyList");
    if (!container) return;

    const query = ($("historySearch")?.value || "").toLowerCase();
    const category = $("historyCategoryFilter")?.value || "all";
    const severity = $("historySeverityFilter")?.value || "all";

    const filtered = reports.filter(report => {
        const matchQuery = !query || 
            String(report.barrier_type || "").toLowerCase().includes(query) ||
            String(report.description || "").toLowerCase().includes(query) ||
            String(report.location || "").toLowerCase().includes(query);
        const matchCategory = category === "all" || String(report.category || "").toLowerCase() === category.toLowerCase();
        const matchSeverity = severity === "all" || String(report.severity || "").toLowerCase() === severity.toLowerCase();
        return matchQuery && matchCategory && matchSeverity;
    });

    if (!filtered.length) {
        container.innerHTML = `<div class="empty-state">No history records match your filters.</div>`;
        return;
    }

    container.innerHTML = filtered.map(report => `
        <article class="history-item">
            <div class="history-main">
                <div class="history-title-row">
                    <strong class="history-title">${escapeHTML(report.barrier_type)}</strong>
                    <span class="history-category">${escapeHTML(report.category)}</span>
                </div>
                <div class="history-meta">
                    <span>📅 ${new Date(report.created_at).toLocaleDateString()}</span>
                    <span>📍 ${escapeHTML(report.location || "Location unrecorded")}</span>
                </div>
                <div class="history-description">${escapeHTML(report.description)}</div>
            </div>
            <div class="history-side">
                <span class="history-severity history-severity--${escapeHTML(report.severity)}">${escapeHTML(report.severity)}</span>
                <span class="history-status">
                    <span class="history-status-dot"></span> ${escapeHTML(report.status || "submitted")}
                </span>
            </div>
        </article>
    `).join("");
}

if ($("historySearch")) $("historySearch").addEventListener("input", renderHistory);
if ($("historyCategoryFilter")) $("historyCategoryFilter").addEventListener("change", renderHistory);
if ($("historySeverityFilter")) $("historySeverityFilter").addEventListener("change", renderHistory);

const originalShowPage = showPage;
showPage = function(pageName) {
    originalShowPage(pageName);
    if (pageName === "reports" || pageName === "history") {
        loadReports();
    }
};

function initializeMap() {
    const element = $("largeMap");
    if (!element || typeof L === "undefined") return;
    if (leafletMap) {
        setTimeout(() => leafletMap.invalidateSize(true), 100);
        return;
    }
    leafletMap = L.map(element).setView([13.0827, 80.2707], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(leafletMap);
    renderMapMarkers();
}

function renderMapMarkers() {
    if (!leafletMap) return;
    
    // Clear existing markers if any
    leafletMap.eachLayer(layer => {
        if (layer instanceof L.Marker) {
            leafletMap.removeLayer(layer);
        }
    });

    const query = ($("mapSearch")?.value || "").toLowerCase();
    const category = $("mapFilter")?.value || "all";
    const severity = $("mapSeverityFilter")?.value || "all";

    reports.forEach(report => {
        const lat = Number(report.latitude);
        const lon = Number(report.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

        const matchQuery = !query || String(report.barrier_type || "").toLowerCase().includes(query) || String(report.location || "").toLowerCase().includes(query);
        const matchCategory = category === "all" || String(report.category || "").toLowerCase() === category.toLowerCase();
        const matchSeverity = severity === "all" || String(report.severity || "").toLowerCase() === severity.toLowerCase();

        if (matchQuery && matchCategory && matchSeverity) {
            L.marker([lat, lon]).addTo(leafletMap).bindPopup(`<strong>${escapeHTML(report.barrier_type)}</strong><br>${escapeHTML(report.description)}`);
        }
    });
}

if ($("mapSearch")) $("mapSearch").addEventListener("input", renderMapMarkers);
if ($("mapFilter")) $("mapFilter").addEventListener("change", renderMapMarkers);
if ($("mapSeverityFilter")) $("mapSeverityFilter").addEventListener("change", renderMapMarkers);

function updateDashboard() {
    if ($("totalReports")) $("totalReports").textContent = reports.length;
    if ($("highSeverityCount")) {
        $("highSeverityCount").textContent = reports.filter(r => ["high", "critical"].includes(String(r.severity).toLowerCase())).length;
    }
    if ($("resolvedCount")) {
        $("resolvedCount").textContent = reports.filter(r => String(r.status).toLowerCase() === "resolved").length;
    }
}

// --- Dark Mode Persistence ---
const darkModeToggle = $("darkModeToggle");
if (darkModeToggle) {
    const savedDarkMode = localStorage.getItem("barrierlens_dark_mode") === "true";
    darkModeToggle.checked = savedDarkMode;
    if (savedDarkMode) {
        document.body.classList.add("night-mode");
    }
    darkModeToggle.addEventListener("change", e => {
        const isDark = e.target.checked;
        document.body.classList.toggle("night-mode", isDark);
        localStorage.setItem("barrierlens_dark_mode", isDark);
        showToast(isDark ? "Dark mode enabled." : "Light mode enabled.");
    });
}

document.addEventListener("DOMContentLoaded", () => {
    const loggedIn = loadCurrentUser();
    if (loggedIn) {
        if ($("authScreen")) $("authScreen").classList.add("hidden");
        if ($("app")) $("app").classList.remove("hidden");
        initializeApplication();
    } else {
        if ($("authScreen")) $("authScreen").classList.remove("hidden");
        if ($("app")) $("app").classList.add("hidden");
        showLoginForm();
    }
});

async function initializeApplication() {
    renderBarrierTypes();
    await loadReports();
    updateDashboard();
    showPage("dashboard");
}
