import { EMPORIA_LEGACY_API_ORIGIN, EMPORIA_API_ORIGIN, USER_AGENT } from "../config.js";
import { CognitoAuthService } from "./auth.js";
import { log } from "../utils/log.js";
import {
  GetBatteryStateOfChargeParams,
  GetEVChargingReportParams,
  GetEVChargerSessionsParams,
  EVChargingReportResponse,
  EVSEsSessionsResponse,
  StateOfChargeResponse,
  DeviceChannelsItem,
  ListDevicesResult,
  CustomerDevicesResponseV2,
  CustomerResponseV2,
  SitesResponse,
  DevicesStatusResponse,
  GetDeviceStatusParams,
  GetDeviceEnergyUsageParams,
  GetDevicePowerUsageParams,
  DeviceType,
  MeteredTimeResolution,
  DeviceChannel,
} from "../types/api.js";
import { DEVICE_TYPE_CONFIGS, DEVICE_TYPE_CONFIGS_BY_TYPE } from "../constants/deviceTypes.js";
import { JsonObject } from "../types/jsonValue.js";

function getDeviceTypeFromId(id: string): DeviceType | null {
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
export function partitionSupportedDeviceIds(ids: string[]): { supported: string[]; unsupported: string[] } {
  const supported: string[] = [];
  const unsupported: string[] = [];
  for (const id of ids) {
    if (getDeviceTypeFromId(id)) {
      supported.push(id);
    } else {
      unsupported.push(id);
    }
  }
  return { supported, unsupported };
}

type GroupedDevices = { [k in DeviceType]?: string[] };

function groupDeviceIdsByType(manufacturerIds: string[]): GroupedDevices {
  const deviceGroups: GroupedDevices = {};
  for (const id of manufacturerIds) {
    const deviceType = getDeviceTypeFromId(id);
    if (!deviceType) {
      throw new Error(
        `Invalid device ID format: ${id}. First character must be one of: ` +
          Object.values(DEVICE_TYPE_CONFIGS)
            .map((cfg) => cfg.firstChars.join(", "))
            .join(" | "),
      );
    }

    if (!deviceGroups[deviceType]) {
      deviceGroups[deviceType] = [];
    }

    deviceGroups[deviceType].push(id);
  }

  return deviceGroups;
}

export type QueryParametersType = Record<string, string | undefined | null>;

export class EmporiaApiService {
  /** Cognito auth service used to get auth tokens when the MCP server is running locally (STDIO) */
  private authService: CognitoAuthService | null;

  public constructor(authService: CognitoAuthService | null) {
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
  public async listDevices(authToken: string | undefined, siteGid?: number): Promise<ListDevicesResult> {
    try {
      const parameters = siteGid !== undefined ? { site_gid: String(siteGid) } : undefined;

      // Fetch devices (site-aware) and customer info in parallel. Customer info
      // is best-effort: a failure there should not prevent returning devices.
      const [devicesData, customer] = await Promise.all([
        this.get<CustomerDevicesResponseV2>("/v1/customers/devices", authToken, false, { parameters }),
        this.get<CustomerResponseV2>("/v1/customers", authToken, false).catch((error: any) => {
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
    } catch (error: any) {
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
  public async listSites(authToken: string | undefined): Promise<SitesResponse> {
    try {
      const data = await this.get<SitesResponse>("/v1/customers/sites", authToken, false);
      return { sites: data.sites ?? [] };
    } catch (error: any) {
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
  public async getDeviceStatus(authToken: string | undefined, params: GetDeviceStatusParams): Promise<DevicesStatusResponse> {
    try {
      const parameters: QueryParametersType = {};
      if (params.device_ids && params.device_ids.length > 0) {
        parameters.device_ids = params.device_ids.join(",");
      }
      if (params.site_gid !== undefined) {
        parameters.site_gid = String(params.site_gid);
      }

      const hasParams = Object.keys(parameters).length > 0;
      return await this.get<DevicesStatusResponse>("/v1/customers/devices/status", authToken, false, {
        parameters: hasParams ? parameters : undefined,
      });
    } catch (error: any) {
      log("Error fetching device status", { error: String(error), params }, "error", "API");
      throw error;
    }
  }

  /**
   * Generic device details fetcher by manufacturer ID(s).
   */
  public async getDeviceDetails(
    authToken: string,
    manufacturerIds: string[],
  ): Promise<
    Record<
      DeviceType,
      {
        manufacturerIds: string[];
        data: any;
      }
    >
  > {
    const deviceGroups = groupDeviceIdsByType(manufacturerIds);
    try {
      // Fetch details for each group.
      const results = await Promise.all(
        Object.entries(deviceGroups).map(async ([type, ids]) => {
          const config = DEVICE_TYPE_CONFIGS_BY_TYPE[type as DeviceType];
          const parameters = {
            device_ids: ids.join(","),
          };
          const endpoint = `/v1/devices/${config.endpoint}`;
          const data = await this.get<any>(endpoint, authToken, false, { parameters });
          return [
            type,
            {
              manufacturerIds: ids,
              data,
            },
          ];
        }),
      );

      // Combine results by type.
      return Object.fromEntries(results);
    } catch (error: any) {
      log(
        "Error fetching device details",
        {
          error: String(error),
          manufacturerIds,
          stack: error instanceof Error ? error.stack : undefined,
        },
        "error",
        "API",
      );
      throw error;
    }
  }

  /**
   * Get devices and their channels data.
   *
   * This endpoint provides detailed information about device channels, including
   * main and branch circuits, which is useful for energy monitoring applications.
   */
  public async getDevicesChannels(authToken: string | undefined): Promise<{
    deviceCount: number;
    deviceSummaries: {
      description: string;
      deviceGid: number;
      deviceId: string;
      parentDeviceId?: string;
      channelCounts: { mains: number; branch: number; merged: number; total: number };
      channelInfo: { name: string; channelId: string; channelNum: string; type: string; usableAsCircuitId: boolean }[];
    }[];
  }> {
    try {
      const channelsEndpoint = "/v1/customers/devices/channels";
      const channelsData = await this.get<DeviceChannelsItem[]>(channelsEndpoint, authToken, false);

      // Log information about the response structure
      log(
        "Device channels response structure",
        {
          itemCount: channelsData.length,
          sampleItem:
            channelsData.length > 0
              ? {
                  keys: Object.keys(channelsData[0]),
                  hasChannels: !!channelsData[0].channels,
                }
              : null,
        },
        "debug",
        "API",
      );

      // Flatten nested devices to make it easier for LLMs to understand
      const devices = this.flattenDeviceChannelsItems(channelsData, null);

      // Reduce to summaries because the data can sometimes be too big or confusing for LLM.
      const deviceSummaries = devices.map((device: DeviceChannelsItem) => {
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
          } else if (channel.channel_id.startsWith("Branch")) {
            channelCounts.branch++;
          } else if (channel.channel_id.startsWith("Merged")) {
            channelCounts.merged++;
          }
        }

        return {
          description:
            '"Channels" list will provide the main and branch circuits for each device. Important to note that "Mains" represent a combined circuit of the primary service lines and each individual circuit will have "parent_channel_id" of "Mains". This is not to be confused with branch circuits that have a "channel_num" of 1, 2, or 3 - instead you can compare the "channel_id" to see "branch_XYZ". This detail is important as other API endpoints may return individual channel id\'s that might not be in the same format (and possible that channels 1, 2, 3 as ids would actually represent mains instead of branches in those other endpoints).',
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
    } catch (error: any) {
      log("Error fetching device channels", { error: String(error) }, "error", "API");
      throw error;
    }
  }

  /** Recursively flatten a device channels response to prevent returning a deeply nested structure to LLMs */
  private flattenDeviceChannelsItems(devices: DeviceChannelsItem[], parentDeviceId: string | null): DeviceChannelsItem[] {
    const flattenedDevices: DeviceChannelsItem[] = [];

    for (const device of devices) {
      const channels: DeviceChannel[] = [];
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
  public async getBatteryStateOfCharge(
    authToken: string | undefined,
    params: GetBatteryStateOfChargeParams,
  ): Promise<{
    device_ids: string[];
    start: string;
    end: string;
    state_of_charge_resolution: MeteredTimeResolution;
    stateOfChargeData: StateOfChargeResponse;
  }> {
    try {
      const { device_ids, start, end, state_of_charge_resolution } = params;

      const parameters = {
        device_ids: device_ids.join(","),
        start,
        end,
        state_of_charge_resolution,
      };

      const endpoint = "/v1/devices/batteries/state-of-charge";
      const data = await this.get<StateOfChargeResponse>(endpoint, authToken, false, { parameters });

      return {
        device_ids,
        start,
        end,
        state_of_charge_resolution,
        stateOfChargeData: data,
      };
    } catch (error: any) {
      log("Error fetching Battery state of charge", { error: String(error), params }, "error", "API");
      throw error;
    }
  }

  /**
   * Get EV charging report for specified devices.
   */
  public async getEVChargingReport(authToken: string | undefined, params: GetEVChargingReportParams): Promise<EVChargingReportResponse> {
    try {
      const { device_id, start, end } = params;
      const parameters = {
        device_id,
        start,
        end,
      };

      const endpoint = "/v1/customers/ev-charging-report";
      return await this.get<EVChargingReportResponse>(endpoint, authToken, false, { parameters });
    } catch (error: any) {
      log("Error fetching EV charging report", { error: String(error), params }, "error", "API");
      throw error;
    }
  }

  /**
   * Get EVSE sessions for specified devices.
   */
  public async getEVChargerSessions(
    authToken: string | undefined,
    params: GetEVChargerSessionsParams,
  ): Promise<{
    device_ids: string[];
    start: string;
    end: string;
    sessionsData: EVSEsSessionsResponse;
  }> {
    try {
      const { device_ids, start, end } = params;

      const parameters = {
        device_ids: device_ids.join(","),
        start: start,
        end: end,
      };

      const endpoint = "/v1/devices/evses/sessions";
      const data = await this.get<EVSEsSessionsResponse>(endpoint, authToken, false, { parameters });
      return {
        device_ids,
        start,
        end,
        sessionsData: data,
      };
    } catch (error: any) {
      log("Error fetching EVSE sessions", { error: String(error), params }, "error", "API");
      throw error;
    }
  }

  /**
   * Generic device power usage fetcher by manufacturer ID(s).
   */
  public async getDevicePowerUsage(
    authToken: string | undefined,
    params: GetDevicePowerUsageParams,
  ): Promise<
    Record<
      DeviceType,
      {
        device_ids: string[];
        powerData: any;
      }
    >
  > {
    const { device_ids, start, end, power_resolution, circuit_ids } = params;
    const deviceGroups = groupDeviceIdsByType(device_ids);

    // Validation: If any device is an energy monitor, circuit_ids must be provided and non-empty
    const energyMonitorTypes: DeviceType[] = ["vue1", "vue2", "vue3", "vueutility"];
    const hasEnergyMonitor = Object.keys(deviceGroups).some((type) => energyMonitorTypes.includes(type as DeviceType));
    if (hasEnergyMonitor && (!circuit_ids || circuit_ids.length === 0)) {
      throw new Error(
        `circuit_ids is required and must be non-empty when querying power usage for energy monitor devices (${energyMonitorTypes.join(", ")}).`,
      );
    }

    const DEVICE_POWER_USAGE_ENDPOINTS: Record<DeviceType, string> = {
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
      const results = await Promise.all(
        Object.entries(deviceGroups).map(async ([type, ids]) => {
          const deviceType = type as DeviceType;
          const isEnergyMonitor = deviceType.startsWith("vue");
          const endpointPath = DEVICE_POWER_USAGE_ENDPOINTS[deviceType];
          const parameters: any = {
            device_ids: ids.join(","),
            start,
            end,
            power_resolution,
          };
          if (isEnergyMonitor && circuit_ids && circuit_ids.length > 0) {
            parameters.circuit_ids = circuit_ids.join(",");
          }

          const endpoint = `/v1/devices/${endpointPath}`;
          const data = await this.get<any>(endpoint, authToken, false, { parameters });
          return [
            type,
            {
              device_ids: ids,
              powerData: data,
            },
          ];
        }),
      );
      return Object.fromEntries(results);
    } catch (error) {
      log(
        "Error fetching device power usage",
        {
          error: String(error),
          params,
          stack: error instanceof Error ? error.stack : undefined,
        },
        "error",
        "API",
      );
      throw error;
    }
  }

  public async getDeviceEnergyUsage(
    authToken: string | undefined,
    params: GetDeviceEnergyUsageParams,
  ): Promise<
    Record<
      DeviceType,
      {
        device_ids: string[];
        energyData: any;
      }
    >
  > {
    const { device_ids, start, end, energy_resolution, circuit_ids } = params;
    const deviceGroups = groupDeviceIdsByType(device_ids);

    // Validation: If any device is an energy monitor, circuit_ids must be provided and non-empty
    const energyMonitorTypes: DeviceType[] = ["vue1", "vue2", "vue3", "vueutility"];
    const hasEnergyMonitor = Object.keys(deviceGroups).some((type) => energyMonitorTypes.includes(type as DeviceType));
    if (hasEnergyMonitor && (!circuit_ids || circuit_ids.length === 0)) {
      throw new Error(
        `circuit_ids is required and must be non-empty when querying power usage for energy monitor devices (${energyMonitorTypes.join(", ")}).`,
      );
    }

    // Map device type to energy usage endpoint
    const DEVICE_ENERGY_USAGE_ENDPOINTS: Record<DeviceType, string> = {
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
      const results = await Promise.all(
        Object.entries(deviceGroups).map(async ([type, ids]) => {
          const deviceType = type as DeviceType;
          const isEnergyMonitor = deviceType.startsWith("vue");
          const endpointPath = DEVICE_ENERGY_USAGE_ENDPOINTS[deviceType];
          const parameters: any = {
            device_ids: ids.join(","),
            start,
            end,
            energy_resolution,
          };
          if (isEnergyMonitor && circuit_ids && circuit_ids.length > 0) {
            parameters.circuit_ids = circuit_ids.join(",");
          }
          const endpoint = `/v1/devices/${endpointPath}`;
          const data = await this.get<any>(endpoint, authToken, false, { parameters });
          return [
            type,
            {
              device_ids: ids,
              energyData: data,
            },
          ];
        }),
      );
      return Object.fromEntries(results);
    } catch (error) {
      log(
        "Error fetching device energy usage",
        {
          error: String(error),
          params,
          stack: error instanceof Error ? error.stack : undefined,
        },
        "error",
        "API",
      );
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
  public async get<T>(
    path: string,
    authToken: string | undefined,
    legacy: boolean,
    args?: {
      headers?: any;
      parameters?: QueryParametersType;
    },
  ): Promise<T> {
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
    } else {
      apiOrigin = EMPORIA_API_ORIGIN;
      headers.Authorization = authToken;
    }

    return this.send<T>("GET", apiOrigin + path, {
      headers,
      parameters: args.parameters,
    });
  }

  private async send<T>(
    method: "POST" | "GET" | "PATCH" | "PUT",
    fullPath: string,
    args: {
      body?: any;
      headers: any;
      parameters?: any;
    },
  ): Promise<T> {
    const url = escapeUrl(fullPath, args.parameters);

    const headers = args.headers;
    headers["User-Agent"] ??= USER_AGENT;
    headers.Accept ??= "application/json";

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: args.body,
      });
    } catch (error: any) {
      log(
        "Error making request",
        {
          url,
          error: String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        "error",
        "AUTH",
      );
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

    let json: JsonObject;
    try {
      json = JSON.parse(text);
    } catch (error: any) {
      log(
        "Error parsing json response.",
        {
          url,
          error: String(error),
          stack: error instanceof Error ? error.stack : undefined,
          text,
        },
        "error",
        "AUTH",
      );
      throw error;
    }

    return json as any;
  }
}

function escapeUrl(baseUrl: string, parameters?: QueryParametersType): string {
  if (!parameters) {
    return baseUrl;
  }

  const entries = Object.entries(parameters);
  if (entries.length === 0) {
    return baseUrl;
  }

  const queryString = entries.map((p) => escapePair(p[0], p[1])).join("&");
  return `${baseUrl}?${queryString}`;

  function escapePair(key: string, value: string | undefined | null): string {
    return !value ? key : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
}
