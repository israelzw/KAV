const admZip = require('adm-zip');
const fs = require('fs');
const path = require('path');

async function parseCSV(text) {
    const lines = text.split(/\r?\n/);
    if (lines.length === 0) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    return lines.slice(1).filter(l => l.trim()).map(line => {
        const values = line.split(',');
        const obj = {};
        headers.forEach((h, i) => {
            obj[h] = values[i] ? values[i].trim().replace(/"/g, '') : '';
        });
        return obj;
    });
}

async function processGTFS() {
    const zipPath = './gtfs.zip';
    const url = 'https://gtfs.mot.gov.il/gtfsfiles/israel-public-transportation.zip';

    try {
        console.log("Downloading GTFS...");
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        fs.writeFileSync(zipPath, Buffer.from(buffer));

        console.log("Extracting and reading files...");
        const zip = new admZip(zipPath);
        
        const getFile = (name) => zip.readAsText(name, "utf8");

        const [agencyRaw, routesRaw, stopsRaw, tripsRaw, stopTimesRaw] = await Promise.all([
            parseCSV(getFile("agency.txt")),
            parseCSV(getFile("routes.txt")),
            parseCSV(getFile("stops.txt")),
            parseCSV(getFile("trips.txt")),
            parseCSV(getFile("stop_times.txt"))
        ]);

        console.log("Processing maps...");
        const agencyMap = {};
        agencyRaw.forEach(a => agencyMap[a.agency_id] = a.agency_name);

        const stopNameMap = {};
        stopsRaw.forEach(s => stopNameMap[s.stop_id] = s.stop_name);

        const routeInfoMap = {};
        routesRaw.forEach(r => {
            routeInfoMap[r.route_id] = {
                line_number: r.route_short_name,
                agency_name: agencyMap[r.agency_id] || "לא ידוע"
            };
        });

        const tripToStops = {};
        stopTimesRaw.forEach(st => {
            if (!tripToStops[st.trip_id]) tripToStops[st.trip_id] = [];
            tripToStops[st.trip_id].push({
                name: stopNameMap[st.stop_id] || "תחנה לא ידועה",
                seq: parseInt(st.stop_sequence)
            });
        });

        console.log("Building routes list...");
        const routesList = [];
        const seenRoutes = new Set();

        tripsRaw.forEach(t => {
            const info = routeInfoMap[t.route_id];
            if (!info) return;

            const uniqueKey = `${t.route_id}_${t.direction_id}`;
            if (seenRoutes.has(uniqueKey)) return;

            const stops = (tripToStops[t.trip_id] || [])
                .sort((a, b) => a.seq - b.seq)
                .map(s => s.name.replace(/''/g, `"`));

            if (stops.length > 0) {
                routesList.push({
                    line_number: info.line_number,
                    agency: info.agency_name,
                    route_id: t.route_id,
                    direction_id: t.direction_id,
                    stops: stops
                });
                seenRoutes.add(uniqueKey);
            }
        });

        // יצירת פורמט ה-JS המבוקש
        const jsOutput = `const stopsData = ${JSON.stringify(routesList)};`;
        fs.writeFileSync('database.js', jsOutput);
        
        console.log("Success! File saved as all_routes_database.js");

        // ניקוי הקובץ הזמני
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

    } catch (err) {
        console.error("Error:", err);
        process.exit(1);
    }
}

processGTFS();
