import { log } from "../utils/log.js";
import { z } from "zod";
/**
 * Register all Emporia tools with the MCP server.
 */
export function registerEmporiaTools(server, apiService) {
    // Register listDevices tool
    server.tool("listDevices", {}, async () => {
        try {
            const result = await apiService.listDevices();
            // Device type summary
            const deviceTypes = result.devices.reduce((acc, device) => {
                const type = device.type || "unknown";
                acc[type] = (acc[type] || 0) + 1;
                return acc;
            }, {});
            // LLM-friendly output using the API's summary
            return {
                content: [
                    {
                        type: "text",
                        text: `Customer: ${result.customerInfo.email}${result.customerInfo.name ? ` (${result.customerInfo.name})` : ""}`,
                    },
                    {
                        type: "text",
                        text: `Found ${result.deviceCount} devices. Types: ${Object.entries(deviceTypes)
                            .map(([type, count]) => `${type}: ${count}`)
                            .join(", ")}`,
                    },
                    {
                        type: "text",
                        text: "Device Summary:\n" + JSON.stringify(result.devices, null, 2),
                    },
                    {
                        type: "text",
                        text: "Full device data available by calling relevant 'Details' tools.",
                    },
                ],
            };
        }
        catch (error) {
            log("Error in listDevices tool", { error: String(error) });
            console.error("Error in listDevices tool:", error);
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // Register getDevicesChannels tool
    server.tool("getDevicesChannels", {}, async () => {
        try {
            const result = await apiService.getDevicesChannels();
            // Create a formatted summary of device channels
            const channelSummary = result.deviceSummaries.map((device) => {
                return {
                    deviceId: device.deviceGid,
                    channelCounts: device.channelCounts,
                    availableChannels: device.channelInfo
                        .filter((c) => c.hasData)
                        .map((c) => ({
                        name: c.name,
                        channelNum: c.channelNum,
                        type: c.type,
                    })),
                };
            });
            return {
                content: [
                    {
                        type: "text",
                        text: `Retrieved channel data for ${result.deviceCount} device(s).`,
                    },
                    {
                        type: "text",
                        text: "Channel Summary:\n" + JSON.stringify(channelSummary, null, 2),
                    },
                    {
                        type: "text",
                        text: "This data shows all available circuits/channels for each device, indicating which have data and circuit relationships. You can use the channel numbers as circuit_ids in the energy monitor API calls.",
                    },
                ],
            };
        }
        catch (error) {
            log("Error in getDevicesChannels tool", { error: String(error) });
            console.error("Error in getDevicesChannels tool:", error);
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // Register getDeviceDetails tool (replaces all get____Details tools)
    server.tool("getDeviceDetails", {
        manufacturerIds: z.array(z.string()).describe("Array of device manufacturer IDs (serial numbers) to fetch details for"),
    }, async (params) => {
        try {
            const result = await apiService.getDeviceDetails(params.manufacturerIds);
            // Format the response for each device type
            const content = Object.entries(result).map(([type, { data }]) => ({
                type: "text",
                text: `Retrieved ${type} details for ${data.success?.length || 0} device(s). ` +
                    (data.error?.length ? `Failed for ${data.error.length} device(s).` : ""),
            }));
            return {
                content: [
                    ...content,
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            log("Error in getDeviceDetails tool", { error: String(error) });
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // Add tool for Battery State of Charge
    server.tool("getBatteryStateOfCharge", {
        device_ids: z
            .array(z.string())
            .describe("Array of device serial numbers (manufacturer IDs) to fetch state of charge data for. This tool is specifically for Home Battery systems/devices only, not for EVSE/Electric Vehicle battery information."),
        start: z.string().describe("Start timestamp in ISO format (e.g. 2024-05-14T00:00:00Z)"),
        end: z.string().describe("End timestamp in ISO format (e.g. 2024-05-14T23:59:59Z)"),
        state_of_charge_resolution: z.enum(["MINUTES", "HOURS", "DAYS"]).describe("Time resolution for state of charge data"),
    }, async (params) => {
        try {
            const result = await apiService.getBatteryStateOfCharge(params);
            return {
                content: [
                    {
                        type: "text",
                        text: `Retrieved state of charge data for ${result.stateOfChargeData.success?.length || 0} Battery device(s)` +
                            ` from ${result.start} to ${result.end} with ${result.state_of_charge_resolution} resolution.`,
                    },
                    {
                        type: "text",
                        text: "Note: Battery state of charge data shows the percentage level of the battery system over time, useful for analyzing charging and discharging patterns.",
                    },
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            log("Error in getBatteryStateOfCharge tool", { error: String(error) });
            console.error("Error in getBatteryStateOfCharge tool:", error);
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // Add tool for EV Charging Report
    server.tool("getEVChargingReport", {
        device_id: z.string().describe("Device serial number (manufacturer ID) of the EV charger to fetch charging report for"),
        start: z.string().describe("Start timestamp in ISO format (e.g. 2024-05-14T00:00:00Z)"),
        end: z.string().describe("End timestamp in ISO format (e.g. 2024-05-14T23:59:59Z)"),
    }, async (params) => {
        try {
            const result = await apiService.getEVChargingReport(params);
            return {
                content: [
                    {
                        type: "text",
                        text: `Retrieved EV charging report for device ${result.device_id}` + ` from ${result.start} to ${result.end}.`,
                    },
                    {
                        type: "text",
                        text: "Note: The EV charging report provides detailed information about charging sessions, including energy usage, costs, potential savings, and plug-in/charging patterns.",
                    },
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            log("Error in getEVChargingReport tool", { error: String(error) });
            console.error("Error in getEVChargingReport tool:", error);
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // Add tool for EV Charger Sessions
    server.tool("getEVChargerSessions", {
        device_ids: z.array(z.string()).describe("Array of device serial numbers (manufacturer IDs) to fetch sessions for"),
        start: z.string().describe("Start timestamp in ISO format (e.g. 2024-05-14T00:00:00Z)"),
        end: z.string().describe("End timestamp in ISO format (e.g. 2024-05-14T23:59:59Z)"),
    }, async (params) => {
        try {
            const result = await apiService.getEVChargerSessions(params);
            return {
                content: [
                    {
                        type: "text",
                        text: `Retrieved EV charger sessions for ${result.device_ids.length} device(s)` + ` from ${result.start} to ${result.end}.`,
                    },
                    {
                        type: "text",
                        text: "Note: The EV charger sessions provide detailed information about plug-in and plug-out events, along with the charging sessions that occurred while the vehicle was connected.",
                    },
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            log("Error in getEVChargerSessions tool", { error: String(error) });
            console.error("Error in getEVChargerSessions tool:", error);
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    server.tool("getDevicePowerUsage", {
        device_ids: z
            .array(z.string())
            .describe("Array of device serial numbers (manufacturer IDs) to fetch power usage data for - NOTE: _*Not*_ 'device_gid'."),
        start: z.string().describe("Start timestamp in ISO format (e.g. 2024-05-14T00:00:00Z)"),
        end: z.string().describe("End timestamp in ISO format (e.g. 2024-05-14T23:59:59Z)"),
        power_resolution: z.enum(["MINUTES", "FIFTEEN_MINUTES"]).describe("Time resolution for power data (MINUTES or FIFTEEN_MINUTES)"),
        circuit_ids: z.array(z.string()).describe("Array of circuit IDs to fetch usage data for."),
    }, async (params) => {
        try {
            const result = await apiService.getDevicePowerUsage(params);
            // Format the response for each device type
            const content = Object.entries(result).map(([type, { device_ids, powerData }]) => ({
                type: "text",
                text: `Retrieved power usage data for ${type} device(s): ${device_ids.join(", ")}. ` +
                    (powerData.success ? `Success count: ${powerData.success.length}` : "") +
                    (powerData.error && powerData.error.length ? `, Failed: ${powerData.error.length}` : ""),
            }));
            return {
                content: [
                    ...content,
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            log("Error in getDevicePowerUsage tool", { error: String(error) });
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    server.tool("getDeviceEnergyUsage", {
        device_ids: z
            .array(z.string())
            .describe("Array of device serial numbers (manufacturer IDs) to fetch energy usage data for - NOTE: _*Not*_ 'device_gid'."),
        start: z.string().describe("Start timestamp in ISO format (e.g. 2024-05-14T00:00:00Z)"),
        end: z.string().describe("End timestamp in ISO format (e.g. 2024-05-14T23:59:59Z)"),
        energy_resolution: z
            .enum(["MINUTES", "FIFTEEN_MINUTES", "HOURS", "DAYS", "WEEKS", "MONTHS", "YEARS"])
            .describe("Time resolution for energy data"),
        circuit_ids: z.array(z.string()).describe("Array of circuit IDs to fetch usage data for."),
    }, async (params) => {
        try {
            const result = await apiService.getDeviceEnergyUsage(params);
            // Format the response for each device type
            const content = Object.entries(result).map(([type, { device_ids, energyData }]) => ({
                type: "text",
                text: `Retrieved energy usage data for ${type} device(s): ${device_ids.join(", ")}. ` +
                    (energyData.success ? `Success count: ${energyData.success.length}` : "") +
                    (energyData.error && energyData.error.length ? `, Failed: ${energyData.error.length}` : ""),
            }));
            return {
                content: [
                    ...content,
                    {
                        type: "text",
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            log("Error in getDeviceEnergyUsage tool", { error: String(error) });
            return {
                content: [
                    {
                        type: "text",
                        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
}
