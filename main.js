"use strict";

const utils = require("@iobroker/adapter-core");
const axios = require("axios");

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

    async onReady() {
        this.log.info("SpaceWeather Adapter gestartet");
        await this.ensureObjects(); // Erstellt die Datenpunkte
        await this.fetchData(); // Initialer Abruf
        // Update alle 5 Minuten
        this.timer = setInterval(() => this.fetchData(), 5 * 60 * 1000);
    }

    async ensureObjects() {
        const states = {
            "solarwind.speed": { name: "Solarwind Geschwindigkeit", unit: "km/s" },
            "solarwind.flow_angle": { name: "Sonnenwind Flusswinkel", unit: "°" },
            "solarwind.proton_flux": { name: "Protonenfluss", unit: "pfu" },
            "solarwind.density": { name: "Solarwind Dichte", unit: "cm^-3" },
            "solarwind.temperature": { name: "Solarwind Temperatur", unit: "K" },
            "magnetosphere.bx": { name: "Magnetfeld Bx", unit: "nT" },
            "magnetosphere.by": { name: "Magnetfeld By", unit: "nT" },
            "magnetosphere.bz": { name: "Magnetfeld Bz", unit: "nT" },
            "magnetosphere.bt": { name: "Magnetfeld Bt", unit: "nT" }
        };

        for (const [id, meta] of Object.entries(states)) {
            await this.setObjectNotExistsAsync(id, {
                type: "state",
                common: {
                    name: meta.name,
                    type: "number",
                    role: "value",
                    unit: meta.unit,
                    read: true,
                    write: false
                },
                native: {}
            });
        }
    }

    async fetchData() {
        try {
            const url = "https://services.swpc.noaa.gov/json/solar-wind.json";
            const response = await axios.get(url);

            const latest = response.data[response.data.length - 1];
            if (!latest) {
                this.log.warn("Keine Daten im Feed gefunden");
                return;
            }

            // --- Solarwind ---
            await this.setStateAsync("solarwind.speed", { val: parseFloat(latest.speed || 0), ack: true });
            await this.setStateAsync("solarwind.flow_angle", { val: parseFloat(latest.flow_angle || 0), ack: true });
            await this.setStateAsync("solarwind.proton_flux", { val: parseFloat(latest.proton_flux || 0), ack: true });
            await this.setStateAsync("solarwind.density", { val: parseFloat(latest.density || 0), ack: true });
            await this.setStateAsync("solarwind.temperature", { val: parseFloat(latest.temperature || 0), ack: true });

            // --- Magnetfeld ---
            await this.setStateAsync("magnetosphere.bx", { val: parseFloat(latest.bx_gsm || 0), ack: true });
            await this.setStateAsync("magnetosphere.by", { val: parseFloat(latest.by_gsm || 0), ack: true });
            await this.setStateAsync("magnetosphere.bz", { val: parseFloat(latest.bz_gsm || 0), ack: true });
            await this.setStateAsync("magnetosphere.bt", { val: parseFloat(latest.bt || 0), ack: true });

            this.log.info("SpaceWeather-Daten erfolgreich aktualisiert");

        } catch (error) {
            this.log.error("Fehler beim Abruf der SpaceWeather-Daten: " + error.message);
        }
    }

    onUnload(callback) {
        try {
            if (this.timer) clearInterval(this.timer);
            this.log.info("SpaceWeather Adapter gestoppt");
            callback();
        } catch (e) {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = (options) => new SpaceWeatherAdapter(options);
} else {
    new SpaceWeatherAdapter();
}
