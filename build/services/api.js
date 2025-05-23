import { log } from "../utils/log.js";
import { DEVICE_TYPE_CONFIGS, DEVICE_TYPE_CONFIGS_BY_TYPE } from "../constants/deviceTypes.js";
function getDeviceTypeFromId(id) {
    if (!id) {
        return null;
    }
    const upperId = id.toUpperCase();
    if (upperId.startsWith("XXXX")) {
        return "vue1";
    }
    const firstChar = upperId.charAt(0);
    for (const config of DEVICE_TYPE_CONFIGS) {
        if (config.firstChars.includes(firstChar)) {
            return config.type;
        }
    }
    return null;
}
function groupDeviceIdsByType(manufacturerIds) {
    const deviceGroups = {};
    for (const id of manufacturerIds) {
        const deviceType = getDeviceTypeFromId(id);
        if (!deviceType) {
            throw new Error(`Invalid device ID format: ${id}. First character must be one of: ` +
                Object.values(DEVICE_TYPE_CONFIGS)
                    .map((cfg) => cfg.firstChars.join(", "))
                    .join(" | "));
        }
        if (!deviceGroups[deviceType]) {
            deviceGroups[deviceType] = [];
        }
        deviceGroups[deviceType].push(id);
    }
    return deviceGroups;
}
/**
 * Service for handling Emporia API calls.
 */
export class EmporiaApiService {
    authService;
    constructor(authService) {
        this.authService = authService;
    }
    /**
     * List all devices for the current user.
     */
    async listDevices() {
        try {
            const data = await this.authService.getLegacy("/customers/devices");
            // Format the response to include more context
            return {
                customerInfo: {
                    customerGid: data.customerGid,
                    email: data.email,
                    name: data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : null,
                    createdAt: data.createdAt,
                },
                deviceCount: data.devices.length,
                devices: data.devices.map((device) => ({
                    id: device.deviceGid,
                    manufacturerDeviceId: device.manufacturerDeviceId,
                    model: device.model,
                    firmwareVersion: device.firmware,
                    name: device.locationProperties.displayName,
                    connected: device.deviceConnected.connected,
                    offlineSince: device.deviceConnected.offlineSince,
                    type: device.evCharger ? "EV Charger" : device.outlet ? "Smart Plug" : device.battery ? "Battery" : "Vue Monitor",
                    locationProperties: device.locationProperties,
                    deviceDetails: {
                        evCharger: device.evCharger,
                        smartPlug: device.outlet,
                        battery: device.battery,
                    },
                })),
            };
        }
        catch (error) {
            log("Error fetching devices", { error: String(error) }, "error", "API");
            throw error;
        }
    }
    /**
     * Generic device details fetcher by manufacturer ID(s).
     */
    async getDeviceDetails(manufacturerIds) {
        const deviceGroups = groupDeviceIdsByType(manufacturerIds);
        try {
            // Fetch details for each group.
            const results = await Promise.all(Object.entries(deviceGroups).map(async ([type, ids]) => {
                const config = DEVICE_TYPE_CONFIGS_BY_TYPE[type];
                const parameters = {
                    device_ids: ids.join(","),
                };
                const endpoint = `/v1/devices/${config.endpoint}`;
                const data = await this.authService.get(endpoint, { parameters });
                return [
                    type,
                    {
                        manufacturerIds: ids,
                        data,
                    },
                ];
            }));
            // Combine results by type.
            return Object.fromEntries(results);
        }
        catch (error) {
            log("Error fetching device details", {
                error: String(error),
                manufacturerIds,
                stack: error instanceof Error ? error.stack : undefined,
            }, "error", "API");
            throw error;
        }
    }
    /**
     * Get devices and their channels data.
     *
     * This endpoint provides detailed information about device channels, including
     * main and branch circuits, which is useful for energy monitoring applications.
     */
    async getDevicesChannels() {
        try {
            const endpoint = "/v1/customers/devices/channels";
            const data = await this.authService.get(endpoint);
            // Log information about the response structure
            log("Device channels response structure", {
                itemCount: data.length,
                sampleItem: data.length > 0
                    ? {
                        keys: Object.keys(data[0]),
                        hasChannels: !!data[0].channels,
                    }
                    : null,
            }, "debug", "API");
            // Reduce to summaries because the data can sometimes be too big or confusing for LLM.
            const deviceSummaries = data.map((device) => {
                const deviceGid = device.device_gid;
                const channels = device.channels ?? [];
                // Count different channel types
                const channelCounts = {
                    mainBranch: 0,
                    combined: 0,
                    merged: 0,
                    withData: 0,
                    total: channels.length,
                };
                for (const channel of channels) {
                    if (channel.mainBranchCircuit) {
                        channelCounts.mainBranch++;
                    }
                    if (channel.combined) {
                        channelCounts.combined++;
                    }
                    if (channel.mergedBranch) {
                        channelCounts.merged++;
                    }
                    if (channel.hasData) {
                        channelCounts.withData++;
                    }
                }
                return {
                    description: '"Channels" list will provide the main and branch circuits for each device. Important to note that "Mains" represent a combined circuit of the primary service lines and each individual circuit will have "parent_channel_id" of "Mains". This is not to be confused with branch circuits that have a "channel_num" of 1, 2, or 3 - instead you can compare the "channel_id" to see "branch_XYZ". This detail is important as other API endpoints may return individual channel id\'s that might not be in the same format (and possible that channels 1, 2, 3 as ids would actually represent mains instead of branches in those other endpoints).',
                    deviceGid,
                    channelCounts,
                    // Include channel info for reference
                    channelInfo: channels.map((c) => ({
                        name: c.name || "Unnamed channel",
                        channelNum: c.channelNum || "unknown",
                        hasData: c.hasData ?? false,
                        type: c.type || "unknown",
                    })),
                };
            });
            return {
                deviceCount: deviceSummaries.length,
                deviceSummaries,
            };
        }
        catch (error) {
            log("Error fetching device channels", { error: String(error) }, "error", "API");
            throw error;
        }
    }
    /**
     * Get battery state of charge for specified devices.
     */
    async getBatteryStateOfCharge(params) {
        try {
            const { device_ids, start, end, state_of_charge_resolution } = params;
            const parameters = {
                device_ids: device_ids.join(","),
                start,
                end,
                state_of_charge_resolution,
            };
            const endpoint = "/v1/devices/batteries/state-of-charge";
            const data = await this.authService.get(endpoint, { parameters });
            return {
                device_ids,
                start,
                end,
                state_of_charge_resolution,
                stateOfChargeData: data,
            };
        }
        catch (error) {
            log("Error fetching Battery state of charge", { error: String(error), params }, "error", "API");
            throw error;
        }
    }
    /**
     * Get EV charging report for specified devices.
     */
    async getEVChargingReport(params) {
        try {
            const { device_id, start, end } = params;
            const parameters = {
                device_id,
                start,
                end,
            };
            const endpoint = "/v1/customers/ev-charging-report";
            const data = await this.authService.get(endpoint, { parameters });
            return {
                device_id,
                start,
                end,
                reportData: data,
            };
        }
        catch (error) {
            log("Error fetching EV charging report", { error: String(error), params }, "error", "API");
            throw error;
        }
    }
    /**
     * Get EVSE sessions for specified devices.
     */
    async getEVChargerSessions(params) {
        try {
            const { device_ids, start, end } = params;
            const parameters = {
                device_ids: device_ids.join(","),
                start: start,
                end: end,
            };
            const endpoint = "/v1/devices/evses/sessions";
            const data = await this.authService.get(endpoint, { parameters });
            return {
                device_ids,
                start,
                end,
                sessionsData: data,
            };
        }
        catch (error) {
            log("Error fetching EVSE sessions", { error: String(error), params }, "error", "API");
            throw error;
        }
    }
    /**
     * Generic device power usage fetcher by manufacturer ID(s).
     */
    async getDevicePowerUsage(params) {
        const { device_ids, start, end, power_resolution, circuit_ids } = params;
        const deviceGroups = groupDeviceIdsByType(device_ids);
        // Validation: If any device is an energy monitor, circuit_ids must be provided and non-empty
        const energyMonitorTypes = ["vue1", "vue2", "vue3", "vueutility"];
        const hasEnergyMonitor = Object.keys(deviceGroups).some((type) => energyMonitorTypes.includes(type));
        if (hasEnergyMonitor && (!circuit_ids || circuit_ids.length === 0)) {
            throw new Error(`circuit_ids is required and must be non-empty when querying power usage for energy monitor devices (${energyMonitorTypes.join(", ")}).`);
        }
        const DEVICE_POWER_USAGE_ENDPOINTS = {
            evse: "evses/usages/power",
            smartplug: "outlets/usages/power",
            battery: "batteries/usages/power",
            vue1: "energy-monitors/circuits/usages/power",
            vue2: "energy-monitors/circuits/usages/power",
            vue3: "energy-monitors/circuits/usages/power",
            vueutility: "energy-monitors/circuits/usages/power",
        };
        try {
            // Fetch power usage for each group
            const results = await Promise.all(Object.entries(deviceGroups).map(async ([type, ids]) => {
                const deviceType = type;
                const isEnergyMonitor = deviceType.startsWith("vue");
                const endpointPath = DEVICE_POWER_USAGE_ENDPOINTS[deviceType];
                const parameters = {
                    device_ids: ids.join(","),
                    start,
                    end,
                    power_resolution,
                };
                if (isEnergyMonitor && circuit_ids && circuit_ids.length > 0) {
                    parameters.circuit_ids = circuit_ids.join(",");
                }
                const endpoint = `/v1/devices/${endpointPath}`;
                const data = await this.authService.get(endpoint, { parameters });
                console.error(data);
                return [
                    type,
                    {
                        device_ids: ids,
                        powerData: data,
                    },
                ];
            }));
            return Object.fromEntries(results);
        }
        catch (error) {
            log("Error fetching device power usage", {
                error: String(error),
                params,
                stack: error instanceof Error ? error.stack : undefined,
            }, "error", "API");
            throw error;
        }
    }
    async getDeviceEnergyUsage(params) {
        const { device_ids, start, end, energy_resolution, circuit_ids } = params;
        const deviceGroups = groupDeviceIdsByType(device_ids);
        // Validation: If any device is an energy monitor, circuit_ids must be provided and non-empty
        const energyMonitorTypes = ["vue1", "vue2", "vue3", "vueutility"];
        const hasEnergyMonitor = Object.keys(deviceGroups).some((type) => energyMonitorTypes.includes(type));
        if (hasEnergyMonitor && (!circuit_ids || circuit_ids.length === 0)) {
            throw new Error(`circuit_ids is required and must be non-empty when querying power usage for energy monitor devices (${energyMonitorTypes.join(", ")}).`);
        }
        // Map device type to energy usage endpoint
        const DEVICE_ENERGY_USAGE_ENDPOINTS = {
            evse: "evses/usages/energy",
            smartplug: "outlets/usages/energy",
            battery: "batteries/usages/energy",
            vue1: "energy-monitors/circuits/usages/energy",
            vue2: "energy-monitors/circuits/usages/energy",
            vue3: "energy-monitors/circuits/usages/energy",
            vueutility: "energy-monitors/circuits/usages/energy",
        };
        try {
            // Fetch energy usage for each group
            const results = await Promise.all(Object.entries(deviceGroups).map(async ([type, ids]) => {
                const deviceType = type;
                const isEnergyMonitor = deviceType.startsWith("vue");
                const endpointPath = DEVICE_ENERGY_USAGE_ENDPOINTS[deviceType];
                const parameters = {
                    device_ids: ids.join(","),
                    start,
                    end,
                    energy_resolution,
                };
                if (isEnergyMonitor && circuit_ids && circuit_ids.length > 0) {
                    parameters.circuit_ids = circuit_ids.join(",");
                }
                const endpoint = `/v1/devices/${endpointPath}`;
                const data = await this.authService.get(endpoint, { parameters });
                return [
                    type,
                    {
                        device_ids: ids,
                        energyData: data,
                    },
                ];
            }));
            return Object.fromEntries(results);
        }
        catch (error) {
            log("Error fetching device energy usage", {
                error: String(error),
                params,
                stack: error instanceof Error ? error.stack : undefined,
            }, "error", "API");
            throw error;
        }
    }
}
