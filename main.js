// Version: Space Weather Adapter Hauptlogik (Monolithisch V17 - Logik in Hauptklasse integriert)
"use strict";

const utils = require("@iobroker/adapter-core");
const axios = require("axios");

// Master-Liste aller benötigten Zustände (States)
const REQUIRED_STATES = {
    // --- Solar Wind & Magnetosphere ---
    "solarwind.speed": { name: "Solar Wind Speed", unit: "km/s", type: "number", role: "value.speed" },
    "solarwind.density": { name: "Solar Wind Density", unit: "cm^-3", type: "number", role: "value.density" },
    "solarwind.temperature": { name: "Solar Wind Temperature", unit: "K", type: "number", role: "value.temperature" },
    "solarwind.flow_angle": { name: "Solar Wind Flow Angle", unit: "°", type: "number", role: "value.angle" },
    "solarwind.proton_flux": { name: "Proton Flux (>10 MeV)", unit: "pfu", type: "number", role: "value.warning" }, 
    
    "magnetosphere.bx": { name: "Magnetic Field Bx (GSM)", unit: "nT", type: "number", role: "value.magneticField.x" },
    "magnetosphere.by": { name: "Magnetic Field By (GSM)", unit: "nT", type: "number", role: "value.magneticField.y" },
    "magnetosphere.bz": { name: "Magnetic Field Bz (GSM)", unit: "nT", type: "number", role: "value.magneticField.z" },
    "magnetosphere.bt": { name: "Magnetic Field Bt (Total)", unit: "nT", type: "number", role: "value.magneticField" },
    
    "electric_field.e_field": { name: "Electric Field (E-Field)", unit: "mV/m", type: "number", role: "value.electricField" },
    
    // --- Kp-Index ---
    "kp_index.value": { name: "Planetary K-Index (Kp)", unit: "", type: "number", role: "value.level" },
    "kp_index.a_running": { name: "Kp Running A-Index", unit: "", type: "number", role: "value" },
    "kp_index.station_count": { name: "Number of Stations", unit: "", type: "number", role: "value" },
    "kp_index.forecast_value": { name: "Kp Forecast Value", unit: "", type: "number", role: "value.level" },
    "kp_index.forecast_time": { name: "Kp Forecast Time", unit: "", type: "string", role: "value.datetime" },

    // --- Solar Activity ---
    "solar_activity.f107_radio_flux": { name: "F10.7 Radio Flux", unit: "sfu", type: "number", role: "value" },
    "solar_activity.sunspot_number": { name: "Sunspot Number", unit: "", type: "number", role: "value" },
    "solar_activity.xray_flux": { name: "GOES X-Ray Flux (1-8 Å)", unit: "W/m²", type: "number", role: "value.power" },
    "solar_activity.m_flare_prob": { name: "M-Class Flare Probability", unit: "%", type: "number", role: "value.forecast" },
    "solar_activity.x_flare_prob": { name: "X-Class Flare Probability", unit: "%", type: "number", role: "value.forecast" },
    
    // --- Geomagnetic Disturbance ---
    "geomagnetic_disturbance.dst_index": { name: "Dst (Disturbance Storm Time) Index", unit: "nT", type: "number", role: "value.warning" },
    "geomagnetic_disturbance.g_storm_risk": { name: "Geomagnetic Storm Risk (G-Class)", unit: "", type: "string", role: "indicator.text" },

    // --- Erdbeben-Daten ---
    "earthquake.latest.magnitude": { name: "Latest Magnitude", unit: "M", type: "number", role: "value.warning" },
    "earthquake.latest.place": { name: "Latest Location", unit: "", type: "string", role: "text" },
    "earthquake.latest.time": { name: "Latest Timestamp", unit: "", type: "string", role: "value.datetime" },
    "earthquake.latest.url": { name: "Latest Event URL", unit: "", type: "string", role: "url" },

    // --- Timestamp ---
    "last_update": { name: "Last Data Timestamp", unit: "", type: "string", role: "value.datetime" }
};

// Master-Liste aller benötigten Kanäle (Channels)
const REQUIRED_CHANNELS = {
    "magnetosphere": { name: "Magnetosphere & IMF Data" }, 
    "solarwind": { name: "Solar Wind Data" }, 
    "electric_field": { name: "Electric Field Data" },
    "kp_index": { name: "Planetary K-Index Data" },
    "solar_activity": { name: "Solar Activity" },
    "geomagnetic_disturbance": { name: "Geomagnetic Disturbance" },
    "earthquake": { name: "Earthquake Data (USGS)" },
};


class SpaceWeatherAdapter extends utils.Adapter {

    constructor(options) {
        super({
            ...options,
            name: "spaceweather",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.timer = null;
    }

    /**
     * Fetches the latest value from a NOAA array feed without applying physical filters.
     * This function is intended for ARRAY-OF-ARRAY feeds (e.g., Kp, Mag, Plasma legacy feeds).
     * @param {string} url - The API URL.
     * @param {number} valueIndex - The column index of the desired value.
     * @returns {Promise<{time_tag: string, value: number, raw_data: string[] | null} | null>}
     */
    async getLatestValueFromFeed(url, valueIndex) {
        try {
            this.log.debug(`[ARRAY-FEED] Attempting to fetch data from URL: ${url}.`);
            const response = await axios.get(url);
            this.log.debug(`[ARRAY-FEED] API call successful. HTTP Status: ${response.status} for ${url}`);

            if (!Array.isArray(response.data) || response.data.length < 2) {
                this.log.warn(`[ARRAY-FEED] API feed from ${url} is empty or invalid (Status ${response.status}).`);
                return null;
            }

            for (let i = response.data.length - 1; i > 0; i--) { 
                const current = response.data[i]; 
                
                if (!Array.isArray(current)) {
                    continue; 
                }

                if (current.length > valueIndex) {
                    const timeTag = current[0];
                    const valueRaw = String(current[valueIndex]).trim();
                    
                    if (!timeTag || String(timeTag).trim() === "") {
                        continue;
                    }

                    const valueLower = valueRaw.toLowerCase();

                    // Prüfen auf bekannte NOAA Missing Codes.
                    if (valueLower === "" || valueLower === "nan" || valueLower === "-99999.00" || valueLower.includes("-1e05")) {
                        continue;
                    }
                    
                    const parsedValue = parseFloat(valueRaw);
                        
                    if (isFinite(parsedValue)) {
                        return {
                            time_tag: timeTag,
                            value: parsedValue,
                            raw_data: current
                        };
                    } 
                }
            }
            this.log.warn(`[ARRAY-FEED] API feed from ${url} contained no single valid value (Index ${valueIndex}).`);
            return null;

        } catch (error) {
            this.log.error(`[ARRAY-FEED] Error fetching from ${url}: ${error.message}.`);
            return null;
        }
    }
    
    /**
     * Fetches the latest value from a NOAA object feed.
     * This function is intended for ARRAY-OF-OBJECT feeds (e.g., new X-Ray and Proton feeds).
     * @param {string} url - The API URL.
     * @param {string} valueKey - The key name of the desired value (e.g., 'flux').
     * @param {string} [filterKey] - Optional key name to filter on (e.g., 'energy').
     * @param {string} [filterValue] - Optional value for the filter key (e.g., '0.1-0.8nm').
     * @returns {Promise<{time_tag: string, value: number, raw_data: any} | null>}
     */
    async getLatestValueFromObjectFeed(url, valueKey, filterKey = null, filterValue = null) {
        try {
            this.log.debug(`[OBJECT-FEED] Attempting to fetch data from URL: ${url}.`);
            const response = await axios.get(url);
            this.log.debug(`[OBJECT-FEED] API call successful. HTTP Status: ${response.status} for ${url}`);

            if (!Array.isArray(response.data) || response.data.length === 0) {
                this.log.warn(`[OBJECT-FEED] API feed from ${url} is empty or invalid (Status ${response.status}).`);
                return null;
            }

            for (let i = response.data.length - 1; i >= 0; i--) { 
                const current = response.data[i]; 
                
                if (typeof current !== 'object' || current === null || current[valueKey] === undefined || !current.time_tag) {
                    continue; 
                }
                
                // 2. Apply optional filter
                if (filterKey && current[filterKey] !== filterValue) {
                    continue;
                }

                const valueRaw = String(current[valueKey]).trim();
                const valueLower = valueRaw.toLowerCase();
                
                // 3. Check for missing/error values
                if (valueLower === "" || valueLower === "nan" || valueLower === "-99999.00" || valueLower.includes("-1e05")) {
                    continue;
                }
                
                const parsedValue = parseFloat(valueRaw);
                    
                if (isFinite(parsedValue)) {
                    return {
                        time_tag: current.time_tag,
                        value: parsedValue,
                        raw_data: current
                    };
                }
            }
            this.log.warn(`[OBJECT-FEED] API feed from ${url} contained no single valid value for key '${valueKey}' (Filter: ${filterValue}).`);
            return null;

        } catch (error) {
            this.log.error(`[OBJECT-FEED] Error fetching from ${url}: ${error.message}.`);
            return null;
        }
    }


    /**
     * Fetches the latest valid entry from the Plasma feed without physical filters.
     * @param {string} url - The API URL.
     * @returns {Promise<{time_tag: string, V: number, N: number, T: number, flow_angle: number} | null>}
     */
    async getLatestPlasmaData(url) {
        this.log.debug(`[PLASMA] Attempting to fetch data from URL: ${url}.`);
        try {
            const response = await axios.get(url);

            if (!Array.isArray(response.data) || response.data.length < 2) {
                this.log.warn(`[PLASMA] Plasma feed from ${url} is empty or invalid.`);
                return null;
            }

            // Plasma feed columns: [0: time_tag, 1: V, 2: N, 3: T, 4: flow_angle]
            const V_INDEX = 1;
            const N_INDEX = 2;

            for (let i = response.data.length - 1; i > 0; i--) { 
                const current = response.data[i]; 

                if (!Array.isArray(current)) {
                    continue; 
                }

                if (current.length > N_INDEX) {
                    const timeTag = current[0];
                    const vRaw = String(current[V_INDEX]).trim().toLowerCase();
                    const nRaw = String(current[N_INDEX]).trim().toLowerCase();

                    if (timeTag && vRaw && nRaw) {
                        const isVValid = !(vRaw === "" || vRaw === "nan" || vRaw === "-99999.00" || vRaw.includes("-1e05"));
                        const isNValid = !(nRaw === "" || nRaw === "nan" || nRaw === "-99999.00" || nRaw.includes("-1e05"));

                        if (isVValid && isNValid) {
                            const V = parseFloat(vRaw);
                            const N = parseFloat(nRaw);
                        
                            if (isFinite(V) && isFinite(N)) {
                                
                                const T = parseFloat(current[3] || 0);
                                const FlowAngle = parseFloat(current[4] || 0);

                                return {
                                    time_tag: timeTag,
                                    V: V,
                                    N: N,
                                    T: T,
                                    flow_angle: FlowAngle
                                };
                            }
                        } 
                    }
                }
            }
            this.log.warn(`[PLASMA] Plasma feed from ${url} contained no single valid value.`);
            return null;

        } catch (error) {
            this.log.error(`[PLASMA] Error fetching from ${url}: ${error.message}.`);
            return null;
        }
    }

    /**
     * Fetches the text-based Space Weather Forecast and extracts probabilities.
     * @returns {Promise<{m_flare_prob: number, x_flare_prob: number, g_storm_risk: string} | null>}
     */
    async fetchAndParseForecast() {
        const forecastUrl = "https://services.swpc.noaa.gov/text/3-day-forecast.txt";
        this.log.debug(`[FORECAST] Attempting to fetch text forecast from: ${forecastUrl}`);

        try {
            const response = await axios.get(forecastUrl);
            const text = response.data;

            const result = { m_flare_prob: 0, x_flare_prob: 0, g_storm_risk: 'G0 (None)' };

            // 1. Geomagnetischer Sturm Risiko (G-Class)
            const gLevelMatch = text.match(/GEOMAGNETIC STORM\s*-\s*(G\d+)\s*\(([^)]+)\)/i);
            if (gLevelMatch && gLevelMatch[1]) {
                result.g_storm_risk = `${gLevelMatch[1]} (${gLevelMatch[2].trim()})`;
            } else if (text.match(/GEOMAGNETIC STORM\s*-\s*NONE/i)) {
                result.g_storm_risk = 'G0 (None)';
            }


            // 2. M/X-Klasse Flare Wahrscheinlichkeiten
            const rxRayHeaderIndex = text.indexOf("R/X-RAY:");

            if (rxRayHeaderIndex !== -1) {
                const tableSection = text.substring(rxRayHeaderIndex);
                // Sucht nach den vier täglichen Zahlen (A-Class, B-Class, M-Class, X-Class)
                const dailyForecastMatch = tableSection.match(/:\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/);

                if (dailyForecastMatch) {
                    // dailyForecastMatch[3] ist M-Class, [4] ist X-Class
                    result.m_flare_prob = parseInt(dailyForecastMatch[3], 10);
                    result.x_flare_prob = parseInt(dailyForecastMatch[4], 10);
                }
            }

            this.log.info(`[FORECAST] Parsed: M-Flare: ${result.m_flare_prob}%, X-Flare: ${result.x_flare_prob}%, G-Storm: ${result.g_storm_risk}`);
            return result;

        } catch (error) {
            this.log.error(`[FORECAST] Error fetching or parsing text forecast from ${forecastUrl}: ${error.message}.`);
            return null;
        }
    }
    
    /**
     * Fetches the latest observed sunspot number.
     * @returns {Promise<number | null>} The latest observed sunspot number (SSN).
     */
    async fetchSunspotNumber() {
        const url = "https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json"; 
        this.log.debug(`[SSN] Attempting to fetch Sunspot Number from: ${url}`);

        try {
            const response = await axios.get(url);
            if (!Array.isArray(response.data) || response.data.length === 0) {
                this.log.warn(`[SSN] API feed from ${url} is empty or invalid.`);
                return null;
            }
            
            const SSN_KEY = "observed_swpc_ssn"; 
            
            for (let i = response.data.length - 1; i >= 0; i--) { 
                const current = response.data[i]; 
                
                if (typeof current === 'object' && current !== null && current[SSN_KEY] !== undefined) {
                    const ssnRaw = String(current[SSN_KEY]).trim();
                    const ssn = parseFloat(ssnRaw);

                    if (isFinite(ssn) && ssn >= 0) {
                        this.log.info(`[SSN] Latest valid Sunspot Number found: ${ssn}`);
                        return ssn;
                    } 
                } 
            }
            
            this.log.warn(`[SSN] No valid Sunspot Number found in the feed: ${url}.`);
            return null;

        } catch (error) {
            this.log.error(`[SSN] Error fetching from ${url}: ${error.message}.`);
            return null;
        }
    }

    /**
     * Fetches the latest Proton Flux data.
     * @returns {Promise<{value: number, time_tag: string} | null>}
     */
    async fetchProtonFlux() {
        const protonUrls = [
            "https://services.swpc.noaa.gov/json/goes/secondary/integral-protons-7-day.json",   
            "https://services.swpc.noaa.gov/json/goes/primary/integral-protons-7-day.json",    
            "https://services.swpc.noaa.gov/json/goes/secondary/integral-protons-6-hour.json", 
        ];
        
        let protonData = null;
        let attempt = 0;

        for (const url of protonUrls) {
            attempt++;
            this.log.debug(`[PROTON] Attempting URL ${attempt}: ${url}`);
            
            // Kein Filter, da der Feed nur Integral Protons enthält.
            protonData = await this.getLatestValueFromObjectFeed(url, "flux");
            
            if (protonData) {
                this.log.info(`[PROTON] Flux successfully retrieved from URL ${attempt}.`);
                return protonData;
            } else {
                if (attempt < protonUrls.length) {
                    this.log.warn(`[PROTON] URL ${attempt} failed. Trying next fallback.`);
                }
            }
        }
        
        return null;
    }

    /**
     * Fetches the latest M2.5+ earthquake data from USGS.
     * @returns {Promise<{magnitude: number, place: string, time: string, url: string} | null>}
     */
    async fetchEarthquakeData() {
        const url = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson";
        this.log.debug(`[USGS] Attempting to fetch earthquake data from: ${url}`);

        try {
            const response = await axios.get(url);

            if (response.status !== 200 || !response.data || !Array.isArray(response.data.features) || response.data.features.length === 0) {
                this.log.warn(`[USGS] Earthquake feed from ${url} is empty or invalid.`);
                return null;
            }

            const latestFeature = response.data.features[0];
           const properties = latestFeature.properties;

            if (properties && properties.mag && properties.place && properties.time && properties.url) {
                const timeString = new Date(properties.time).toISOString();

                const result = {
                    magnitude: parseFloat(properties.mag),
                    place: String(properties.place),
                    time: timeString,
                    url: String(properties.url)
                };

                this.log.info(`[USGS] Latest Earthquake: M${result.magnitude} at ${result.place}`);
                return result;
            } else {
                this.log.warn("[USGS] Latest earthquake feature is missing required properties.");
                return null;
            }
        } catch (error) {
            this.log.error(`[USGS] Error fetching earthquake data from ${url}: ${error.message}.`);
            return null;
        }
    }


    /**
     * Fetches the latest X-Ray Flux data with a fallback logic.
     * @returns {Promise<{value: number, time_tag: string} | null>}
     */
    async fetchXRayFlux() {
        const xrayUrls = [
            "https://services.swpc.noaa.gov/json/goes/primary/xrays-7-day.json",      
            "https://services.swpc.noaa.gov/json/goes/secondary/xrays-7-day.json",    
            "https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json",     
            "https://services.swpc.noaa.gov/json/goes/secondary/xrays-6-hour.json",   
        ];
        
        let xrayData = null;
        let attempt = 0;

        for (const url of xrayUrls) {
            attempt++;
            this.log.debug(`[XRAY] Attempting URL ${attempt}: ${url}`);
            
            // Wert ist "flux", Filter ist "energy" = "0.1-0.8nm" (Long Wave)
            xrayData = await this.getLatestValueFromObjectFeed(url, "flux", "energy", "0.1-0.8nm");
            
            if (xrayData) {
                this.log.info(`[XRAY] Flux successfully retrieved from URL ${attempt}.`);
                return xrayData;
            } else {
                this.log.warn(`[XRAY] URL ${attempt} failed. Trying next fallback.`);
            }
        }

        return null;
    }


    async onReady() {
        const updateIntervalMinutes = parseInt(this.config.updateInterval, 10) || 5;
        const apiKey = this.config.apiKey;

        this.log.info(`SpaceWeather Adapter gestartet. Update Intervall: ${updateIntervalMinutes} Minuten.`);
        
        await this.ensureObjects(); 
        await this.deleteUnusedObjects(); 
        await this.fetchData(apiKey); 
        
        const intervalMs = updateIntervalMinutes * 60 * 1000;
        this.timer = setInterval(() => this.fetchData(apiKey), intervalMs);
    }

    /**
     * Erstellt alle benötigten Kanäle und Zustände.
     */
    async ensureObjects() {
        for (const [id, meta] of Object.entries(REQUIRED_CHANNELS)) {
            await this.setObjectNotExistsAsync(id, {
                type: "channel",
                common: { name: meta.name },
                native: {}
            });
        }

        for (const [id, meta] of Object.entries(REQUIRED_STATES)) {
            await this.setObjectAsync(id, {
                type: "state",
                common: {
                    name: meta.name,
                    type: meta.type,
                    role: meta.role || "value",
                    unit: meta.unit,
                    read: true,
                    write: false
                },
                native: {}
            });
        }
    }

    /**
     * Löscht alle Objekte (Kanäle und Zustände) der Instanz, die nicht in den REQUIRED_*-Listen stehen.
     */
    async deleteUnusedObjects() {
        this.log.debug("Starte Aufräumprozess für ungenutzte Objekte...");
        
        const requiredIds = new Set([
            "info", 
            "info.connection", 
            ...Object.keys(REQUIRED_CHANNELS),
            ...Object.keys(REQUIRED_STATES)
        ]);
        
        const allObjects = await this.getAdapterObjectsAsync();
        let deletedCount = 0;
        
        for (const fullId in allObjects) {
            if (Object.prototype.hasOwnProperty.call(allObjects, fullId)) {
                const obj = allObjects[fullId];
                
                const unprefixedId = fullId.substring(this.namespace.length + 1);

                if (!requiredIds.has(unprefixedId)) {
                    await this.delObjectAsync(unprefixedId, { recursive: true });
                    this.log.info(`Gelöschtes Objekt (Nicht mehr benötigt): ${fullId} (Typ: ${obj.type})`);
                    deletedCount++;
                }
            }
        }
        if (deletedCount > 0) {
            this.log.info(`Aufräumprozess abgeschlossen. ${deletedCount} ungenutzte Objekte wurden gelöscht.`);
        } else {
            this.log.debug("Aufräumprozess abgeschlossen. Keine ungenutzten Objekte gefunden.");
        }
    }

    async fetchData(apiKey) {
        
        const fetchedValues = {};
        let latestTimeTag = "";

        const updateLatestTimeTag = (timeTag) => {
            if (timeTag && timeTag > latestTimeTag) {
                latestTimeTag = timeTag;
            }
        };

        // --- 1. Kp-Index Data (Observation) ---
        const kpUrls = [
            "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
            "https://services.swpc.noaa.gov/products/stations/kp-last-24-hours.json"
        ];
        let kpData = null;
        for (const url of kpUrls) {
            kpData = await this.getLatestValueFromFeed(url, 1);
            if (kpData) break;
        }
        if (kpData) {
            fetchedValues.kp_value = kpData.value;
            fetchedValues.kp_a_running = parseFloat(kpData.raw_data[2] || 0);
            fetchedValues.kp_station_count = parseInt(kpData.raw_data[3] || 0, 10);
            updateLatestTimeTag(kpData.time_tag);
        } else { fetchedValues.kp_value = 0; }
        
        // --- 2. Kp-Index Forecast Data ---
        const kpForecastUrl = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json";
        const kpForecastData = await this.getLatestValueFromFeed(kpForecastUrl, 1); 
        if (kpForecastData) {
            fetchedValues.kp_forecast_value = kpForecastData.value;
            fetchedValues.kp_forecast_time = kpForecastData.time_tag;
        }

        // --- 3. Plasma Data (V, N, T, Flow Angle) ---
        const plasmaUrl = "https://services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json";
        const plasmaData = await this.getLatestPlasmaData(plasmaUrl); 
        if (plasmaData) {
            fetchedValues.solarwind_speed = plasmaData.V;
            fetchedValues.solarwind_density = plasmaData.N;
            fetchedValues.solarwind_temperature = plasmaData.T;
            fetchedValues.solarwind_flow_angle = plasmaData.flow_angle;
            updateLatestTimeTag(plasmaData.time_tag);
        }

        // --- 4. Magnetic Field Data (Bx, By, Bz, Bt) ---
        const magUrl = "https://services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json";
        const bzData = await this.getLatestValueFromFeed(magUrl, 3); // Index 3 is Bz
        if (bzData) {
            fetchedValues.magnetosphere_bz = bzData.value;
            fetchedValues.magnetosphere_bx = parseFloat(bzData.raw_data[1] || 0);
            fetchedValues.magnetosphere_by = parseFloat(bzData.raw_data[2] || 0);
            fetchedValues.magnetosphere_bt = parseFloat(bzData.raw_data[4] || 0);
            updateLatestTimeTag(bzData.time_tag);
        }

        // --- 5. Proton Flux Data (>10 MeV) ---
        const protonData = await this.fetchProtonFlux(); 
        if (protonData) {
            fetchedValues.solarwind_proton_flux = protonData.value;
            updateLatestTimeTag(protonData.time_tag);
        } else {
            fetchedValues.solarwind_proton_flux = 0;
        }

        // --- 6. F10.7 Radio Flux mit Fallback-Logik ---
        const f107Urls = [
            "https://services.swpc.noaa.gov/products/10cm-flux-30-day.json",              
            "https://services.swpc.noaa.gov/products/noaa-predicted-radio-flux.json" 
        ];
        let f107Data = null;
        for (const url of f107Urls) {
            f107Data = await this.getLatestValueFromFeed(url, 1);
            if (f107Data) break;
        }
        if (f107Data) {
            fetchedValues.f107_radio_flux = f107Data.value;
            updateLatestTimeTag(f107Data.time_tag);
        } else { fetchedValues.f107_radio_flux = 0; }
        
        // --- 7. Dst Index mit Fallback-Logik ---
        const dstUrls = [
            "https://services.swpc.noaa.gov/products/kyoto-dst.json",             
            "https://services.swpc.noaa.gov/products/dst.json"                   
        ];
        let dstData = null;
        for (const url of dstUrls) {
            dstData = await this.getLatestValueFromFeed(url, 1); 
            if (dstData) break;
        }
        if (dstData) {
            fetchedValues.dst_index = dstData.value;
            updateLatestTimeTag(dstData.time_tag);
        } else { fetchedValues.dst_index = 0; }
        
        // --- 8. GOES X-Ray Flux (1-8 Å) ---
        const xrayData = await this.fetchXRayFlux(); 
        if (xrayData) {
            fetchedValues.xray_flux = xrayData.value;
            updateLatestTimeTag(xrayData.time_tag);
        } else { fetchedValues.xray_flux = 0; }

        // --- 9. Solar Flare/Storm Forecast Data (Parsing Text Advisory) ---
        const forecastData = await this.fetchAndParseForecast();
        if (forecastData) {
            fetchedValues.m_flare_prob = forecastData.m_flare_prob;
            fetchedValues.x_flare_prob = forecastData.x_flare_prob;
            fetchedValues.g_storm_risk = forecastData.g_storm_risk;
        } else {
            fetchedValues.m_flare_prob = 0;
            fetchedValues.x_flare_prob = 0;
            fetchedValues.g_storm_risk = 'G0 (None)';
        }

        // --- 10. Earthquake Data (USGS) ---
        const earthquakeData = await this.fetchEarthquakeData();
        if (earthquakeData) {
            fetchedValues.earthquake_latest_magnitude = earthquakeData.magnitude;
            fetchedValues.earthquake_latest_place = earthquakeData.place;
            fetchedValues.earthquake_latest_time = earthquakeData.time;
            fetchedValues.earthquake_latest_url = earthquakeData.url;
            updateLatestTimeTag(earthquakeData.time);
        } 

        // --- 11. Sunspot Number ---
        const sunspotNumber = await this.fetchSunspotNumber();
        if (sunspotNumber !== null) {
            fetchedValues.solar_activity_sunspot_number = sunspotNumber;
        } else {
            fetchedValues.solar_activity_sunspot_number = 0;
        }


        // --- 12. E-Field Calculation ---
        let eField = 0;
        const V = fetchedValues.solarwind_speed;
        const Bz = fetchedValues.magnetosphere_bz;
        
        if (V !== undefined && V > 0 && Bz !== undefined) {
             eField = V * Bz * 0.001; // E-Field in mV/m
             fetchedValues.electric_field_e_field = eField;
        } else {
            fetchedValues.electric_field_e_field = 0;
        }
        
        
        // --- 13. Set States ---
        
        if (latestTimeTag) {
            await this.setStateAsync("last_update", { val: latestTimeTag, ack: true });
        } 

        // Kp-Index (Observation & Forecast)
        await this.setStateAsync("kp_index.value", { val: fetchedValues.kp_value || 0, ack: true });
        await this.setStateAsync("kp_index.a_running", { val: fetchedValues.kp_a_running || 0, ack: true });
        await this.setStateAsync("kp_index.station_count", { val: fetchedValues.kp_station_count || 0, ack: true });
        await this.setStateAsync("kp_index.forecast_value", { val: fetchedValues.kp_forecast_value || 0, ack: true });
        await this.setStateAsync("kp_index.forecast_time", { val: fetchedValues.kp_forecast_time || "", ack: true });
        
        // Solar Wind & Plasma
        await this.setStateAsync("solarwind.speed", { val: fetchedValues.solarwind_speed || 0, ack: true });
        await this.setStateAsync("solarwind.density", { val: fetchedValues.solarwind_density || 0, ack: true });
        await this.setStateAsync("solarwind.temperature", { val: fetchedValues.solarwind_temperature || 0, ack: true });
        await this.setStateAsync("solarwind.flow_angle", { val: fetchedValues.solarwind_flow_angle || 0, ack: true }); 
        await this.setStateAsync("solarwind.proton_flux", { val: fetchedValues.solarwind_proton_flux || 0, ack: true }); 

        // Magnetic Field
        await this.setStateAsync("magnetosphere.bx", { val: fetchedValues.magnetosphere_bx || 0, ack: true });
        await this.setStateAsync("magnetosphere.by", { val: fetchedValues.magnetosphere_by || 0, ack: true });
        await this.setStateAsync("magnetosphere.bz", { val: fetchedValues.magnetosphere_bz || 0, ack: true });
        await this.setStateAsync("magnetosphere.bt", { val: fetchedValues.magnetosphere_bt || 0, ack: true });
        
        // E-Field
        await this.setStateAsync("electric_field.e_field", { val: fetchedValues.electric_field_e_field || 0, ack: true });

        // Solar Activity & Disturbance
        await this.setStateAsync("solar_activity.f107_radio_flux", { val: fetchedValues.f107_radio_flux || 0, ack: true });
        await this.setStateAsync("solar_activity.sunspot_number", { val: fetchedValues.solar_activity_sunspot_number || 0, ack: true });
        await this.setStateAsync("solar_activity.xray_flux", { val: fetchedValues.xray_flux || 0, ack: true });
        
        // Flare Probabilities
        await this.setStateAsync("solar_activity.m_flare_prob", { val: fetchedValues.m_flare_prob || 0, ack: true });
        await this.setStateAsync("solar_activity.x_flare_prob", { val: fetchedValues.x_flare_prob || 0, ack: true });

        await this.setStateAsync("geomagnetic_disturbance.dst_index", { val: fetchedValues.dst_index || 0, ack: true });
        
        // G-Storm Risk
        await this.setStateAsync("geomagnetic_disturbance.g_storm_risk", { val: fetchedValues.g_storm_risk || 'G0 (None)', ack: true });

        // Erdbeben-Daten
        await this.setStateAsync("earthquake.latest.magnitude", { val: fetchedValues.earthquake_latest_magnitude || 0, ack: true });
        await this.setStateAsync("earthquake.latest.place", { val: fetchedValues.earthquake_latest_place || "", ack: true });
        await this.setStateAsync("earthquake.latest.time", { val: fetchedValues.earthquake_latest_time || "", ack: true });
        await this.setStateAsync("earthquake.latest.url", { val: fetchedValues.earthquake_latest_url || "", ack: true });

        
        this.log.info("Weltraumwetter- und Erdbebendaten erfolgreich aktualisiert.");
    }

    /**
     * Is called when adapter shuts down - Node process is stopped
     */
    onUnload(callback) {
        try {
            if (this.timer) {
                clearInterval(this.timer);
                this.timer = null;
            }
            this.log.info("Alles aufgeräumt...");
            callback();
        } catch (e) {
            callback();
        }
    }
}

// @ts-ignore parent is defined in iobroker adapter template
if (module.parent) {
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new SpaceWeatherAdapter(options);
} else {
    new SpaceWeatherAdapter();
}
