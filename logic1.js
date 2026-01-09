let localStopsData = stopsDataRaw;
let searchTimeout = null;
let currentStopLines = {};
let selectedCityValue = ""; 

const searchInput = document.getElementById('searchInput');
const lineSearchInput = document.getElementById('lineSearchInput');
const resultsContainer = document.getElementById('resultsContainer');
const sidePanel = document.getElementById('sidePanel');
const routeDetailsContainer = document.getElementById('routeDetailsContainer');

const cityFilterWrapper = document.getElementById('cityFilterWrapper');
const cityFilterBtn = document.getElementById('cityFilterBtn');
const cityOptionsList = document.getElementById('cityOptionsList');

/**
 * חילוץ עיר מהתיאור
 */
function extractCity(desc) {
    if (!desc) return "";
    const marker = "עיר:";
    const start = desc.indexOf(marker);
    if (start !== -1) {
        const valStart = start + marker.length;
        let valEnd = desc.length;
        const nextFields = ["|", "רציף:", "קומה:", "רחוב:"];
        nextFields.forEach(f => {
            const pos = desc.indexOf(f, valStart);
            if (pos !== -1 && pos < valEnd) valEnd = pos;
        });
        return desc.substring(valStart, valEnd).trim();
    }
    return "";
}

function closePanel() {
    sidePanel.classList.remove('open');
    document.body.classList.remove('panel-open');
    lineSearchInput.value = ""; 
    closeRoutePanel();
}

function closeRoutePanel() {
    if (routeDetailsContainer) {
        routeDetailsContainer.innerHTML = '';
        routeDetailsContainer.classList.add('hidden-route');
    }
}

// ניהול תפריט בחירת עיר
cityFilterBtn.onclick = (e) => {
    e.stopPropagation();
    const isVisible = cityOptionsList.style.display === 'block';
    cityOptionsList.style.display = isVisible ? 'none' : 'block';
};

function selectCity(city) {
    selectedCityValue = city;
    cityFilterBtn.textContent = city || "כל הערים";
    cityOptionsList.style.display = 'none';
    // בבחירה ידנית מהתפריט אנחנו מבצעים חיפוש מבלי לאפס את המשתנה
    performSearch(searchInput.value.trim(), false); 
}

window.addEventListener('click', () => {
    cityOptionsList.style.display = 'none';
});

function getCleanAddress(desc) {
    if (!desc) return "";
    const fields = ["רחוב", "עיר", "רציף", "קומה"];
    let parts = [];
    fields.forEach((field, index) => {
        const marker = field + ":";
        const start = desc.indexOf(marker);
        if (start !== -1) {
            const valStart = start + marker.length;
            let valEnd = desc.length;
            const stopMarks = ["|", "רחוב:", "עיר:", "רציף:", "קומה:"];
            stopMarks.forEach(sm => {
                const pos = desc.indexOf(sm, valStart);
                if (pos !== -1 && pos < valEnd) valEnd = pos;
            });
            const val = desc.substring(valStart, valEnd).trim();
            if (val && val !== "-" && val !== "") parts.push(`<strong>${field}:</strong> ${val}`);
        }
    });
    return parts.join(" | ");
}

const cleanRouteName = (n) => n ? n.split('-')[0].trim() : "";
const cleanRouteYaad = (n) => n && n.includes('-') ? n.split('-')[1].trim() : "";

function renderLines(filter = "") {
    const content = document.getElementById('sidePanelContent');
    let container = content.querySelector('.lines-container');
    if (container) container.remove();
    container = document.createElement('div');
    container.className = 'lines-container';
    let found = false;
    for (const [lineNum, detailsRaw] of Object.entries(currentStopLines)) {
        if (filter && !lineNum.includes(filter)) continue;
        found = true;
        const routes = Array.isArray(detailsRaw) ? detailsRaw : [detailsRaw];
        const mainRoute = routes[0];
        const agency = typeof stopsDataBoos !== 'undefined' ? stopsDataBoos.find(a => a.agency_id === mainRoute.חברה) : null;
        const aName = agency ? agency.agency_name : "לא ידוע";
        const aUrl = agency ? agency.agency_url : "#";
        const logoUrl = agency ? `logos/${agency.agency_id}.png` : '';
        const Yaad = mainRoute.יעד ? mainRoute.יעד.replace(/_/g, " - ") : cleanRouteName(mainRoute.ל);
        
        const card = document.createElement('div');
        card.className = 'line-card';
        // הוסר ה-style inline מכאן כי הוא עבר ל-CSS
        card.innerHTML = `
            <div class="line-badge-side" title="לחץ להצגת מסלול">
                <div class="line-number-box" style="background-image: url('${logoUrl}');">
                    <span class="line-number-text">${lineNum}</span>
                </div>
                <a href="${aUrl}" target="_blank" class="agency-link" 
                   onclick="event.stopPropagation()">${aName}</a>
            </div>
            <div class="line-info">
                <div><strong>יעד:</strong><span>${Yaad}</span></div>
                <div><strong>מוצא:</strong><span>${cleanRouteName(mainRoute.מ)} <small>(${cleanRouteYaad(mainRoute.מ)})</small></span></div>
                <div><strong>מגיע:</strong><span>${cleanRouteName(mainRoute.ל)} <small>(${cleanRouteYaad(mainRoute.ל)})</small></span></div>
            </div>
        `;
        card.querySelector('.line-badge-side').onclick = () => showRouteWindow(lineNum, routes);
        container.appendChild(card);
    }
    if (!found) container.innerHTML = `<p style="text-align:center; color:#999; margin-top:20px;">לא נמצא קו תואם</p>`;
    content.appendChild(container);
	content.scrollTop = 0;
}

function showRouteWindow(lineNum, routes) {
    if (!routeDetailsContainer) return;
    routeDetailsContainer.innerHTML = '';
    routeDetailsContainer.classList.remove('hidden-route');
    const stickyHeader = document.createElement('div');
    stickyHeader.className = 'route-sticky-header';
    const headerRow = document.createElement('div');
    headerRow.style.display = 'flex';
    headerRow.style.justifyContent = 'space-between';
    headerRow.style.alignItems = 'center';
    headerRow.style.padding = '10px 15px';
    headerRow.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px;">
            <span style="background:var(--primary-color); color:white; padding:2px 8px; border-radius:4px; font-weight:bold; font-size:0.9em;">${lineNum}</span>
            <strong style="color:var(--text-main);">פירוט מסלול</strong>
        </div>
        <button class="close-btn" onclick="closeRoutePanel()" style="width:30px; height:30px; font-size:14px;">✕</button>
    `;
    stickyHeader.appendChild(headerRow);
    
    if (routes.length > 1) {
        const selectContainer = document.createElement('div');
        selectContainer.style.padding = '0 15px 10px 15px';
        const selectBox = document.createElement('select');
        selectBox.style.width = '100%'; selectBox.style.padding = '8px'; selectBox.style.borderRadius = '8px';
        routes.forEach((route, index) => {
            const option = document.createElement('option');
            option.value = route.route_id;
            const destName = route.יעד ? route.יעד.replace(/_/g, " - ") : cleanRouteName(route.ל);
            option.text = `חלופה ${index + 1}: לכיוון ${destName}`;
            selectBox.appendChild(option);
        });
        selectBox.onchange = (e) => renderRouteStops(e.target.value, stopsListDiv);
        selectContainer.appendChild(selectBox);
        stickyHeader.appendChild(selectContainer);
    }
    routeDetailsContainer.appendChild(stickyHeader);
    const stopsListDiv = document.createElement('div');
    stopsListDiv.id = 'stopsListDiv';
    stopsListDiv.style.overflowY = 'auto'; stopsListDiv.style.flex = '1'; stopsListDiv.style.padding = '10px 15px';
    routeDetailsContainer.appendChild(stopsListDiv);
    renderRouteStops(routes[0].route_id, stopsListDiv);
}

function renderRouteStops(routeId, targetElement) {
    const routeData = (typeof stopsData !== 'undefined') ? stopsData.find(r => r.route_id === routeId) : null;
    targetElement.innerHTML = '';
    if (!routeData || !routeData.stops) return;
    const ul = document.createElement('ul');
    ul.style.listStyle = 'none'; ul.style.padding = '0';
    routeData.stops.forEach((stopName, idx) => {
        const li = document.createElement('li');
        li.style.padding = '6px 0'; li.style.borderBottom = '1px solid #f0f0f0'; li.style.fontSize = '0.9em';
        li.innerHTML = `<span style="color:#1a73e8; font-weight:bold; margin-left:8px;">${idx + 1}</span> <span>${stopName}</span>`;
        ul.appendChild(li);
    });
    targetElement.appendChild(ul);
}

function showLineDetails(stop) {
    lineSearchInput.value = "";
    closeRoutePanel();
    currentStopLines = stop.stop_lines || {};
    
    const content = document.getElementById('sidePanelContent');
    content.innerHTML = `
        <div class="panel-header" style="margin-bottom:15px; border-bottom: 2px solid #eee; padding-bottom:10px;">
            <h3 style="margin:0; color:#1a73e8;">${stop.stop_name}</h3>
            <p style="margin:5px 0 0; font-size:0.85em; color:#666;">מספר תחנה: ${stop.stop_code}</p>
        </div>
    `;
    
    renderLines();
    
    // איפוס הגלילה למעלה
    
    
    sidePanel.classList.add('open');
    document.body.classList.add('panel-open');
}

function updateCityDropdown(citiesFound) {
    if (citiesFound.size > 1) {
        cityFilterWrapper.style.display = 'block';
        searchInput.style.paddingLeft = '130px';
        
        let html = `<div class="city-option" onclick="selectCity('')">כל הערים</div>`;
        Array.from(citiesFound).sort().forEach(city => {
            html += `<div class="city-option" onclick="selectCity('${city}')">${city}</div>`;
        });
        cityOptionsList.innerHTML = html;
    } else {
        cityFilterWrapper.style.display = 'none';
        searchInput.style.paddingLeft = '20px';
        selectedCityValue = ""; 
        cityFilterBtn.textContent = "כל הערים";
    }
}

function performSearch(term, shouldResetCity = true) {
    resultsContainer.innerHTML = '';
    
    // איפוס מוחלט בכל הקלדה/מחיקה אלא אם כן נבחרה עיר מהתפריט
    if (shouldResetCity) {
        selectedCityValue = "";
        cityFilterBtn.textContent = "כל הערים";
    }

    if (term.length < 2) {
        cityFilterWrapper.style.display = 'none';
        searchInput.style.paddingLeft = '20px';
        return;
    }

    const searchWords = term.toLowerCase().split(/\s+/).filter(w => w.length > 0);

    const textFiltered = localStopsData.filter(s => {
        const nameStr = (s.stop_name || "").toLowerCase();
        const code = (s.stop_code || "").toString();
        
        // יצירת רשימת מילים זמינות מתוך שם התחנה לצורך "צריכה" בחיפוש
        // המפרידים הם: רווח, לוכסן, סוגריים, מקף
        let availableTokens = nameStr.split(/[\s\/\(\)\-]+/).filter(t => t.length > 0);

        // בדיקה שכל מילת חיפוש נמצאת בנפרד בשם התחנה או בקוד
        return searchWords.every(sw => {
            // 1. בדיקה אם מילת החיפוש קיימת בקוד התחנה (תמיד חיובי אם נמצא)
            if (code.includes(sw)) return true;

            // 2. בדיקה בשם התחנה - מחפשים מילה שמתחילה במונח החיפוש ועדיין לא נוצלה
            const tokenIndex = availableTokens.findIndex(token => token.startsWith(sw));
            if (tokenIndex !== -1) {
                // מצאנו התאמה - מסירים את המילה מהמאגר כדי שלא תיתפס שוב ע"י מילת חיפוש זהה נוספת
                availableTokens.splice(tokenIndex, 1);
                return true;
            }
            
            // לא נמצאה התאמה לא בקוד ולא בשם
            return false;
        });
    });

    const citiesFound = new Set();
    textFiltered.forEach(s => {
        const c = extractCity(s.stop_desc);
        if (c) citiesFound.add(c);
    });

    updateCityDropdown(citiesFound);

    // סינון סופי לפי העיר + מיון לפי א-ב
    let finalFiltered = textFiltered.filter(s => {
        if (!selectedCityValue) return true;
        return extractCity(s.stop_desc) === selectedCityValue;
    });

    // מיון התוצאות לפי שם התחנה (א-ב)
    finalFiltered.sort((a, b) => a.stop_name.localeCompare(b.stop_name, 'he'));

    finalFiltered.slice(0, 50).forEach(stop => {
        const div = document.createElement('div');
        div.className = 'result-item';
        div.innerHTML = `<span class="stop-name">${stop.stop_name} (${stop.stop_code})</span><div class="stop-addr">${getCleanAddress(stop.stop_desc)}</div>`;
        div.onclick = () => showLineDetails(stop);
        resultsContainer.appendChild(div);
		resultsContainer.scrollTop = 0;
    });
}

searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    // בכל שינוי בשדה הקלט אנחנו מפעילים את החיפוש עם איפוס עיר (ברירת מחדל true)
    searchTimeout = setTimeout(() => performSearch(e.target.value.trim()), 250);
});

lineSearchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => renderLines(e.target.value.trim()), 250);
});

document.addEventListener('keydown', (e) => {
    if (e.key === "Escape") {
		closePanel();
		cityOptionsList.style.display = 'none';
	}
});