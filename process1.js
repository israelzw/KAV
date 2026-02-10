const admZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// פונקציה לקריאת קובץ CSV שורה אחר שורה כדי לא להעמיס על הזיכרון
async function parseCSVLineByLine(filePath, onLine) {
    const fileStream = fs.createReadStream(filePath);

    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let headers = null;

    for await (const line of rl) {
        if (!line.trim()) continue;

        // הסרת מרכאות ורווחים
        const cleanLine = line.replace(/\r/g, ''); 
        
        if (!headers) {
            headers = cleanLine.split(',').map(h => h.trim().replace(/"/g, ''));
            continue;
        }

        const values = cleanLine.split(','); // שים לב: זה פיצול פשוט, אם יש פסיקים בתוך ערכים זה דורש ספריית CSV אמיתית
        const obj = {};
        headers.forEach((h, i) => {
            obj[h] = values[i] ? values[i].trim().replace(/"/g, '') : '';
        });

        onLine(obj);
    }
}

async function processGTFS() {
    const zipPath = './gtfs.zip';
    const extractPath = './gtfs_extract'; // תיקייה זמנית לחילוץ
    const url = 'https://gtfs.mot.gov.il/gtfsfiles/israel-public-transportation.zip';

    try {
        console.log("Downloading GTFS...");
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        fs.writeFileSync(zipPath, Buffer.from(buffer));

        console.log("Extracting files to disk...");
        const zip = new admZip(zipPath);
        // חילוץ לדיסק במקום לזיכרון כדי למנוע את שגיאת String Too Long
        zip.extractAllTo(extractPath, true); 

        console.log("Processing maps...");
        
        // 1. טעינת Agency (קובץ קטן, אפשר רגיל או עם הסטרים)
        const agencyMap = {};
        await parseCSVLineByLine(path.join(extractPath, 'agency.txt'), (a) => {
            agencyMap[a.agency_id] = a.agency_name;
        });

        // 2. טעינת Stops
        const stopNameMap = {};
        await parseCSVLineByLine(path.join(extractPath, 'stops.txt'), (s) => {
            stopNameMap[s.stop_id] = s.stop_name;
        });

        // 3. טעינת Routes
        const routeInfoMap = {};
        await parseCSVLineByLine(path.join(extractPath, 'routes.txt'), (r) => {
            routeInfoMap[r.route_id] = {
                line_number: r.route_short_name,
                agency_name: agencyMap[r.agency_id] || "לא ידוע"
            };
        });

        // 4. טעינת Stop Times - החלק הכבד!
        console.log("Processing stop_times (this takes time)...");
        const tripToStops = {};
        // אופטימיזציה: שימוש במערכים במקום אובייקטים כבדים איפה שאפשר
        await parseCSVLineByLine(path.join(extractPath, 'stop_times.txt'), (st) => {
            if (!tripToStops[st.trip_id]) tripToStops[st.trip_id] = [];
            tripToStops[st.trip_id].push({
                name: stopNameMap[st.stop_id] || "תחנה לא ידועה",
                seq: parseInt(st.stop_sequence)
            });
        });

        console.log("Processing trips and building final list...");
        const routesList = [];
        const seenRoutes = new Set();

        await parseCSVLineByLine(path.join(extractPath, 'trips.txt'), (t) => {
            const info = routeInfoMap[t.route_id];
            if (!info) return;

            const uniqueKey = `${t.route_id}_${t.direction_id}`;
            if (seenRoutes.has(uniqueKey)) return;

            // בדיקה אם יש עצירות לנסיעה הזו
            if (tripToStops[t.trip_id]) {
                const stops = tripToStops[t.trip_id]
                    .sort((a, b) => a.seq - b.seq)
                    .map(s => s.name.replace(/'/g, `"`)); // תיקון גרשיים

                if (stops.length > 0) {
                    routesList.push({
                        line_number: info.line_number,
                        agency: info.agency_name,
                        route_id: t.route_id,
                        direction_id: t.direction_id,
                        stops: stops
                    });
                    seenRoutes.add(uniqueKey);
                    
                    // ניקוי זיכרון: ברגע שהשתמשנו במידע של ה-trip הזה כדי להגדיר את הקו,
                    // טכנית אפשר למחוק אותו, אבל מכיוון שיש הרבה trips לאותו route,
                    // זה מורכב. במקרה הזה נשאיר ככה, אבל אם עדיין יש חריגת זיכרון (OOM)
                    // נצטרך לוגיקה מורכבת יותר.
                }
            }
        });

        console.log(`Writing database with ${routesList.length} routes...`);
        const jsOutput = `const stopsData = ${JSON.stringify(routesList)};`;
        fs.writeFileSync('database.js', jsOutput);
        
        console.log("Success! Cleaning up...");
        
        // ניקוי
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        fs.rmSync(extractPath, { recursive: true, force: true });

    } catch (err) {
        console.error("Error:", err);
        process.exit(1);
    }
}

processGTFS();
