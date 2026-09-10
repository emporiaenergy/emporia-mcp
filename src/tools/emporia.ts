import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { EmporiaApiService, partitionSupportedDeviceIds } from "../services/api.js";
import {
  GetBatteryStateOfChargeParams,
  GetEVChargingReportParams,
  GetEVChargerSessionsParams,
  GetDevicePowerUsageParams,
  GetDeviceEnergyUsageParams,
} from "../types/mcp.js";
import { log } from "../utils/log.js";
import { z } from "zod";
import { CustomerDevice, GetDeviceStatusParams } from "../types/api.js";

/**
 * Register all Emporia tools with the MCP server.
 */
export function registerEmporiaTools(server: McpServer, apiService: EmporiaApiService): void {
  // Register listDevices tool
  server.tool(
    "listDevices",
    {
      site_gid: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Optional site identifier ("site" is the same feature the Emporia app calls a "Home"). When provided, only devices belonging to that site/Home are returned. Omit to return all of the customer\'s devices. Use listSites to discover site_gids.',
        ),
    },
    async (params: { site_gid?: number }, extra) => {
      try {
        const result = await apiService.listDevices(extra.authInfo?.token as string, params.site_gid);

        // Device type summary
        const deviceTypes = result.devices.reduce((acc: Record<string, number>, device) => {
          const type = device.device_type || "unknown";
          acc[type] = (acc[type] || 0) + 1;
          return acc;
        }, {});

        // How many devices are assigned to a site vs. unassigned
        const assignedToSite = result.devices.filter((d) => d.site_gid !== undefined && d.site_gid !== null).length;

        const devices = result.devices.map((d: CustomerDevice) => {
          const hasRate = d.utility_rate_gid !== undefined && d.utility_rate_gid !== null;
          return {
            // For Emporia hardware, device_id is the manufacturer id/serial expected by the
            // detail and usage tools. For third-party devices it is a prefixed gid (e.g. THERMOSTAT_82).
            device_id: d.device_id,
            device_gid: d.device_gid ?? null,
            device_type: d.device_type,
            display_name: d.display_name ?? null,
            model: d.model ?? null,
            firmware_version: d.firmware ?? null,
            site_gid: d.site_gid ?? null,
            energy_managements_configured: d.energy_managements_configured ?? [],
            utility_rate_selected: hasRate,
            usage_cents_per_kwh: hasRate ? null : (d.usage_cent_per_kw_hour ?? null),
            billing_cycle_start_day: d.billing_cycle_start_day ?? null,
            location_summary: {
              latitude: d.latitude ?? null,
              longitude: d.longitude ?? null,
              time_zone: d.time_zone ?? null,
            },
          };
        });

        // LLM-friendly output
        return {
          content: [
            {
              type: "text",
              text: result.customerInfo.email
                ? `Customer: ${result.customerInfo.email}${result.customerInfo.name ? ` (${result.customerInfo.name})` : ""}`
                : "Customer info unavailable.",
            },
            {
              type: "text",
              text:
                `Found ${result.deviceCount} device(s)${params.site_gid !== undefined ? ` for site ${params.site_gid}` : ""}. ` +
                `Types: ${
                  Object.entries(deviceTypes)
                    .map(([type, count]) => `${type}: ${count}`)
                    .join(", ") || "none"
                }. ` +
                `${assignedToSite} of these are assigned to a site (see the site_gid field; use listSites for site details).`,
            },
            {
              type: "text",
              text: "Device Summary:\n" + JSON.stringify(devices, null, 2),
            },
            {
              type: "text",
              text: "Full device data available by calling relevant 'Details' tools (Emporia hardware device types: MONITOR, EV_CHARGER, OUTLET, BATTERY). For live connection status (connected / offline_since) and current device state, call getDeviceStatus.",
            },
          ],
        };
      } catch (error: any) {
        log("Error in listDevices tool", { error: String(error) }, "error");
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
    },
  );

  // Register listSites tool
  server.tool(
    "listSites",
    'List the customer\'s sites. A "site" is the same feature the Emporia app calls a "Home" — so use this tool for requests about the customer\'s homes/sites. A site/Home groups devices under a single location, and an account can have several.',
    {
      include_members: z
        .boolean()
        .optional()
        .describe(
          "When true, include the email addresses of every customer the site is shared with. Defaults to false, which returns only the member count — a shared site can expose many other customers' emails, so only request the full list when the user specifically needs it.",
        ),
    },
    async (params: { include_members?: boolean }, extra) => {
      try {
        const result = await apiService.listSites(extra.authInfo?.token as string);

        const sites = result.sites.map((s) => {
          const memberEmails = s.customer_emails ?? [];
          return {
            site_gid: s.site_gid,
            display_name: s.display_name,
            device_count: s.device_ids?.length ?? 0,
            device_ids: s.device_ids ?? [],
            member_count: memberEmails.length,
            // Other members' emails are only included on explicit request (they are PII).
            ...(params.include_members ? { members: memberEmails } : {}),
            time_zone: s.timezone ?? null,
            utility_provider: s.utility_provider ?? null,
            utility_rate_selected: s.utility_rate_gid !== undefined && s.utility_rate_gid !== null,
            usage_cents_per_kwh: s.usage_cents_per_kwh ?? null,
            billing_cycle_start_day: s.billing_cycle_start_day ?? null,
            service_address: s.service_address ?? null,
          };
        });

        return {
          content: [
            {
              type: "text",
              text: `Found ${sites.length} site(s) (a "site" is what the Emporia app calls a "Home"). A site/Home groups devices (0, one, or many) under a single location; the device_ids listed for each site match the device_id values returned by listDevices.`,
            },
            {
              type: "text",
              text: "Site Summary:\n" + JSON.stringify(sites, null, 2),
            },
            {
              type: "text",
              text: `To list only the devices on a specific site, call listDevices with that site's site_gid.${params.include_members ? "" : " Only member counts are shown; pass include_members: true to also return the shared members' email addresses."}`,
            },
          ],
        };
      } catch (error: any) {
        log("Error in listSites tool", { error: String(error) }, "error");
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
    },
  );

  // Register getDeviceStatus tool
  server.tool(
    "getDeviceStatus",
    {
      device_ids: z
        .array(z.string())
        .optional()
        .describe(
          "Optional universal device ids to get status for (the device_id values from listDevices). If omitted, only Emporia device statuses are returned. Third-party devices (thermostats, appliances, vehicles) are only included when explicitly listed here.",
        ),
      site_gid: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Optional site identifier ("site" is the same feature the Emporia app calls a "Home"); only statuses for devices belonging to that site/Home are returned. Ignored when device_ids is provided.',
        ),
    },
    async (params: GetDeviceStatusParams, extra) => {
      try {
        const result = await apiService.getDeviceStatus(extra.authInfo?.token as string, params);

        // Per-category counts. A device appears in exactly one category array, so the
        // total is their sum. `devices_connected` is a parallel connectivity list for
        // Emporia hardware and is reported separately (third-party devices such as
        // thermostats do not appear in it).
        const categories = ["monitors", "evses", "outlets", "batteries", "thermostats", "appliances", "vehicles"] as const;
        const categoryCounts = categories.map((c) => [c, Array.isArray(result[c]) ? result[c].length : 0] as const);
        const totalDevices = categoryCounts.reduce((sum, [, n]) => sum + n, 0);

        const connections = result.devices_connected ?? [];
        const offline = connections.filter((c) => !c.connected);
        const connectivitySummary = connections.map((c) => ({
          device_id: c.device_id,
          device_gid: c.device_gid,
          connected: c.connected,
          offline_since: c.offline_since ?? null,
        }));

        const categoryBreakdown = categoryCounts
          .filter(([, n]) => n > 0)
          .map(([c, n]) => `${c}: ${n}`)
          .join(", ");

        return {
          content: [
            {
              type: "text",
              text:
                `Retrieved status for ${totalDevices} device(s)${categoryBreakdown ? ` (${categoryBreakdown})` : ""}. ` +
                `Emporia-hardware connectivity: ${connections.length - offline.length} connected, ${offline.length} offline.` +
                (result.command_acknowledged !== undefined ? ` command_acknowledged: ${result.command_acknowledged}.` : "") +
                (params.device_ids === undefined || params.device_ids.length === 0
                  ? " (Third-party devices — thermostats, appliances, vehicles — are only included when their ids are passed in device_ids.)"
                  : ""),
            },
            {
              type: "text",
              text: "Emporia-hardware connectivity:\n" + JSON.stringify(connectivitySummary, null, 2),
            },
            {
              type: "text",
              text:
                "Full status (grouped by category: monitors, evses, outlets, batteries, thermostats, appliances, vehicles) with live values such as state of charge, charging state, and on/off:\n" +
                JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error: any) {
        log("Error in getDeviceStatus tool", { error: String(error) }, "error");
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
    },
  );

  // Register getDevicesChannels tool
  server.tool("getDevicesChannels", {}, async (request, extra) => {
    try {
      const result = await apiService.getDevicesChannels(extra.authInfo?.token as string);

      // Create a formatted summary of device channels
      const channelSummary = result.deviceSummaries.map((device) => {
        return {
          deviceGid: device.deviceGid,
          manufacturerDeviceId: device.deviceId,
          parentDeviceId: device.parentDeviceId,
          channelCounts: device.channelCounts,
          availableChannels: device.channelInfo,
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
            text: 'This data shows all available circuits/channels for each device. Use a channel\'s `channelId` as a circuit_id in the energy/power usage tools ONLY when its `usableAsCircuitId` is true. The combined "Mains" channel (usableAsCircuitId: false) aggregates Mains_A/B/C and is rejected by the usage endpoints — query the individual legs (Mains_A, Mains_B, Mains_C) or branch circuits instead.',
          },
        ],
      };
    } catch (error: any) {
      log("Error in getDevicesChannels tool", { error: String(error) }, "error");
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
  server.tool(
    "getDeviceDetails",
    {
      manufacturerIds: z.array(z.string()).describe("Array of device manufacturer IDs (serial numbers) to fetch details for"),
    },
    async (params: { manufacturerIds: string[] }, extra) => {
      try {
        // Separate ids this tool can route (Emporia hardware) from third-party ids
        // (e.g. THERMOSTAT_20072 from listDevices) so one unsupported id doesn't fail
        // the whole batch. There is no device-details endpoint for third-party devices;
        // their live state comes from getDeviceStatus instead.
        const { supported, unsupported } = partitionSupportedDeviceIds(params.manufacturerIds);

        const unsupportedNote =
          unsupported.length > 0
            ? [
                {
                  type: "text" as const,
                  text: `Skipped ${unsupported.length} unsupported id(s) (not Emporia hardware): ${unsupported.join(", ")}. getDeviceDetails only covers Emporia hardware (MONITOR, EV_CHARGER, OUTLET, BATTERY). For thermostats/appliances/vehicles, use getDeviceStatus.`,
                },
              ]
            : [];

        if (supported.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No Emporia hardware ids were provided, so there are no device details to retrieve.",
              },
              ...unsupportedNote,
            ],
          };
        }

        const result = await apiService.getDeviceDetails(extra.authInfo?.token as string, supported);
        // Format the response for each device type
        const content = Object.entries(result).map(([type, { data }]) => ({
          type: "text" as const,
          text:
            `Retrieved ${type} details for ${data.success?.length || 0} device(s). ` +
            (data.error?.length ? `Failed for ${data.error.length} device(s).` : ""),
        }));
        return {
          content: [
            ...unsupportedNote,
            ...content,
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error: any) {
        log("Error in getDeviceDetails tool", { error: String(error) }, "error");
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
    },
  );

  // Add tool for Battery State of Charge
  server.tool(
    "getBatteryStateOfCharge",
    {
      device_ids: z
        .array(z.string())
        .describe(
          "Array of device serial numbers (manufacturer IDs) to fetch state of charge data for. This tool is specifically for Home Battery systems/devices only, not for EVSE/Electric Vehicle battery information.",
        ),
      start: z.string().describe("Start timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSSZ (e.g. 2025-05-14T00:00:00Z)"),
      end: z.string().describe("End timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSSZ (e.g. 2025-05-14T23:59:59Z)"),
      state_of_charge_resolution: z.enum(["MINUTES", "HOURS", "DAYS"]).describe("Time resolution for state of charge data"),
    },
    async (params: GetBatteryStateOfChargeParams, extra) => {
      try {
        const result = await apiService.getBatteryStateOfCharge(extra.authInfo?.token as string, params);
        return {
          content: [
            {
              type: "text",
              text:
                `Retrieved state of charge data for ${result.stateOfChargeData.success?.length || 0} Battery device(s)` +
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
      } catch (error: any) {
        log("Error in getBatteryStateOfCharge tool", { error: String(error) }, "error");
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
    },
  );

  // Add tool for EV Charging Report
  server.tool(
    "getEVChargingReport",
    {
      device_id: z.string().describe("Device serial number (manufacturer ID) of the EV charger to fetch charging report for"),
      start: z.string().describe("Start timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSSZ (e.g. 2025-05-14T00:00:00Z)"),
      end: z.string().describe("End timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSSZ (e.g. 2025-05-14T23:59:59Z)"),
    },
    async (params: GetEVChargingReportParams, extra) => {
      try {
        const result = await apiService.getEVChargingReport(extra.authInfo?.token as string, params);
        return {
          content: [
            {
              type: "text",
              text: `Retrieved EV charging report for device ${result.device_id}` + ` from ${result.interval.start} to ${result.interval.end}.`,
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
      } catch (error: any) {
        log("Error in getEVChargingReport tool", { error: String(error) }, "error");
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
    },
  );

  // Add tool for EV Charger Sessions
  server.tool(
    "getEVChargerSessions",
    {
      device_ids: z.array(z.string()).describe("Array of device serial numbers (manufacturer IDs) to fetch sessions for"),
      start: z.string().describe("Start timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSSZ (e.g. 2025-05-14T00:00:00Z)"),
      end: z.string().describe("End timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSSZ (e.g. 2025-05-14T23:59:59Z)"),
    },
    async (params: GetEVChargerSessionsParams, extra) => {
      try {
        const result = await apiService.getEVChargerSessions(extra.authInfo?.token as string, params);
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
      } catch (error: any) {
        log("Error in getEVChargerSessions tool", { error: String(error) }, "error");
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
    },
  );

  server.tool(
    "getDevicePowerUsage",
    {
      device_ids: z
        .array(z.string())
        .describe("Array of device serial numbers (manufacturer IDs) to fetch power usage data for - NOTE: _*Not*_ 'device_gid'."),
      start: z.string().describe("Start timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSSZ (e.g. 2025-05-14T00:00:00Z)"),
      end: z.string().describe("End timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSSZ (e.g. 2025-05-14T23:59:59Z)"),
      power_resolution: z.enum(["MINUTES", "FIFTEEN_MINUTES"]).describe("Time resolution for power data (MINUTES or FIFTEEN_MINUTES)"),
      circuit_ids: z
        .array(z.string())
        .optional()
        .describe(
          'Array of circuit IDs to fetch usage data for. REQUIRED for Vue energy monitor devices; omit for EV chargers, smart plugs, and batteries (they ignore it — batteries always return all of their streams). Use the `channelId` values from getDevicesChannels whose `usableAsCircuitId` is true. NOTE: "Mains" is NOT a valid circuit ID since it combines the valid circuits "Mains_A", "Mains_B", and "Mains_C".',
        ),
    },
    async (params: GetDevicePowerUsageParams, extra) => {
      try {
        const { supported, unsupported } = partitionSupportedDeviceIds(params.device_ids);
        const unsupportedNote =
          unsupported.length > 0
            ? [
                {
                  type: "text" as const,
                  text: `Skipped ${unsupported.length} unsupported id(s) (not Emporia hardware): ${unsupported.join(", ")}. Power usage is only available for Emporia hardware devices.`,
                },
              ]
            : [];
        if (supported.length === 0) {
          return {
            content: [{ type: "text", text: "No Emporia hardware ids were provided, so there is no power usage to retrieve." }, ...unsupportedNote],
          };
        }
        const result = await apiService.getDevicePowerUsage(extra.authInfo?.token as string, { ...params, device_ids: supported });
        // Format the response for each device type
        const content = Object.entries(result).map(([type, { device_ids, powerData }]) => ({
          type: "text" as const,
          text:
            `Retrieved power usage data for ${type} device(s): ${device_ids.join(", ")}. ` +
            (powerData.success ? `Success count: ${powerData.success.length}` : "") +
            (powerData.error && powerData.error.length ? `, Failed: ${powerData.error.length}` : ""),
        }));
        return {
          content: [
            ...unsupportedNote,
            ...content,
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error: any) {
        log("Error in getDevicePowerUsage tool", { error: String(error) }, "error");
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
    },
  );

  server.tool(
    "getDeviceEnergyUsage",
    {
      device_ids: z
        .array(z.string())
        .describe("Array of device serial numbers (manufacturer IDs) to fetch energy usage data for - NOTE: _*Not*_ 'device_gid'."),
      start: z.string().describe("Start timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSSZ (e.g. 2025-05-14T00:00:00Z)"),
      end: z.string().describe("End timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSSZ (e.g. 2025-05-14T23:59:59Z)"),
      energy_resolution: z
        .enum(["MINUTES", "FIFTEEN_MINUTES", "HOURS", "DAYS", "WEEKS", "MONTHS", "YEARS"])
        .describe("Time resolution for energy data"),
      circuit_ids: z
        .array(z.string())
        .optional()
        .describe(
          'Array of circuit IDs to fetch usage data for. REQUIRED for Vue energy monitor devices; omit for EV chargers, smart plugs, and batteries (they ignore it — batteries always return all of their streams). Use the `channelId` values from getDevicesChannels whose `usableAsCircuitId` is true. NOTE: "Mains" is NOT a valid circuit ID since it combines the valid circuits "Mains_A", "Mains_B", and "Mains_C".',
        ),
    },
    async (params: GetDeviceEnergyUsageParams, extra) => {
      try {
        const { supported, unsupported } = partitionSupportedDeviceIds(params.device_ids);
        const unsupportedNote =
          unsupported.length > 0
            ? [
                {
                  type: "text" as const,
                  text: `Skipped ${unsupported.length} unsupported id(s) (not Emporia hardware): ${unsupported.join(", ")}. Energy usage is only available for Emporia hardware devices.`,
                },
              ]
            : [];
        if (supported.length === 0) {
          return {
            content: [{ type: "text", text: "No Emporia hardware ids were provided, so there is no energy usage to retrieve." }, ...unsupportedNote],
          };
        }
        const result = await apiService.getDeviceEnergyUsage(extra.authInfo?.token as string, { ...params, device_ids: supported });
        // Format the response for each device type
        const content = Object.entries(result).map(([type, { device_ids, energyData }]) => ({
          type: "text" as const,
          text:
            `Retrieved energy usage data for ${type} device(s): ${device_ids.join(", ")}. ` +
            (energyData.success ? `Success count: ${energyData.success.length}` : "") +
            (energyData.error && energyData.error.length ? `, Failed: ${energyData.error.length}` : ""),
        }));
        return {
          content: [
            ...unsupportedNote,
            ...content,
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error: any) {
        log("Error in getDeviceEnergyUsage tool", { error: String(error) }, "error");
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
    },
  );
}
