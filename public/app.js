// --- DOM Elements ---
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const fileNameSpan = document.getElementById('fileName');
const uploadBtn = document.getElementById('uploadBtn');
const refreshBtn = document.getElementById('refreshBtn');

const statsSection = document.getElementById('statsSection');
const statProcessed = document.getElementById('statProcessed');
const statSuccess = document.getElementById('statSuccess');
const statBranches = document.getElementById('statBranches');
const errorPanel = document.getElementById('errorPanel');
const errorList = document.getElementById('errorList');

const feedbackTableBody = document.querySelector('#feedbackTable tbody');
const toast = document.getElementById('toast');
const toastMsg = document.getElementById('toastMsg');

// SPA Elements
const btnNavImport = document.getElementById('btnNavImport');
const btnNavInsights = document.getElementById('btnNavInsights');
const panelImport = document.getElementById('panelImport');
const panelInsights = document.getElementById('panelInsights');
const storeFilter = document.getElementById('storeFilter');
const areaFilter = document.getElementById('areaFilter');
const trendMode = document.getElementById('trendMode');
const compareFilterLabel = document.getElementById('compareFilterLabel');

// Date Filter Elements
const datePreset = document.getElementById('datePreset');
const customDateContainer = document.getElementById('customDateContainer');
const startDateInput = document.getElementById('startDate');
const endDateInput = document.getElementById('endDate');
const btnApplyCustomDate = document.getElementById('btnApplyCustomDate');

let selectedFile = null;

// Chart JS Instances
let chartTopNpsInstance = null;
let chartBottomNpsInstance = null;
let chartCityNpsInstance = null;
let chartTrendsInstance = null;

let npsTrendsData = []; // Cached data for filtering MoM trends (unfiltered)
let cityTrendsData = []; // Cached data for filtering MoM city trends (unfiltered)
let overallNpsData = []; // Cached data for filtering top/bottom leaderboards
let overallCityData = []; // Cached data for city NPS scores

let currentStartDate = null;
let currentEndDate = null;

// --- Initialize App ---
document.addEventListener('DOMContentLoaded', () => {
    fetchRecentFeedbacks();
    setupNavigation();
    setupFilters();
});

// --- Toast Helper ---
function showToast(message, type = 'info') {
    toastMsg.textContent = message;
    
    // Reset classes
    toast.className = 'toast show';
    const icon = toast.querySelector('.toast-icon');
    
    if (type === 'success') {
        toast.classList.add('success');
        icon.className = 'toast-icon fa-solid fa-circle-check';
        icon.style.color = 'var(--success)';
    } else if (type === 'danger') {
        toast.classList.add('danger');
        icon.className = 'toast-icon fa-solid fa-circle-xmark';
        icon.style.color = 'var(--danger)';
    } else {
        icon.className = 'toast-icon fa-solid fa-circle-info';
        icon.style.color = 'var(--accent)';
    }
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 4000);
}

// --- SPA Navigation Switcher ---
function setupNavigation() {
    btnNavImport.addEventListener('click', (e) => {
        e.preventDefault();
        btnNavImport.classList.add('active');
        btnNavInsights.classList.remove('active');
        panelImport.style.display = 'block';
        panelInsights.style.display = 'none';
    });

    btnNavInsights.addEventListener('click', (e) => {
        e.preventDefault();
        btnNavInsights.classList.add('active');
        btnNavImport.classList.remove('active');
        panelImport.style.display = 'none';
        panelInsights.style.display = 'block';
        loadInsightsData();
    });
}

// --- Drag & Drop Event Listeners ---
dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    
    if (e.dataTransfer.files.length > 0) {
        handleFileSelect(e.dataTransfer.files[0]);
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFileSelect(e.target.files[0]);
    }
});

function handleFileSelect(file) {
    if (!file.name.endsWith('.csv')) {
        showToast('Please select a valid CSV file.', 'danger');
        return;
    }
    
    selectedFile = file;
    fileNameSpan.textContent = file.name;
    fileInfo.style.display = 'flex';
    uploadBtn.disabled = false;
    
    // Update dropzone UI state
    dropzone.querySelector('.cloud-icon').style.color = 'var(--success)';
    dropzone.querySelector('h3').textContent = 'File Loaded';
    dropzone.querySelector('p').textContent = 'Ready to ingest';
}

// --- Upload Logic ---
uploadBtn.addEventListener('click', async () => {
    if (!selectedFile) return;
    
    const formData = new FormData();
    formData.append('csvFile', selectedFile);
    
    uploadBtn.disabled = true;
    uploadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Ingesting...';
    
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('Ingestion completed successfully!', 'success');
            renderStats(data.stats, data.errors);
            fetchRecentFeedbacks();
            resetUploadZone();
        } else {
            showToast(data.message || 'Ingestion failed.', 'danger');
            resetUploadZone();
        }
    } catch (error) {
        console.error('Upload error:', error);
        showToast('A network error occurred. Please try again.', 'danger');
        resetUploadZone();
    }
});

function resetUploadZone() {
    selectedFile = null;
    fileInput.value = '';
    fileInfo.style.display = 'none';
    uploadBtn.disabled = true;
    uploadBtn.innerHTML = '<i class="fa-solid fa-rocket"></i> Import to Database';
    
    dropzone.querySelector('.cloud-icon').style.color = 'var(--accent)';
    dropzone.querySelector('h3').textContent = 'Drag & Drop CSV File';
    dropzone.querySelector('p').textContent = 'or click to browse your files';
}

function renderStats(stats, errors) {
    statsSection.style.display = 'block';
    statProcessed.textContent = stats.totalRows;
    statSuccess.textContent = stats.successCount;
    statBranches.textContent = stats.newBranches;
    
    if (errors && errors.length > 0) {
        errorPanel.style.display = 'block';
        errorList.innerHTML = errors.map(err => `<li>${err}</li>`).join('');
    } else {
        errorPanel.style.display = 'none';
    }
}

// --- Fetch Recent Feedbacks ---
refreshBtn.addEventListener('click', () => {
    fetchRecentFeedbacks();
    showToast('Data view refreshed.');
});

async function fetchRecentFeedbacks() {
    try {
        const response = await fetch('/api/feedbacks');
        const data = await response.json();
        
        if (data.success) {
            renderTable(data.data);
        } else {
            console.error('Failed to fetch data:', data.message);
        }
    } catch (err) {
        console.error('Error fetching preview data:', err);
    }
}

function renderTable(records) {
    if (!records || records.length === 0) {
        feedbackTableBody.innerHTML = `
            <tr class="empty-state">
                <td colspan="8">No records loaded yet. Upload a CSV to populate.</td>
            </tr>
        `;
        return;
    }
    
    feedbackTableBody.innerHTML = records.map(row => {
        const dateStr = row.business_date ? new Date(row.business_date).toLocaleDateString() : 'N/A';
        return `
            <tr>
                <td><strong>${escapeHTML(row.bill_no)}</strong></td>
                <td>${escapeHTML(dateStr)}</td>
                <td>${escapeHTML(row.branch || 'N/A')} <br><small style="color: var(--text-muted)">${escapeHTML(row.area || '')}</small></td>
                <td>${escapeHTML(row.user_name)} <br><small style="color: var(--text-muted)">${escapeHTML(row.mobile)}</small></td>
                <td>${getRatingPill(row.ambience)}</td>
                <td>${getRatingPill(row.cleanliness)}</td>
                <td>${getRatingPill(row.staff)}</td>
                <td><span style="font-weight: 500; color: ${row.recommend && row.recommend.toLowerCase().includes('yes') ? 'var(--success)' : 'var(--text-secondary)'}">${escapeHTML(row.recommend || 'N/A')}</span></td>
            </tr>
        `;
    }).join('');
}

function getRatingPill(rating) {
    if (!rating) return '<span class="text-muted">N/A</span>';
    const cleanRating = rating.trim().toLowerCase();
    
    let ratingClass = 'average';
    if (cleanRating.includes('excellent')) ratingClass = 'excellent';
    else if (cleanRating.includes('good')) ratingClass = 'good';
    else if (cleanRating.includes('poor') || cleanRating.includes('bad')) ratingClass = 'poor';
    
    return `<span class="rating-pill ${ratingClass}">${escapeHTML(rating)}</span>`;
}

function escapeHTML(str) {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// --- NPS Analytics Dashboard Controllers ---

async function loadInsightsData() {
    showToast('Updating store NPS metrics...', 'info');
    
    let queryParams = '';
    if (currentStartDate && currentEndDate) {
        queryParams = `?startDate=${currentStartDate}&endDate=${currentEndDate}`;
    }
    
    await Promise.all([
        fetchTopBottomNps(queryParams),
        fetchCityNps(queryParams),
        fetchNpsTrends(), // Unfiltered by date
        fetchCityTrends() // Unfiltered by date
    ]);
}

async function fetchTopBottomNps(queryParams = '') {
    try {
        const response = await fetch(`/api/analytics/nps/top-bottom${queryParams}`);
        const data = await response.json();
        if (data.success) {
            overallNpsData = data.data;
            populateAreaFilter();
            filterAndRenderLeaderboards();
        }
    } catch (err) {
        console.error('Error fetching top-bottom NPS:', err);
        showToast('Failed to load store leaderboards.', 'danger');
    }
}

async function fetchCityNps(queryParams = '') {
    try {
        const response = await fetch(`/api/analytics/nps/cities${queryParams}`);
        const data = await response.json();
        if (data.success) {
            overallCityData = data.data;
            renderCityNpsChart();
        }
    } catch (err) {
        console.error('Error fetching City NPS:', err);
        showToast('Failed to load city-wise NPS.', 'danger');
    }
}

function renderCityNpsChart() {
    const ctx = document.getElementById('chartCityNps').getContext('2d');
    
    if (chartCityNpsInstance) {
        chartCityNpsInstance.destroy();
    }
    
    const labels = overallCityData.map(d => d.city);
    const values = overallCityData.map(d => d.nps_score);
    
    chartCityNpsInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'NPS Score',
                data: values,
                backgroundColor: 'rgba(253, 224, 71, 0.85)',
                borderColor: 'rgba(253, 224, 71, 1)',
                borderWidth: 1,
                borderRadius: 6,
                hoverBackgroundColor: 'rgba(253, 224, 71, 0.3)'
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => ` NPS: ${context.parsed.x}`
                    }
                }
            },
            scales: {
                x: {
                    min: -100,
                    max: 100,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8' }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: '#f8fafc', font: { size: 11 } }
                }
            }
        }
    });
}

function populateAreaFilter() {
    const areas = [...new Set(overallNpsData.map(d => d.area))].sort();
    const currentVal = areaFilter.value;
    
    areaFilter.innerHTML = '<option value="ALL">All Areas</option>';
    
    areas.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a;
        opt.textContent = a;
        areaFilter.appendChild(opt);
    });
    
    if (currentVal && areas.includes(currentVal)) {
        areaFilter.value = currentVal;
    } else {
        areaFilter.value = 'ALL';
    }
}

function filterAndRenderLeaderboards() {
    const selectedArea = areaFilter.value;
    
    let filteredData = overallNpsData;
    if (selectedArea !== 'ALL') {
        filteredData = overallNpsData.filter(d => d.area === selectedArea);
    }
    
    renderLeaderboards(filteredData);
}

function renderLeaderboards(records) {
    if (!records || records.length === 0) return;
    
    // Sort records descending by NPS score
    const sorted = [...records].sort((a, b) => b.nps_score - a.nps_score);
    
    // Top 10 Branches
    const top10 = sorted.slice(0, 10);
    
    // Bottom 10 Branches (reverse order to display worst-performing first)
    const bottom10 = [...sorted].reverse().slice(0, 10);
    
    renderLeaderboardChart('chartTopNps', top10, 'rgba(16, 185, 129, 0.85)', 'rgba(16, 185, 129, 0.3)', true);
    renderLeaderboardChart('chartBottomNps', bottom10, 'rgba(239, 68, 68, 0.85)', 'rgba(239, 68, 68, 0.3)', false);
}

function renderLeaderboardChart(canvasId, dataset, color, hoverColor, isTopChart) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    
    if (isTopChart && chartTopNpsInstance) {
        chartTopNpsInstance.destroy();
    } else if (!isTopChart && chartBottomNpsInstance) {
        chartBottomNpsInstance.destroy();
    }
    
    const labels = dataset.map(d => `${d.branch} (${d.area})`);
    const values = dataset.map(d => d.nps_score);
    
    const chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'NPS Score',
                data: values,
                backgroundColor: color,
                borderColor: color.replace('0.85', '1'),
                borderWidth: 1,
                borderRadius: 6,
                hoverBackgroundColor: hoverColor
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => ` NPS: ${context.parsed.x}`
                    }
                }
            },
            scales: {
                x: {
                    min: -100,
                    max: 100,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8' }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: '#f8fafc', font: { size: 11 } }
                }
            }
        }
    });
    
    if (isTopChart) {
        chartTopNpsInstance = chart;
    } else {
        chartBottomNpsInstance = chart;
    }
}

async function fetchNpsTrends() {
    try {
        const response = await fetch('/api/analytics/nps/trends');
        const data = await response.json();
        if (data.success) {
            npsTrendsData = data.data;
            if (trendMode.value === 'STORE') {
                populateStoreFilter();
                renderTrendsChart();
            }
        }
    } catch (err) {
        console.error('Error fetching NPS trends:', err);
        showToast('Failed to load MoM trends.', 'danger');
    }
}

async function fetchCityTrends() {
    try {
        const response = await fetch('/api/analytics/nps/city-trends');
        const data = await response.json();
        if (data.success) {
            cityTrendsData = data.data;
            if (trendMode.value === 'CITY') {
                populateStoreFilter();
                renderTrendsChart();
            }
        }
    } catch (err) {
        console.error('Error fetching City trends:', err);
    }
}

function populateStoreFilter() {
    const mode = trendMode.value;
    const currentVal = storeFilter.value;
    
    if (mode === 'STORE') {
        const branches = [...new Set(npsTrendsData.map(d => d.branch))].sort();
        storeFilter.innerHTML = '<option value="ALL">All Stores Average</option>';
        
        branches.forEach(b => {
            const opt = document.createElement('option');
            opt.value = b;
            opt.textContent = b;
            storeFilter.appendChild(opt);
        });
        
        if (currentVal && branches.includes(currentVal)) {
            storeFilter.value = currentVal;
        } else {
            storeFilter.value = 'ALL';
        }
    } else {
        const cities = [...new Set(cityTrendsData.map(d => d.city))].sort();
        storeFilter.innerHTML = '<option value="ALL">All Cities Average</option>';
        
        cities.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            storeFilter.appendChild(opt);
        });
        
        if (currentVal && cities.includes(currentVal)) {
            storeFilter.value = currentVal;
        } else {
            storeFilter.value = 'ALL';
        }
    }
}

function setupFilters() {
    storeFilter.addEventListener('change', () => {
        renderTrendsChart();
    });
    areaFilter.addEventListener('change', () => {
        filterAndRenderLeaderboards();
    });
    datePreset.addEventListener('change', () => {
        handleDatePresetChange();
    });
    btnApplyCustomDate.addEventListener('click', () => {
        handleCustomDateApply();
    });
    trendMode.addEventListener('change', () => {
        handleTrendModeChange();
    });
}

function handleTrendModeChange() {
    const mode = trendMode.value;
    if (mode === 'STORE') {
        compareFilterLabel.innerHTML = '<i class="fa-solid fa-store"></i> Select Store:';
    } else {
        compareFilterLabel.innerHTML = '<i class="fa-solid fa-city"></i> Select City:';
    }
    populateStoreFilter();
    renderTrendsChart();
}

function handleDatePresetChange() {
    const val = datePreset.value;
    
    if (val === 'CUSTOM') {
        customDateContainer.style.display = 'flex';
        // Set default custom dates to current month range if empty
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
        if (!startDateInput.value) startDateInput.value = firstDay;
        if (!endDateInput.value) endDateInput.value = lastDay;
    } else {
        customDateContainer.style.display = 'none';
        calculateDateRange(val);
        loadInsightsData();
    }
}

function calculateDateRange(preset) {
    const now = new Date();
    
    switch (preset) {
        case 'TODAY': {
            const todayStr = now.toISOString().split('T')[0];
            currentStartDate = todayStr;
            currentEndDate = todayStr;
            break;
        }
        case 'MONTH': {
            const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
            const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
            currentStartDate = firstDay;
            currentEndDate = lastDay;
            break;
        }
        case 'YEAR': {
            currentStartDate = `${now.getFullYear()}-01-01`;
            currentEndDate = `${now.getFullYear()}-12-31`;
            break;
        }
        case 'ALL':
        default: {
            currentStartDate = null;
            currentEndDate = null;
            break;
        }
    }
}

function handleCustomDateApply() {
    const start = startDateInput.value;
    const end = endDateInput.value;
    
    if (!start || !end) {
        showToast('Please select both start and end dates.', 'danger');
        return;
    }
    
    if (new Date(start) > new Date(end)) {
        showToast('Start date cannot be after end date.', 'danger');
        return;
    }
    
    currentStartDate = start;
    currentEndDate = end;
    loadInsightsData();
}

function renderTrendsChart() {
    const ctx = document.getElementById('chartNpsTrends').getContext('2d');
    
    if (chartTrendsInstance) {
        chartTrendsInstance.destroy();
    }
    
    const mode = trendMode.value;
    const filterVal = storeFilter.value;
    
    let allMonths = [];
    let chartData = [];
    let label = '';
    
    if (mode === 'STORE') {
        allMonths = [...new Set(npsTrendsData.map(d => d.month_key))].sort();
        if (filterVal === 'ALL') {
            label = 'All Stores Average NPS';
            chartData = allMonths.map(month => {
                const monthRecords = npsTrendsData.filter(d => d.month_key === month);
                if (monthRecords.length === 0) return 0;
                const sum = monthRecords.reduce((acc, curr) => acc + parseFloat(curr.nps_score), 0);
                return parseFloat((sum / monthRecords.length).toFixed(1));
            });
        } else {
            label = `${filterVal} NPS Trend`;
            chartData = allMonths.map(month => {
                const record = npsTrendsData.find(d => d.branch === filterVal && d.month_key === month);
                return record ? parseFloat(record.nps_score) : null;
            });
        }
    } else {
        allMonths = [...new Set(cityTrendsData.map(d => d.month_key))].sort();
        if (filterVal === 'ALL') {
            label = 'All Cities Average NPS';
            chartData = allMonths.map(month => {
                const monthRecords = cityTrendsData.filter(d => d.month_key === month);
                if (monthRecords.length === 0) return 0;
                const sum = monthRecords.reduce((acc, curr) => acc + parseFloat(curr.nps_score), 0);
                return parseFloat((sum / monthRecords.length).toFixed(1));
            });
        } else {
            label = `${filterVal} NPS Trend`;
            chartData = allMonths.map(month => {
                const record = cityTrendsData.find(d => d.city === filterVal && d.month_key === month);
                return record ? parseFloat(record.nps_score) : null;
            });
        }
    }
    
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthLabels = allMonths.map(key => {
        const parts = key.split('-');
        const monthIndex = parseInt(parts[1], 10) - 1;
        return `${monthNames[monthIndex]} ${parts[0]}`;
    });
    
    chartTrendsInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: monthLabels,
            datasets: [{
                label: label,
                data: chartData,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 3,
                tension: 0.35,
                fill: true,
                pointBackgroundColor: '#06b6d4',
                pointBorderColor: '#ffffff',
                pointRadius: 6,
                pointHoverRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: '#f8fafc', font: { size: 12 } }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8' }
                },
                y: {
                    min: -100,
                    max: 100,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8' }
                }
            }
        }
    });
}
