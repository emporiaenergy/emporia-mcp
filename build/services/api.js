import { EMPORIA_LEGACY_API_ORIGIN, EMPORIA_API_ORIGIN, USER_AGENT } from "../config.js";
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
/**
 * Split device ids by whether the per-type detail/usage tools can route them to
 * an endpoint. Routing is decided solely by the serial-to-type inference these
 * tools already rely on (getDeviceTypeFromId) — ids it can't classify (e.g. the
 * third-party "THERMOSTAT_20072" form) are separated out so callers can process
 * the rest instead of failing the whole batch. This is not extra validation:
 * ids that classify are still sent to the cloud, which remains the authority on
 * whether they're actually valid.
 */
export function partitionSupportedDeviceIds(ids) {
    const supported = [];
    const unsupported = [];
    for (const id of ids) {
        if (getDeviceTypeFromId(id)) {
            supported.push(id);
        }
        else {
            unsupported.push(id);
        }
    }
    return { supported, unsupported };
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
export class EmporiaApiService {
    /** Cognito auth service used to get auth tokens when the MCP server is running locally (STDIO) */
    authService;
    constructor(authService) {
        this.authService = authService;
    }
    /**
     * List all devices for the current user.
     *
     * Uses the modern, site-aware cloud endpoint GET /v1/customers/devices. This
     * replaces the legacy GET /customers/devices, which predates the "sites"
     * concept and does not return devices that belong to a site (yielding an
     * empty list for customers whose devices are all site-assigned). Customer
     * info is fetched separately from GET /v1/customers, since the modern devices
     * response no longer includes it.
     *
     * @param siteGid Optional site filter; when provided, only devices belonging to that site are returned.
     */
    async listDevices(authToken, siteGid) {
        try {
            const parameters = siteGid !== undefined ? { site_gid: String(siteGid) } : undefined;
            // Fetch devices (site-aware) and customer info in parallel. Customer info
            // is best-effort: a failure there should not prevent returning devices.
            const [devicesData, customer] = await Promise.all([
                this.get("/v1/customers/devices", authToken, false, { parameters }),
                this.get("/v1/customers", authToken, false).catch((error) => {
                    log("Error fetching customer info (continuing without it)", { error: String(error) }, "info", "API");
                    return null;
                }),
            ]);
            const devices = devicesData.devices ?? [];
            const name = customer && customer.first_name && customer.last_name ? `${customer.first_name} ${customer.last_name}` : null;
            return {
                customerInfo: {
                    customerGid: customer?.customer_gid ?? null,
                    email: customer?.email ?? null,
                    name,
                    createdAt: customer?.created_at ?? null,
                },
                deviceCount: devices.length,
                devices,
            };
        }
        catch (error) {
            log("Error fetching devices", { error: String(error) }, "error", "API");
            throw error;
        }
    }
    /**
     * List all sites associated with the current user.
     *
     * A site bundles devices (0, one, or many) into a single grouping, and a
     * customer may have multiple sites. Backed by GET /v1/customers/sites.
     */
    async listSites(authToken) {
        try {
            const data = await this.get("/v1/customers/sites", authToken, false);
            return { sites: data.sites ?? [] };
        }
        catch (error) {
            log("Error fetching sites", { error: String(error) }, "error", "API");
            throw error;
        }
    }
    /**
     * Get live status for the current user's devices, backed by
     * GET /v1/customers/devices/status.
     *
     * With no filters, only Emporia device statuses are returned. Third-party
     * device statuses (thermostats, appliances, vehicles) are fetched on demand
     * from the vendor and are only included when explicitly requested via
     * device_ids. A site_gid filter is ignored when device_ids is provided.
     */
    async getDeviceStatus(authToken, params) {
        try {
            const parameters = {};
            if (params.device_ids && params.device_ids.length > 0) {
                parameters.device_ids = params.device_ids.join(",");
            }
            if (params.site_gid !== undefined) {
                parameters.site_gid = String(params.site_gid);
            }
            const hasParams = Object.keys(parameters).length > 0;
            return await this.get("/v1/customers/devices/status", authToken, false, {
                parameters: hasParams ? parameters : undefined,
            });
        }
        catch (error) {
            log("Error fetching device status", { error: String(error), params }, "error", "API");
            throw error;
        }
    }
    /**
     * Generic device details fetcher by manufacturer ID(s).
     */
    async getDeviceDetails(authToken, manufacturerIds) {
        const deviceGroups = groupDeviceIdsByType(manufacturerIds);
        try {
            // Fetch details for each group.
            const results = await Promise.all(Object.entries(deviceGroups).map(async ([type, ids]) => {
                const config = DEVICE_TYPE_CONFIGS_BY_TYPE[type];
                const parameters = {
                    device_ids: ids.join(","),
                };
                const endpoint = `/v1/devices/${config.endpoint}`;
                const data = await this.get(endpoint, authToken, false, { parameters });
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
    async getDevicesChannels(authToken) {
        try {
            const channelsEndpoint = "/v1/customers/devices/channels";
            const channelsData = await this.get(channelsEndpoint, authToken, false);
            // Log information about the response structure
            log("Device channels response structure", {
                itemCount: channelsData.length,
                sampleItem: channelsData.length > 0
                    ? {
                        keys: Object.keys(channelsData[0]),
                        hasChannels: !!channelsData[0].channels,
                    }
                    : null,
            }, "debug", "API");
            // Flatten nested devices to make it easier for LLMs to understand
            const devices = this.flattenDeviceChannelsItems(channelsData, null);
            // Reduce to summaries because the data can sometimes be too big or confusing for LLM.
            const deviceSummaries = devices.map((device) => {
                const deviceGid = device.device_gid;
                const deviceId = device.device_id;
                const parentDeviceId = device.parent_device_id;
                const channels = device.channels ?? [];
                // Count different channel types
                const channelCounts = {
                    mains: 0,
                    branch: 0,
                    merged: 0,
                    total: channels.length,
                };
                for (const channel of channels) {
                    if (channel.channel_id.startsWith("Main")) {
                        channelCounts.mains++;
                    }
                    else if (channel.channel_id.startsWith("Branch")) {
                        channelCounts.branch++;
                    }
                    else if (channel.channel_id.startsWith("Merged")) {
                        channelCounts.merged++;
                    }
                }
                return {
                    description: '"Channels" list will provide the main and branch circuits for each device. Important to note that "Mains" represent a combined circuit of the primary service lines and each individual circuit will have "parent_channel_id" of "Mains". This is not to be confused with branch circuits that have a "channel_num" of 1, 2, or 3 - instead you can compare the "channel_id" to see "branch_XYZ". This detail is important as other API endpoints may return individual channel id\'s that might not be in the same format (and possible that channels 1, 2, 3 as ids would actually represent mains instead of branches in those other endpoints).',
                    deviceGid,
                    deviceId,
                    parentDeviceId,
                    channelCounts,
                    // Include channel info for reference
                    channelInfo: channels.map((c) => ({
                        name: c.display_name || "Channel " + c.channel_num.replace("_", " "),
                        channelId: c.channel_id,
                        channelNum: c.channel_num,
                        type: c.sub_type || "unknown",
                        // The combined "Mains" channel aggregates Mains_A/B/C and is NOT accepted as a
                        // circuit_id by the energy/power usage tools; the split legs and branches are.
                        usableAsCircuitId: c.channel_id !== "Mains",
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
    /** Recursively flatten a device channels response to prevent returning a deeply nested structure to LLMs */
    flattenDeviceChannelsItems(devices, parentDeviceId) {
        const flattenedDevices = [];
        for (const device of devices) {
            const channels = [];
            for (const channel of device.channels) {
                if (channel.nested_devices?.length && channel.nested_devices.length > 0) {
                    const flattenedNestedDevices = this.flattenDeviceChannelsItems(channel.nested_devices, device.device_id);
                    flattenedDevices.push(...flattenedNestedDevices);
                }
                channel.nested_devices = [];
                channels.push(channel);
            }
            if (parentDeviceId !== null) {
                device.parent_device_id = parentDeviceId;
            }
            device.channels = channels;
            flattenedDevices.push(device);
        }
        return flattenedDevices;
    }
    /**
     * Get battery state of charge for specified devices.
     */
    async getBatteryStateOfCharge(authToken, params) {
        try {
            const { device_ids, start, end, state_of_charge_resolution } = params;
            const parameters = {
                device_ids: device_ids.join(","),
                start,
                end,
                state_of_charge_resolution,
            };
            const endpoint = "/v1/devices/batteries/state-of-charge";
            const data = await this.get(endpoint, authToken, false, { parameters });
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
    async getEVChargingReport(authToken, params) {
        try {
            const { device_id, start, end } = params;
            const parameters = {
                device_id,
                start,
                end,
            };
            const endpoint = "/v1/customers/ev-charging-report";
            return await this.get(endpoint, authToken, false, { parameters });
        }
        catch (error) {
            log("Error fetching EV charging report", { error: String(error), params }, "error", "API");
            throw error;
        }
    }
    /**
     * Get EVSE sessions for specified devices.
     */
    async getEVChargerSessions(authToken, params) {
        try {
            const { device_ids, start, end } = params;
            const parameters = {
                device_ids: device_ids.join(","),
                start: start,
                end: end,
            };
            const endpoint = "/v1/devices/evses/sessions";
            const data = await this.get(endpoint, authToken, false, { parameters });
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
    async getDevicePowerUsage(authToken, params) {
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
                const data = await this.get(endpoint, authToken, false, { parameters });
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
    async getDeviceEnergyUsage(authToken, params) {
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
                const data = await this.get(endpoint, authToken, false, { parameters });
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
    /**
     * Makes a get request to legacy api.
     * @param path The path for the url.
     * @param authToken The token used to authenticate the request (remote MCP only)
     * @param legacy Indicates if the request should be sent to the legacy API
     * @param args An optional object defining the headers and query parameters
     */
    async get(path, authToken, legacy, args) {
        args ??= {};
        const headers = args?.headers ?? {};
        let apiOrigin;
        // Get auth token from Cognito when running the MCP server locally
        if (authToken === undefined) {
            if (this.authService === null) {
                throw Error("Missing authorization token");
            }
            const { idToken } = await this.authService.getToken();
            authToken = idToken;
        }
        if (legacy) {
            apiOrigin = EMPORIA_LEGACY_API_ORIGIN;
            headers.AuthToken = authToken;
        }
        else {
            apiOrigin = EMPORIA_API_ORIGIN;
            headers.Authorization = authToken;
        }
        return this.send("GET", apiOrigin + path, {
            headers,
            parameters: args.parameters,
        });
    }
    async send(method, fullPath, args) {
        const url = escapeUrl(fullPath, args.parameters);
        const headers = args.headers;
        headers["User-Agent"] ??= USER_AGENT;
        headers.Accept ??= "application/json";
        let response;
        try {
            response = await fetch(url, {
                method,
                headers,
                body: args.body,
            });
        }
        catch (error) {
            log("Error making request", {
                url,
                error: String(error),
                stack: error instanceof Error ? error.stack : undefined,
            }, "error", "AUTH");
            throw error;
        }
        const text = await response.text();
        // Surface non-success HTTP statuses as errors. Without this, an error body
        // (e.g. 401/403/429/5xx) would be JSON-parsed and returned as if it were a
        // successful payload — which, for list endpoints, silently degrades into an
        // empty list rather than a clear failure.
        if (!response.ok) {
            const snippet = text.length > 500 ? `${text.slice(0, 500)}…` : text;
            log("Request failed with non-success status", { url, status: response.status, statusText: response.statusText, body: text }, "error", "API");
            throw new Error(`Emporia API request failed (${response.status} ${response.statusText})${snippet ? `: ${snippet}` : ""}`);
        }
        let json;
        try {
            json = JSON.parse(text);
        }
        catch (error) {
            log("Error parsing json response.", {
                url,
                error: String(error),
                stack: error instanceof Error ? error.stack : undefined,
                text,
            }, "error", "AUTH");
            throw error;
        }
        return json;
    }
}
function escapeUrl(baseUrl, parameters) {
    if (!parameters) {
        return baseUrl;
    }
    const entries = Object.entries(parameters);
    if (entries.length === 0) {
        return baseUrl;
    }
    const queryString = entries.map((p) => escapePair(p[0], p[1])).join("&");
    return `${baseUrl}?${queryString}`;
    function escapePair(key, value) {
        return !value ? key : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    }
}
