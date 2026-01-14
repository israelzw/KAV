const admZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

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

async function get() {
    const zipPath = './gtfs.zip';
    const extractPath = './gtfs_extracted';
    const url = 'https://gtfs.mot.gov.il/gtfsfiles/israel-public-transportation.zip';

    try {
        console.log("Downloading...");
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0'
            },
            // הגדרת זמן המתנה ארוך יותר לחיבור
            signal: AbortSignal.timeout(60000) 
        });
        fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));

        const zip = new admZip(zipPath);
        zip.extractAllTo(extractPath, true);

        const stopsData = {};
        const routeMap = {};
        const tripToRoute = {};

        // 1. קריאת תחנות
        await processFile(path.join(extractPath, 'stops.txt'), (cols, head) => {
            const id = cols[head.indexOf('stop_id')];
            if (!id) return;
            stopsData[id] = {
                stop_code: cols[head.indexOf('stop_code')],
                stop_name: (cols[head.indexOf('stop_name')] || "").replace(/''/g, `"`),
                stop_desc: (cols[head.indexOf('stop_desc')] || "").replace(/''/g, `"`),
                stop_lat: cols[head.indexOf('stop_lat')],
                stop_lon: cols[head.indexOf('stop_lon')],
                stop_lines: {}
            };
        });

        // 2. קריאת קווים
        await processFile(path.join(extractPath, 'routes.txt'), (cols, head) => {
            routeMap[cols[head.indexOf('route_id')]] = {
                number: cols[head.indexOf('route_short_name')],
                longName: cols[head.indexOf('route_long_name')],
                agency: cols[head.indexOf('agency_id')]
            };
        });

        // 3. עיבוד נסיעות (כולל direction_id ויעד)
        await processFile(path.join(extractPath, 'trips.txt'), (cols, head) => {
            const rId = cols[head.indexOf('route_id')];
            const route = routeMap[rId];
            if (route) {
                const nameParts = route.longName.split('<->');
                tripToRoute[cols[head.indexOf('trip_id')]] = {
                    route_id: rId,
                    direction_id: cols[head.indexOf('direction_id')] || "0",
                    number: route.number,
                    from: (nameParts[0] || "").trim(),
                    to: (nameParts[1] || "").trim(),
                    target: (cols[head.indexOf('trip_headsign')] || "").trim(),
                    agency: route.agency
                };
            }
        });

        // 4. הצלבה
        await processFile(path.join(extractPath, 'stop_times.txt'), (cols, head) => {
            const tId = cols[head.indexOf('trip_id')];
            const sId = cols[head.indexOf('stop_id')];
            const info = tripToRoute[tId];

            if (info && stopsData[sId]) {
                if (!stopsData[sId].stop_lines[info.number]) {
                    stopsData[sId].stop_lines[info.number] = new Set();
                }
                const routeString = JSON.stringify({
                    route_id: info.route_id,
                    direction_id: info.direction_id,
                    "מ": info.from.replace(/''/g, `"`),
                    "ל": info.to.replace(/''/g, `"`),
                    "יעד": info.target.replace(/''/g, `"`),
                    "חברה": info.agency
                });
                stopsData[sId].stop_lines[info.number].add(routeString);
            }
        });

        // 5. המרה סופית לשמירה כקובץ JS עם המשתנה המבוקש
        const finalArray = Object.values(stopsData)
            .filter(s => Object.keys(s.stop_lines).length > 0)
            .map(stop => {
                const formattedLines = {};
                for (const [num, set] of Object.entries(stop.stop_lines)) {
                    formattedLines[num] = Array.from(set).map(s => JSON.parse(s));
                }
                return { ...stop, stop_lines: formattedLines };
            });

        const jsOutput = `const stopsDataRaw = ${JSON.stringify(finalArray)};`;
        fs.writeFileSync('data.js', jsOutput);
        
        console.log("Done! Success.");

    } catch (e) {
        console.error(e);
    }
}

get();
