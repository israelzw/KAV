const admZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// פונקציה לקריאת קובץ שורה אחר שורה כדי לחסוך בזיכרון
async function processFile(filePath, callback) {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    let headers = [];
    let isFirst = true;
    for await (const line of rl) {
        const cleanLine = line.replace(/"/g, '');
        if (isFirst) {
            headers = cleanLine.split(',').map(h => h.trim());
            isFirst = false;
            continue;
        }
        callback(cleanLine.split(','), headers);
    }
}

async function processGTFS() {
    const zipPath = './gtfs.zip';
    const extractPath = './gtfs_extracted';
    const url = 'https://gtfs.mot.gov.il/gtfsfiles/israel-public-transportation.zip';

    try {
        if (!fs.existsSync(extractPath)) fs.mkdirSync(extractPath);

        console.log("Downloading GTFS...");
        const res = await fetch(url, {
            method: 'GET',
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(120000) // זמן המתנה מורחב להורדה גדולה
        });
        
        const buffer = await res.arrayBuffer();
        fs.writeFileSync(zipPath, Buffer.from(buffer));

        console.log("Extracting files...");
        const zip = new admZip(zipPath);
        zip.extractAllTo(extractPath, true);

        const agencyMap = {};
        const stopNameMap = {};
        const routeInfoMap = {};
        const tripToRoute = {};
        const routeDirections = {}; // אובייקט לאחסון תחנות לפי קו וכיוון

        // 1. מיפוי חברות תחבורה
        console.log("Mapping agencies...");
        await processFile(path.join(extractPath, 'agency.txt'), (cols, head) => {
            agencyMap[cols[head.indexOf('agency_id')]] = cols[head.indexOf('agency_name')];
        });

        // 2. מיפוי שמות תחנות
        console.log("Mapping stops...");
        await processFile(path.join(extractPath, 'stops.txt'), (cols, head) => {
            stopNameMap[cols[head.indexOf('stop_id')]] = (cols[head.indexOf('stop_name')] || "").replace(/''/g, '"');
        });

        // 3. מיפוי קווים
        console.log("Mapping routes...");
        await processFile(path.join(extractPath, 'routes.txt'), (cols, head) => {
            const rId = cols[head.indexOf('route_id')];
            routeInfoMap[rId] = {
                line_number: cols[head.indexOf('route_short_name')],
                agency_name: agencyMap[cols[head.indexOf('agency_id')]] || "לא ידוע"
            };
        });

        // 4. מיפוי נסיעות (Trips) כדי לקשר בין נסיעה ספציפית למסלול וכיוון
        console.log("Mapping trips...");
        await processFile(path.join(extractPath, 'trips.txt'), (cols, head) => {
            const rId = cols[head.indexOf('route_id')];
            const tId = cols[head.indexOf('trip_id')];
            const dId = cols[head.indexOf('direction_id')] || "0";
            
            if (routeInfoMap[rId]) {
                tripToRoute[tId] = { route_id: rId, direction_id: dId };
                
                // יוצרים מפתח ייחודי לקו וכיוון אם לא קיים
                const uniqueKey = `${rId}_${dId}`;
                if (!routeDirections[uniqueKey]) {
                    routeDirections[uniqueKey] = {
                        info: routeInfoMap[rId],
                        direction_id: dId,
                        representativeTripId: tId, // נשמור נסיעה אחת מייצגת כדי לקבל את רשימת התחנות
                        stops: []
                    };
                }
            }
        });

        // 5. איסוף תחנות עבור כל נסיעה מייצגת
        console.log("Processing stop times...");
        // נאסוף קודם את כל ה-trip_ids שאנחנו צריכים לעקוב אחריהם
        const targetTrips = new Set(Object.values(routeDirections).map(rd => rd.representativeTripId));
        const tempStopData = {};

        await processFile(path.join(extractPath, 'stop_times.txt'), (cols, head) => {
            const tId = cols[head.indexOf('trip_id')];
            if (targetTrips.has(tId)) {
                if (!tempStopData[tId]) tempStopData[tId] = [];
                tempStopData[tId].push({
                    name: stopNameMap[cols[head.indexOf('stop_id')]] || "תחנה לא ידועה",
                    seq: parseInt(cols[head.indexOf('stop_sequence')])
                });
            }
        });

        // 6. בניית הרשימה הסופית
        console.log("Finalizing database...");
        const routesList = Object.values(routeDirections).map(rd => {
            const stops = (tempStopData[rd.representativeTripId] || [])
                .sort((a, b) => a.seq - b.seq)
                .map(s => s.name);

            return {
                line_number: rd.info.line_number,
                agency: rd.info.agency_name,
                route_id: rd.representativeTripId.split('_')[0], // המזהה המקורי של הקו
                direction_id: rd.direction_id,
                stops: stops
            };
        }).filter(r => r.stops.length > 0);

        // שמירה לקובץ
        const jsOutput = `const stopsData = ${JSON.stringify(routesList)};`;
        fs.writeFileSync('database.js', jsOutput);
        
        console.log("Success! File saved as database.js");

        // ניקוי
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

    } catch (err) {
        console.error("Error occurred:", err);
    }
}

processGTFS();
